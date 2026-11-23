import { test } from "node:test";
import assert from "node:assert/strict";
import { traceCalls, type TraceFrame } from "../src/core/trace";

//LLM-written tests
function depth(frame: TraceFrame): number {
  const children = frame.children.map(depth);
  return 1 + (children.length === 0 ? 0 : Math.max(...children));
}

test("records one frame for a single call", () => {
  const result = traceCalls("(defun f (x) x) (f 5)");

  assert.equal(result.frames.length, 1);
  assert.equal(result.frames[0]?.name, "F");
  assert.equal(result.truncated, false);
});

test("records a nested call as a child", () => {
  const result = traceCalls("(defun g (x) x) (defun f (x) (g x)) (f 5)");

  assert.equal(result.frames[0]?.name, "F");
  assert.equal(result.frames[0]?.children[0]?.name, "G");
});

test("records printed arguments", () => {
  const result = traceCalls('(defun f (x) x) (f "hi")');

  assert.deepEqual(result.frames[0]?.args, ['"hi"']);
});

test("records the printed result at exit", () => {
  const result = traceCalls("(defun f () (list 1 2)) (f)");

  assert.equal(result.frames[0]?.result, "(1 2)");
});

test("records sibling calls under separate roots", () => {
  const result = traceCalls("(defun f (x) x) (f 1) (f 2)");

  assert.deepEqual(
    result.frames.map((frame) => frame.args[0]),
    ["1", "2"],
  );
});

test("marks only the frame that threw", () => {
  const result = traceCalls("(defun g () (car 1)) (defun f () (g)) (f)");
  const outer = result.frames[0];
  const inner = outer?.children[0];

  assert.equal(result.failed, "type-error");
  assert.equal(inner?.error, "type-error");
  assert.equal(inner?.result, undefined);
  assert.equal(outer?.error, undefined);
  assert.equal(outer?.result, undefined);
});

test("reports the budget for a runaway loop", () => {
  const result = traceCalls("(dotimes (i 100000000) 1)");

  assert.equal(result.unavailable, "budget");
});

test("reports unparsed source", () => {
  const result = traceCalls("(defun f");

  assert.equal(result.unavailable, "unparsed");
  assert.deepEqual(result.frames, []);
});

test("stops recording past the depth cap", () => {
  const result = traceCalls(
    "(defun r (n) (if (= n 0) 0 (r (- n 1)))) (r 90)",
  );

  assert.equal(result.truncated, true);
  assert.ok(result.frames.length === 1);
});

test("stops recording past the frame cap", () => {
  const result = traceCalls("(defun f () 1) (dotimes (i 1200) (f))");

  assert.equal(result.truncated, true);
  const recorded = result.frames.reduce(
    (total, frame) => total + 1 + frame.children.length,
    0,
  );
  assert.ok(recorded <= 1_000);
});

test("records nothing when only builtins are called", () => {
  const result = traceCalls("(car (list 1 2))");

  assert.deepEqual(result.frames, []);
  assert.equal(result.truncated, false);
});

test("survives a stray top-level return", () => {
  const result = traceCalls("(return 5) (defun f () 1) (f)");

  assert.deepEqual(result.frames, []);
  assert.equal(result.unavailable, undefined);
  assert.equal(result.failed, undefined);
});

test("nests a recursive call", () => {
  const result = traceCalls(
    "(defun fact (n) (if (= n 0) 1 (* n (fact (- n 1))))) (fact 3)",
  );

  assert.equal(result.frames[0]?.name, "FACT");
  assert.equal(depth(result.frames[0]!), 4);
});
