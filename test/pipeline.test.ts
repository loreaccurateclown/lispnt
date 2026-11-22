import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAll } from "../src/core/reader";
import { createEnv, evaluate } from "../src/core/interpreter";
import { NIL, type LispValue } from "../src/core/values";
import { printValue } from "../src/core/print";

//LLM-written tests
function printed(source: string): string {
  const env = createEnv(null);
  let value: LispValue = NIL;
  for (const form of parseAll(source)) value = evaluate(form, env);
  return printValue(value);
}

test("prints a list the interpreter built", () => {
  assert.equal(printed("(list 1 2 3)"), "(1 2 3)");
});

test("prints a dotted pair the interpreter built", () => {
  assert.equal(printed("(cons 1 2)"), "(1 . 2)");
});

test("prints a proper list whose tail is the NIL singleton", () => {
  assert.equal(printed("(cons 1 (cons 2 nil))"), "(1 2)");
});

test("prints a string value with its escapes re-applied", () => {
  assert.equal(printed('(list "a\\"b")'), '("a\\"b")');
});

test("prints a vector literal that evaluated to itself", () => {
  assert.equal(printed("#(1 2)"), "#(1 2)");
});

test("prints the builtin a function designator resolved to", () => {
  assert.equal(printed("#'car"), "#<builtin CAR>");
});

test("prints an array the interpreter built with make-array", () => {
  assert.equal(printed("(make-array 3 :initial-element 0)"), "#(0 0 0)");
});

test("prints the last value of a multi-form source", () => {
  assert.equal(printed("(defun f (x) x) (f 5)"), "5");
});
