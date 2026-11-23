import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPLAIN_TRACE,
  renderTrace,
  traceCalls,
  type TraceFrame,
} from "../src/core/trace";

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

test("records the value the run returned", () => {
  const result = traceCalls("(defun f (x) x) (f 1) (f 2)");

  assert.equal(result.finalValue, "2");
});

test("records no final value for a run that failed", () => {
  const result = traceCalls("(defun g () (car 1)) (defun f () (g)) (f)");

  assert.equal(result.finalValue, undefined);
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

test("renders a single frame with its result", () => {
  assert.equal(
    renderTrace(traceCalls("(defun f (x) (* x 2)) (f 5)")),
    "root: 0: F(5) => 10\n1 call · max depth: 0 · final value: 10",
  );
});

test("indents a child by two spaces", () => {
  const text = renderTrace(
    traceCalls("(defun g (x) x) (defun f (x) (g x)) (f 5)"),
  );

  assert.equal(
    text,
    "root: 0: F(5) => 5\n  max depth: 1: G(5) => 5\n" +
      "2 calls · max depth: 1 · final value: 5",
  );
});

test("joins several arguments with a comma", () => {
  const text = renderTrace(
    traceCalls("(defun add (a b) (+ a b)) (add 1 2)"),
  );

  assert.equal(
    text,
    "root: 0: ADD(1, 2) => 3\n1 call · max depth: 0 · final value: 3",
  );
});

test("marks the failing frame with its error code", () => {
  const text = renderTrace(
    traceCalls("(defun g () (car 1)) (defun f () (g)) (f)"),
  );

  assert.equal(
    text,
    "root: 0: F()\n  max depth: 1: G() !! type-error\n" +
      "2 calls · max depth: 1\n… stopped: type-error",
  );
});

test("shows the truncation footer", () => {
  const text = renderTrace(
    traceCalls("(defun r (n) (if (= n 0) 0 (r (- n 1)))) (r 90)"),
  );

  assert.match(text, /… trace truncated/);
});

test("shows the budget footer", () => {
  assert.equal(
    renderTrace(traceCalls("(dotimes (i 100000000) 1)")),
    "… stopped: budget",
  );
});

test("renders nothing for an empty trace", () => {
  assert.equal(renderTrace(traceCalls("(car (list 1 2))")), "");
});

test("renders several roots on consecutive lines", () => {
  const text = renderTrace(traceCalls("(defun f (x) x) (f 1) (f 2)"));

  assert.equal(
    text,
    "root: 0: F(1) => 1\nroot: 0: F(2) => 2\n" +
      "2 calls · max depth: 0 · final value: 2",
  );
});

test("labels the root line", () => {
  const text = renderTrace(traceCalls("(defun f (x) x) (f 5)"));

  assert.match(text, /^root: 0: F\(5\)/);
});

test("labels every entry line at the deepest level", () => {
  const text = renderTrace(
    traceCalls("(defun f (x) x) (defun top () (f 1) (f 2) (f 3)) (top)"),
  );

  assert.equal(text.match(/max depth: 1: /g)?.length, 3);
});

test("leaves the levels between the root and the deepest one bare", () => {
  const text = renderTrace(
    traceCalls(
      "(defun fact (n) (if (= n 0) 1 (* n (fact (- n 1))))) (fact 3)",
    ),
  );

  assert.match(text, /\n  1: FACT\(2\) => 2\n/);
  assert.match(text, /\n {6}max depth: 3: FACT\(0\) => 1\n/);
});

test("counts the calls, the depth and the value in the summary", () => {
  const text = renderTrace(
    traceCalls(
      "(defun fact (n) (if (= n 0) 1 (* n (fact (- n 1))))) (fact 3)",
    ),
  );

  assert.match(text, /\n4 calls · max depth: 3 · final value: 6$/);
});

test("renders a recursive trace label by label", () => {
  const text = renderTrace(
    traceCalls(
      "(defun fib (n) (if (< n 2) n (+ (fib (- n 1)) (fib (- n 2))))) (fib 3)",
    ),
  );

  assert.equal(
    text,
    [
      "root: 0: FIB(3) => 2",
      "  1: FIB(2) => 1",
      "    max depth: 2: FIB(1) => 1",
      "    max depth: 2: FIB(0) => 0",
      "  1: FIB(1) => 1",
      "5 calls · max depth: 2 · final value: 2",
    ].join("\n"),
  );
});

test("marks a depth that a cap cut short", () => {
  const text = renderTrace(
    traceCalls("(defun r (n) (if (= n 0) 0 (r (- n 1)))) (r 90)"),
  );

  assert.match(text, /max depth: 63 \(limit reached\): R\(27\)/);
  assert.match(text, /64 calls · max depth: 63 \(limit reached\)/);
});

test("hides the middle of a wide level and keeps the last entry", () => {
  const text = renderTrace(
    traceCalls("(defun f (x) x) (defun top () (f 1) (f 2) (f 3) (f 4)) (top)"),
    { limit: 1 },
  );

  assert.equal(
    text,
    [
      "root: 0: TOP() => 4",
      "  max depth: 1: F(1) => 1",
      "  … 2 more calls hidden",
      "  max depth: 1: F(4) => 4",
      "5 calls · max depth: 1 · final value: 4",
    ].join("\n"),
  );
});

test("keeps the first and last entry when a level is wider than the limit", () => {
  const text = renderTrace(
    traceCalls("(defun f (x) x) (defun top () (f 1) (f 2) (f 3) (f 4)) (top)"),
    { limit: 2 },
  );

  assert.match(text, /F\(1\) => 1\n  max depth: 1: F\(2\) => 2\n  … 1 more call hidden/);
  assert.match(text, /F\(4\) => 4/);
});

test("shows a level narrower than the limit in full", () => {
  const text = renderTrace(
    traceCalls("(defun f (x) x) (defun top () (f 1) (f 2)) (top)"),
    { limit: 2 },
  );

  assert.doesNotMatch(text, /hidden/);
});

test("shows every call with all", () => {
  const text = renderTrace(
    traceCalls("(defun f (x) x) (defun top () (f 1) (f 2) (f 3) (f 4)) (top)"),
    { limit: "all" },
  );

  assert.doesNotMatch(text, /hidden/);
  assert.equal(text.match(/max depth: 1: /g)?.length, 4);
});

test("hides nothing at the default limit for a small trace", () => {
  const text = renderTrace(
    traceCalls("(defun f (x) x) (defun top () (f 1) (f 2)) (top)"),
  );

  assert.doesNotMatch(text, /hidden/);
});

test("treats a limit below one as one", () => {
  const text = renderTrace(
    traceCalls("(defun f (x) x) (defun top () (f 1) (f 2) (f 3)) (top)"),
    { limit: 0 },
  );

  assert.match(text, /F\(1\) => 1\n  … 1 more call hidden\n  max depth: 1: F\(3\) => 3/);
});

test("leaves the explanation out by default", () => {
  const text = renderTrace(traceCalls("(defun f (x) x) (f 5)"));

  assert.ok(!text.includes(EXPLAIN_TRACE));
});

test("appends the explanation after a blank line when asked", () => {
  const text = renderTrace(traceCalls("(defun f (x) x) (f 5)"), {
    explain: true,
  });

  assert.equal(
    text,
    "root: 0: F(5) => 5\n1 call · max depth: 0 · final value: 5\n\n" +
      EXPLAIN_TRACE,
  );
});

test("explains an empty trace without a summary to explain", () => {
  assert.equal(
    renderTrace(traceCalls("(car (list 1 2))"), { explain: true }),
    EXPLAIN_TRACE,
  );
});

test("explains a failed trace below its footer", () => {
  const text = renderTrace(
    traceCalls("(defun g () (car 1)) (defun f () (g)) (f)"),
    { explain: true },
  );

  assert.match(text, /… stopped: type-error\n\nThis is a summary/);
});
