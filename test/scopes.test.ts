import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAll, type AstNode } from "../src/core/reader";
import {
  collectSymbols,
  createFileScope,
  lookupFunction,
  lookupVariable,
  walkWithScopes,
  type Scope,
} from "../src/core/scopes";

//LLM-written tests
function rootScope(source: string): Scope {
  return createFileScope(collectSymbols(parseAll(source)));
}

function scopesByOffset(source: string): Map<number, Scope> {
  const forms = parseAll(source);
  const scopes = new Map<number, Scope>();

  walkWithScopes(forms, createFileScope(collectSymbols(forms)), (node, scope) => {
    scopes.set(node.start.offset, scope);
  });

  return scopes;
}

function scopeAt(source: string, offset: number): Scope {
  const scope = scopesByOffset(source).get(offset);
  assert.ok(scope !== undefined, `no form starts at offset ${offset}`);
  return scope;
}

function visited(source: string): AstNode[] {
  const forms = parseAll(source);
  const nodes: AstNode[] = [];

  walkWithScopes(forms, createFileScope(collectSymbols(forms)), (node) => {
    nodes.push(node);
  });

  return nodes;
}

test("collects a defun with its parameter count", () => {
  const symbols = collectSymbols(parseAll("(defun f (x y) x)"));

  assert.deepEqual(symbols.functions.get("F")?.arity, { min: 2, max: 2 });
  assert.equal(lookupFunction(rootScope("(defun f (x y) x)"), "F")?.kind, "function");
});

test("collects defparameter, defvar and defconstant as globals", () => {
  const symbols = collectSymbols(
    parseAll("(defparameter a 1) (defvar b 2) (defconstant c 3)"),
  );

  assert.deepEqual([...symbols.variables.keys()].sort(), ["A", "B", "C"]);
});

test("detects a file that loads another one", () => {
  assert.equal(
    collectSymbols(parseAll('(load "other.lisp")')).loadsAnotherFile,
    true,
  );
  assert.equal(
    collectSymbols(parseAll("(defun f () 1)")).loadsAnotherFile,
    false,
  );
});

test("resolves a builtin by name", () => {
  assert.equal(lookupFunction(rootScope("(defun f () 1)"), "CAR")?.kind, "builtin");
});

test("resolves a standard name we do not implement", () => {
  assert.equal(lookupFunction(rootScope(""), "LOOP")?.kind, "standard");
});

test("shows parameters in the body and not outside it", () => {
  const source = "(defun f (x) (* x 2))";

  const body = lookupVariable(scopeAt(source, source.indexOf("x 2")), "X");
  assert.equal(body?.kind, "parameter");

  assert.equal(lookupVariable(scopeAt(source, 0), "X"), undefined);
});

test("scopes lambda parameters to its body", () => {
  const source = "(funcall (lambda (y) (+ y 1)) 2)";
  const body = lookupVariable(scopeAt(source, source.indexOf("y 1")), "Y");

  assert.equal(body?.kind, "parameter");
});

test("evaluates let values before binding any name", () => {
  const source = "(let ((a 1) (b a)) b)";
  const valueScope = scopeAt(source, source.indexOf("a))"));

  assert.equal(lookupVariable(valueScope, "A"), undefined);
});

test("lets let* values see earlier names", () => {
  const source = "(let* ((a 1) (b a)) b)";
  const valueScope = scopeAt(source, source.indexOf("a))"));

  assert.equal(lookupVariable(valueScope, "A")?.kind, "local");
});

test("hides an flet definition from its own body", () => {
  const source = "(flet ((h (x) (h x))) (h 1))";
  const bodyScope = scopeAt(source, source.indexOf("(h x)") + 3);

  assert.equal(lookupFunction(bodyScope, "H"), undefined);
});

test("shows a labels definition to its own body", () => {
  const source = "(labels ((h (x) (h x))) (h 1))";
  const bodyScope = scopeAt(source, source.indexOf("(h x)") + 3);

  assert.equal(lookupFunction(bodyScope, "H")?.kind, "function");
});

test("binds a dolist counter in the body only", () => {
  const source = "(dolist (i '(1 2)) i)";
  const counter = lookupVariable(scopeAt(source, source.lastIndexOf("i)")), "I");

  assert.equal(counter?.kind, "local");
});

test("binds a dotimes counter in the body only", () => {
  const source = "(dotimes (i 3) i)";
  const counter = lookupVariable(scopeAt(source, source.lastIndexOf("i)")), "I");

  assert.equal(counter?.kind, "local");
});

test("lets an inner binding shadow an outer one", () => {
  const source = "(let ((x 1)) (let ((x 2)) x))";
  const binding = lookupVariable(scopeAt(source, source.lastIndexOf("x)")), "X");

  assert.equal(binding?.kind, "local");
  assert.equal(binding?.position?.offset, source.indexOf("x 2"));
});

test("walks no forms inside quoted data", () => {
  assert.deepEqual(visited("'(a b)"), []);
});

test("walks the vector literal but none of its contents", () => {
  assert.equal(visited("#(a (b))").length, 1);
});

test("collects a defun nested inside another form", () => {
  const symbols = collectSymbols(parseAll("(progn (defun g (x) x) (g 1))"));

  assert.deepEqual(symbols.functions.get("G")?.arity, { min: 1, max: 1 });
});

test("binds a dotimes counter in its result form", () => {
  const source = "(dotimes (i 3 i) i)";
  const scope = scopeAt(source, source.indexOf("3 i") + 2);

  assert.equal(lookupVariable(scope, "I")?.kind, "local");
});

test("does not visit a call's head atom", () => {
  const source = "(car x)";
  const scopes = scopesByOffset(source);

  assert.equal(scopes.has(source.indexOf("car")), false);
  assert.equal(scopes.has(source.lastIndexOf("x")), true);
});

