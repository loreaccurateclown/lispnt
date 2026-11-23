import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectHints,
  formatHint,
  formatLine,
  type ValueHint,
} from "../src/core/hints";

//LLM-written tests
function texts(hints: ValueHint[]): string[] {
  return hints.map(formatHint);
}

function expectHint(hint: ValueHint | null): ValueHint {
  assert.ok(hint !== null, "expected a hint");
  return hint;
}

function lines(source: string, line: number): string[] {
  return texts(collectHints(source).hintsForLine(line));
}

test("shows a parameter's value inside a body that ran", () => {
  const source = "(defun double (x) (* x 2))\n(double 5)";

  assert.deepEqual(lines(source, 1), ["X = 5"]);
});

test("shows a global's value on the line that uses it", () => {
  const source = "(defparameter n 5)\n(* n 2)";

  assert.deepEqual(lines(source, 2), ["N = 5"]);
});

test("gives one hint when a line uses the same name twice", () => {
  const source = "(defparameter n 5)\n(+ n n)";
  const hints = collectHints(source).hintsForLine(2);

  assert.equal(hints.length, 1);
  assert.equal(hints[0]?.name, "N");
});

test("skips a function head", () => {
  const source = "(defparameter n 5)\n(print n)";

  assert.deepEqual(lines(source, 2), ["N = 5"]);
});

test("skips a keyword", () => {
  const source = "(defparameter n 5)\n(list :key n)";

  assert.deepEqual(lines(source, 2), ["N = 5"]);
});

test("gives nothing inside a function that was never called", () => {
  const source = "(defun lonely (x) (* x 2))";

  assert.deepEqual(lines(source, 1), []);
});

test("finds the name under an offset and nothing outside it", () => {
  const source = "(defparameter n 5)\n(* n 2)";
  const run = collectHints(source);

  assert.equal(formatHint(expectHint(run.hintAt(source.indexOf("n 2")))), "N = 5");
  assert.equal(run.hintAt(source.indexOf("(*")), null);
});

test("reports a budget stop and still answers covered lines", () => {
  const source =
    "(defparameter n 5)\n(* n 2)\n(dotimes (i 100000000) 1)";
  const run = collectHints(source);

  assert.equal(run.unavailable, "budget");
  assert.deepEqual(texts(run.hintsForLine(2)), ["N = 5"]);
});

test("shows a let binding inside its body", () => {
  const source = "(let ((y 2)) (* y 3))";

  assert.deepEqual(lines(source, 1), ["Y = 2"]);
});

test("shows the most recent call's value when a body runs twice", () => {
  const source = "(defun double (x) (* x 2))\n(double 3)\n(double 4)";

  assert.deepEqual(lines(source, 1), ["X = 4"]);
});

test("ignores quoted data", () => {
  const source = "(defparameter n 5)\n'(n)";

  assert.deepEqual(lines(source, 2), []);
});

test("gives nothing for a name the snapshot does not hold", () => {
  const source = "(+ n 2)\n(defparameter n 5)";

  assert.deepEqual(lines(source, 1), []);
});

test("formats one hint as name equals value", () => {
  assert.equal(
    formatHint({ name: "X", line: 1, offset: 0, text: "5" }),
    "X = 5",
  );
});

test("formats a line by joining its hints", () => {
  const hints: ValueHint[] = [
    { name: "X", line: 1, offset: 0, text: "5" },
    { name: "Y", line: 1, offset: 4, text: "\"hi\"" },
  ];

  assert.equal(formatLine(hints), 'X = 5, Y = "hi"');
});

test("shortens a long value when a smaller element limit is given", () => {
  const source = "(defparameter l (list 1 2 3 4 5 6))\n(length l)";
  const run = collectHints(source, { maxElements: 2 });

  assert.deepEqual(texts(run.hintsForLine(2)), ["L = (1 2 ...)"]);
});

test("keeps the default element limit without options", () => {
  const source = "(defparameter l (list 1 2 3 4 5 6))\n(length l)";

  assert.deepEqual(lines(source, 2), ["L = (1 2 3 4 5 6)"]);
});

test("returns one entry per requested line", () => {
  const source = "(defparameter n 5)\n(* n 2)\n(defparameter m 3)";
  const range = collectHints(source).hintsInLines(1, 3);

  assert.equal(range.length, 3);
  assert.deepEqual(texts(range[1] ?? []), ["N = 5"]);
});

test("returns empty entries for an empty range", () => {
  const source = "(defparameter n 5)";

  assert.deepEqual(collectHints(source).hintsInLines(3, 1), []);
});

test("does not share print options between two runs", () => {
  const source = "(defparameter l (list 1 2 3 4))\n(length l)";
  const narrow = collectHints(source, { maxElements: 2 });
  const wide = collectHints(source);

  assert.deepEqual(texts(narrow.hintsForLine(2)), ["L = (1 2 ...)"]);
  assert.deepEqual(texts(wide.hintsForLine(2)), ["L = (1 2 3 4)"]);
});
