import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "../src/core/reader";
import { NIL, cons, intern, isNil, type LispValue } from "../src/core/values";
import {
  astToValue,
  createEnv,
  define,
  evaluate,
  lookup,
} from "../src/core/interpreter";

//LLM-written tests
function num(value: number): LispValue {
  return { kind: "number", value };
}

function expectCons(value: LispValue) {
  if (value.kind !== "cons") {
    assert.fail(`expected a cons, got ${value.kind}`);
  }
  return value;
}

test("evaluates a number literal", () => {
  assert.deepEqual(evaluate(parse("42"), createEnv(null)), num(42));
});

test("evaluates a string literal", () => {
  assert.deepEqual(evaluate(parse('"hi"'), createEnv(null)), {
    kind: "string",
    value: "hi",
  });
});

test("binds T in the root environment, case-insensitively", () => {
  const env = createEnv(null);

  const upper = evaluate(parse("T"), env);
  const lower = evaluate(parse("t"), env);

  assert.equal(upper, intern("T"));
  assert.equal(lower, upper);
});

test("throws on an unbound symbol", () => {
  assert.throws(() => evaluate(parse("x"), createEnv(null)));
});

test("resolves defined names case-insensitively", () => {
  const env = createEnv(null);
  define(env, "x", num(1));

  assert.deepEqual(evaluate(parse("X"), env), num(1));
  assert.deepEqual(evaluate(parse("x"), env), num(1));
});

test("finds parent bindings and lets a child shadow them", () => {
  const parent = createEnv(null);
  define(parent, "y", num(2));
  const child = createEnv(parent);

  assert.deepEqual(lookup(child, "y"), num(2));

  define(child, "y", num(3));

  assert.deepEqual(lookup(child, "y"), num(3));
  assert.deepEqual(lookup(parent, "y"), num(2));
});

test("evaluates a quoted symbol to an interned uppercase symbol", () => {
  assert.deepEqual(evaluate(parse("'foo"), createEnv(null)), {
    kind: "symbol",
    name: "FOO",
  });
});

test("evaluates a quoted list to a cons chain in order", () => {
  const chain = expectCons(evaluate(parse("'(1 2 3)"), createEnv(null)));
  assert.deepEqual(chain.car, num(1));

  const second = expectCons(chain.cdr);
  assert.deepEqual(second.car, num(2));

  const third = expectCons(second.cdr);
  assert.deepEqual(third.car, num(3));
  assert.ok(isNil(third.cdr));
});

test("evaluates the empty list to NIL", () => {
  assert.ok(isNil(evaluate(parse("'()"), createEnv(null))));
});

test("evaluates a doubly quoted symbol to the data (QUOTE X)", () => {
  const chain = expectCons(evaluate(parse("''x"), createEnv(null)));

  assert.equal(chain.car, intern("QUOTE"));
  assert.equal(expectCons(chain.cdr).car, intern("X"));
  assert.ok(isNil(expectCons(chain.cdr).cdr));
});

test("evaluates a quoted vector literal to an array value", () => {
  const value = evaluate(parse("'#(1 2)"), createEnv(null));

  assert.equal(value.kind, "array");
  if (value.kind !== "array") return;

  assert.deepEqual(value.elements, [num(1), num(2)]);
});

test("interns one symbol per name, ignoring case", () => {
  assert.equal(intern("foo"), intern("FOO"));
  assert.deepEqual(cons(num(1), NIL).cdr, NIL);
});

test("converts a bare list node without going through quote", () => {
  const chain = expectCons(astToValue(parse("(a b)")));

  assert.equal(chain.car, intern("A"));
  assert.equal(expectCons(chain.cdr).car, intern("B"));
});

//LLM-written tests
test("evaluates a dotted pair to a cons whose cdr is the tail", () => {
  assert.deepEqual(evaluate(parse("'(a . b)"), createEnv(null)), {
    kind: "cons",
    car: { kind: "symbol", name: "A" },
    cdr: { kind: "symbol", name: "B" },
  });
});

test("evaluates a one-entry alist built from a dotted pair", () => {
  const outer = expectCons(
    evaluate(parse('\'((name . "Ann"))'), createEnv(null)),
  );
  const entry = expectCons(outer.car);

  assert.equal(entry.car, intern("NAME"));
  assert.deepEqual(entry.cdr, { kind: "string", value: "Ann" });
  assert.ok(isNil(outer.cdr));
});

//LLM-written tests
function run(source: string): LispValue {
  return evaluate(parse(source), createEnv(null));
}

test("evaluates if with both branches and without an else", () => {
  assert.deepEqual(run("(if t 1 2)"), num(1));
  assert.deepEqual(run("(if nil 1 2)"), num(2));
  assert.ok(isNil(run("(if nil 1)")));
});

test("treats zero as true in if", () => {
  assert.deepEqual(run("(if 0 1 2)"), num(1));
});

test("evaluates cond up to the first matching clause", () => {
  assert.deepEqual(run("(cond (nil 1) (t 2))"), num(2));
  assert.ok(isNil(run("(cond (nil 1))")));
});

test("evaluates a cond clause with a t test", () => {
  assert.deepEqual(run("(cond (t 5))"), num(5));
});

test("evaluates and, returning the last value or nil", () => {
  assert.deepEqual(run("(and 1 2)"), num(2));
  assert.ok(isNil(run("(and 1 nil 2)")));
  assert.equal(run("(and)"), intern("T"));
});

test("evaluates or, returning the first truthy value", () => {
  assert.deepEqual(run("(or nil 3)"), num(3));
  assert.ok(isNil(run("(or nil nil)")));
  assert.ok(isNil(run("(or)")));
});

test("evaluates when only on a truthy test", () => {
  assert.deepEqual(run("(when t 1 2)"), num(2));
  assert.ok(isNil(run("(when nil 1)")));
});

test("evaluates unless only on a false test", () => {
  assert.deepEqual(run("(unless nil 1 2)"), num(2));
  assert.ok(isNil(run("(unless t 1)")));
});

test("evaluates progn to its last form", () => {
  assert.deepEqual(run("(progn 1 2 3)"), num(3));
  assert.ok(isNil(run("(progn)")));
});

test("evaluates let bindings and body", () => {
  assert.deepEqual(run("(let ((x 2)) x)"), num(2));
});

test("evaluates a bare symbol let binding as nil", () => {
  assert.ok(isNil(run("(let (x) x)")));
});

test("lets an inner let shadow an outer binding", () => {
  assert.deepEqual(run("(let ((x 1)) (let ((x 2)) x))"), num(2));
});

test("initialises let values in the outer environment", () => {
  assert.deepEqual(run("(let ((x 1)) (let ((x 2) (y x)) y))"), num(1));
});

test("initialises let* values sequentially", () => {
  assert.deepEqual(run("(let* ((x 1) (y x)) y)"), num(1));
  assert.throws(() => run("(let ((x 1) (y x)) y)"));
});

test("evaluates defparameter and sees the binding afterwards", () => {
  assert.deepEqual(run("(progn (defparameter *x* 5) *x*)"), num(5));
});

test("evaluates setq against an existing binding", () => {
  assert.deepEqual(run("(let ((x 1)) (progn (setq x 2) x))"), num(2));
});

test("binds a function value for defun", () => {
  const value = run("(progn (defun f (x) x) f)");

  assert.equal(value.kind, "function");
  if (value.kind !== "function") return;

  assert.equal(value.name, "F");
  assert.deepEqual(value.params, ["X"]);
  assert.equal(value.body.length, 1);
});

test("rejects a defun whose argument list is not a list", () => {
  assert.throws(() => run("(defun f 1)"));
});