test("visits a lambda in head position in full", () => {
  const source = "((lambda (y) (+ y 1)) 2)";
  const scope = scopeAt(source, source.indexOf("y 1"));

  assert.equal(lookupVariable(scope, "Y")?.kind, "parameter");
});

test("visits a cond clause test as a form", () => {
  const source = "(cond (x 1))";

  assert.equal(scopesByOffset(source).has(source.indexOf("x 1")), true);
});

test("does not deliver a cond clause list as a form", () => {
  const source = "(cond (x 1))";

  assert.equal(scopesByOffset(source).has(source.indexOf("(x 1)")), false);
});

test("does not visit the name in a function form", () => {
  const source = "(function f)";

  assert.equal(scopesByOffset(source).has(source.lastIndexOf("f")), false);
});

test("visits the lambda inside a function form", () => {
  const source = "(function (lambda (y) (+ y 1)))";
  const scope = scopeAt(source, source.indexOf("y 1"));

  assert.equal(lookupVariable(scope, "Y")?.kind, "parameter");
});

test("binds a loop name introduced by for", () => {
  const source = "(loop for x in xs do (print x))";
  const scope = scopeAt(source, source.indexOf("x)"));

  assert.equal(lookupVariable(scope, "X")?.kind, "local");
});

test("binds a loop name introduced by with", () => {
  const source = "(loop with y = 1 do (print y))";
  const scope = scopeAt(source, source.indexOf("y)"));

  assert.equal(lookupVariable(scope, "Y")?.kind, "local");
});

test("binds a second loop name introduced by and", () => {
  const source = "(loop for x in xs and y in ys do (print y))";
  const scope = scopeAt(source, source.indexOf("y)"));

  assert.equal(lookupVariable(scope, "Y")?.kind, "local");
});

test("visits no loop clause keyword as a form", () => {
  const source = "(loop for x in xs do (print x))";
  const scopes = scopesByOffset(source);

  assert.equal(scopes.has(source.indexOf("for")), false);
  assert.equal(scopes.has(source.indexOf("in")), false);
  assert.equal(scopes.has(source.indexOf("do")), false);
});

test("visits a list token inside a loop form", () => {
  const source = "(loop for x in xs collect (list x))";

  assert.equal(scopesByOffset(source).has(source.indexOf("(list x)")), true);
});

test("does not visit an atom driver value inside a loop form", () => {
  const source = "(loop for x in xs do x)";

  assert.equal(scopesByOffset(source).has(source.indexOf("xs")), false);
});

test("registers the names a defstruct generates", () => {
  const symbols = collectSymbols(parseAll("(defstruct point x y)"));

  assert.deepEqual(symbols.functions.get("MAKE-POINT")?.arity, {
    min: 0,
    max: null,
  });
  assert.deepEqual(symbols.functions.get("POINT-P")?.arity, { min: 1, max: 1 });
  assert.deepEqual(symbols.functions.get("COPY-POINT")?.arity, {
    min: 1,
    max: 1,
  });
  assert.deepEqual(symbols.functions.get("POINT-X")?.arity, { min: 1, max: 1 });
  assert.deepEqual(symbols.functions.get("POINT-Y")?.arity, { min: 1, max: 1 });
});

test("uses bare slot names when the conc-name is nil", () => {
  const symbols = collectSymbols(
    parseAll("(defstruct (tree-node (:conc-name nil)) key lc rc)"),
  );

  assert.ok(symbols.functions.has("KEY"));
  assert.ok(symbols.functions.has("LC"));
  assert.ok(symbols.functions.has("RC"));
  assert.equal(symbols.functions.has("TREE-NODE-KEY"), false);
});

test("honours a conc-name prefix", () => {
  const symbols = collectSymbols(
    parseAll("(defstruct (pt (:conc-name point-)) x)"),
  );

  assert.ok(symbols.functions.has("POINT-X"));
  assert.ok(symbols.functions.has("MAKE-PT"));
});

test("registers a custom constructor name", () => {
  const symbols = collectSymbols(
    parseAll("(defstruct (pt (:constructor make-one (x))) x)"),
  );

  assert.ok(symbols.functions.has("MAKE-ONE"));
  assert.equal(symbols.functions.has("MAKE-PT"), false);
});

test("registers no constructor when it is nil", () => {
  const symbols = collectSymbols(
    parseAll("(defstruct (pt (:constructor nil)) x)"),
  );

  assert.equal(symbols.functions.has("MAKE-PT"), false);
});

test("registers no predicate when it is nil", () => {
  const symbols = collectSymbols(
    parseAll("(defstruct (pt (:predicate nil)) x)"),
  );

  assert.equal(symbols.functions.has("PT-P"), false);
});

test("registers no copier when it is nil", () => {
  const symbols = collectSymbols(parseAll("(defstruct (pt (:copier nil)) x)"));

  assert.equal(symbols.functions.has("COPY-PT"), false);
});

test("reads a slot given with its default", () => {
  const symbols = collectSymbols(parseAll("(defstruct point (x 0) (y 0))"));

  assert.ok(symbols.functions.has("POINT-X"));
  assert.ok(symbols.functions.has("POINT-Y"));
});

test("marks :include as a structure we cannot model", () => {
  const symbols = collectSymbols(
    parseAll("(defstruct (child (:include parent)) z)"),
  );

  assert.equal(symbols.unmodelledStructures, true);
});

test("does not mark a plain defstruct as unmodelled", () => {
  const symbols = collectSymbols(parseAll("(defstruct point x)"));

  assert.equal(symbols.unmodelledStructures, false);
});
