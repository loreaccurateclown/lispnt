import { test } from "node:test";
import assert from "node:assert/strict";
import { traceCases, type TraceCase } from "../src/core/trace-cases";
import { renderTrace } from "../src/core/trace";

//LLM-written tests
const FACT = "(defun fact (n) (if (= n 0) 1 (* n (fact (- n 1)))))";

function only(cases: TraceCase[]): TraceCase {
  assert.equal(cases.length, 1, `expected one case, got ${cases.length}`);
  return cases[0]!;
}

function rendered(testCase: TraceCase): string {
  assert.ok(testCase.trace !== null, "expected a trace");
  if (testCase.limit === undefined) return renderTrace(testCase.trace);
  return renderTrace(testCase.trace, { limit: testCase.limit });
}

test("finds a case written after the marker", () => {
  const cases = traceCases(`;;[trace] (fact 4)\n${FACT}`);

  assert.equal(only(cases).status, "ok");
  assert.equal(only(cases).expression, "(fact 4)");
});

test("traces the commented call with its nested calls", () => {
  const cases = traceCases(`;;[trace] (fact 4)\n${FACT}`);

  assert.equal(
    rendered(only(cases)),
    [
      "root: 0: FACT(4) => 24",
      "  1: FACT(3) => 6",
      "    2: FACT(2) => 2",
      "      3: FACT(1) => 1",
      "        max depth: 4: FACT(0) => 1",
      "5 calls · max depth: 4 · final value: 24",
    ].join("\n"),
  );
});

test("traces the case only, not the file's own top-level calls", () => {
  const cases = traceCases(`${FACT}\n(fact 2)\n;;[trace] (fact 3)`);

  assert.equal(rendered(only(cases)).split("\n").length, 5);
  assert.match(rendered(only(cases)), /^root: 0: FACT\(3\) => 6/);
});

test("gives each of two markers its own trace", () => {
  const cases = traceCases(
    `;;[trace] (fact 2)\n;;[trace] (fact 3)\n${FACT}`,
  );

  assert.equal(cases.length, 2);
  assert.match(rendered(cases[0]!), /^root: 0: FACT\(2\) => 2/);
  assert.match(rendered(cases[1]!), /^root: 0: FACT\(3\) => 6/);
});

test("accepts a space inside the brackets and around them", () => {
  const cases = traceCases(`;; [ trace ] (fact 1)\n${FACT}`);

  assert.equal(only(cases).status, "ok");
});

test("accepts an uppercase marker", () => {
  const cases = traceCases(`;;[TRACE] (fact 1)\n${FACT}`);

  assert.equal(only(cases).status, "ok");
});

test("accepts leading whitespace before the comment", () => {
  const cases = traceCases(`   ;;[trace] (fact 1)\n${FACT}`);

  assert.equal(only(cases).status, "ok");
});

test("marks text that is not a form as unreadable", () => {
  const cases = traceCases(`;;[trace] (fact\n${FACT}`);

  assert.equal(only(cases).status, "unreadable");
  assert.equal(only(cases).trace, null);
});

test("marks an empty marker as unreadable", () => {
  const cases = traceCases(`;;[trace]\n${FACT}`);

  assert.equal(only(cases).status, "unreadable");
});

test("finds nothing when there is no marker", () => {
  assert.deepEqual(traceCases(FACT), []);
});

test("ignores a marker inside a block comment", () => {
  assert.deepEqual(traceCases(`#| ;;[trace] (fact 1) |#\n${FACT}`), []);
});

test("reports the line of the marker", () => {
  const cases = traceCases(`${FACT}\n\n;;[trace] (fact 1)`);

  assert.equal(only(cases).line, 3);
});

test("does not let one case see another's mutation", () => {
  const source = [
    "(defparameter *x* 1)",
    "(defun get-x () *x*)",
    ";;[trace] (progn (setq *x* 99) (get-x))",
    ";;[trace] (get-x)",
  ].join("\n");
  const cases = traceCases(source);

  assert.equal(
    rendered(cases[0]!),
    "root: 0: GET-X() => 99\n1 call · max depth: 0 · final value: 99",
  );
  assert.equal(
    rendered(cases[1]!),
    "root: 0: GET-X() => 1\n1 call · max depth: 0 · final value: 1",
  );
});

test("reports a call to a function the file never defines", () => {
  const cases = traceCases(`;;[trace] (missing 1)\n${FACT}`);
  const trace = only(cases).trace;

  assert.equal(trace?.failed, "undefined-function");
});

test("still traces when the file itself does not parse", () => {
  const cases = traceCases(";;[trace] (fact 1)\n(defun fact (n) (if (= n 0) 1 (* n (fact (- n 1)))");

  assert.equal(only(cases).status, "ok");
  assert.equal(only(cases).trace?.failed, "undefined-function");
});

test("reads a per-level limit from the marker", () => {
  const cases = traceCases(`;;[trace:2] (fact 4)\n${FACT}`);

  assert.equal(only(cases).status, "ok");
  assert.equal(only(cases).expression, "(fact 4)");
  assert.equal(only(cases).limit, 2);
});

test("reads all from the marker", () => {
  const cases = traceCases(`;;[trace:all] (fact 4)\n${FACT}`);

  assert.equal(only(cases).limit, "all");
});

test("leaves the limit off a marker that names none", () => {
  const cases = traceCases(`;;[trace] (fact 4)\n${FACT}`);

  assert.equal(only(cases).limit, undefined);
});

test("tolerates spaces and case inside a limited marker", () => {
  const cases = traceCases(`;; [ TRACE : 3 ] (fact 4)\n${FACT}`);

  assert.equal(only(cases).status, "ok");
  assert.equal(only(cases).limit, 3);
});

test("marks a limit it cannot read as unreadable", () => {
  const cases = traceCases(`;;[trace:x] (fact 4)\n${FACT}`);

  assert.equal(only(cases).status, "unreadable");
  assert.equal(only(cases).trace, null);
});

test("renders a case at the limit the marker asked for", () => {
  const source = [
    "(defun f (x) x)",
    "(defun top () (f 1) (f 2) (f 3) (f 4))",
    ";;[trace:1] (top)",
  ].join("\n");

  assert.equal(
    rendered(only(traceCases(source))),
    [
      "root: 0: TOP() => 4",
      "  max depth: 1: F(1) => 1",
      "  … 2 more calls hidden",
      "  max depth: 1: F(4) => 4",
      "5 calls · max depth: 1 · final value: 4",
    ].join("\n"),
  );
});
