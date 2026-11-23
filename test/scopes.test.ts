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

  assert.equal(symbols.functions.get("F")?.parameterCount, 2);
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
  const bodyScope = scopeAt(source, source.indexOf("(h x)") + 1);

  assert.equal(lookupFunction(bodyScope, "H"), undefined);
});

test("shows a labels definition to its own body", () => {
  const source = "(labels ((h (x) (h x))) (h 1))";
  const bodyScope = scopeAt(source, source.indexOf("(h x)") + 1);

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

  assert.equal(symbols.functions.get("G")?.parameterCount, 1);
});
