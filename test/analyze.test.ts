import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/core/analyze";

//LLM-written tests
test("returns no diagnostics for a file with multiple valid forms", () => {
  assert.deepEqual(analyze("(a) (b)"), []);
});

test("returns no diagnostics for empty input", () => {
  // note: parse("") throws empty-input; parseAll("") is simply no forms
  assert.deepEqual(analyze(""), []);
});

test("returns no diagnostics for comments only", () => {
  assert.deepEqual(analyze("; only"), []);
});

test("reports a stray closer with a learner-facing message", () => {
  const diagnostics = analyze(")");

  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0], {
    code: "stray-closer",
    severity: "error",
    message: "Unexpected ')': nothing is open here",
    position: { line: 1, column: 1, offset: 0 },
  });
});

test("reports an unterminated list at the paren on its own line", () => {
  const diagnostics = analyze("(a)\n(b");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "unterminated-list");
  assert.deepEqual(diagnostics[0]?.position, { line: 2, column: 1, offset: 4 });
});

test("reports an error that occurs after a valid first form", () => {
  const diagnostics = analyze("(a))");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "stray-closer");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 4, offset: 3 });
});

test("reports one diagnostic per stray closer", () => {
  const diagnostics = analyze(") ) )");

  assert.equal(diagnostics.length, 3);
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["stray-closer", "stray-closer", "stray-closer"],
  );
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.position.offset),
    [0, 2, 4],
  );
});

test("keeps recovering after a valid form", () => {
  const diagnostics = analyze("()))))");

  assert.equal(diagnostics.length, 4);
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.position.offset),
    [2, 3, 4, 5],
  );
});

//LLM-written tests
test("reports a defun whose name is not a symbol", () => {
  const diagnostics = analyze("(defun 1 (x) x)");

  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0], {
    code: "defun-name",
    severity: "error",
    message: "A defun needs a name symbol here.",
    position: { line: 1, column: 8, offset: 7 },
  });
});

test("reports a defun without an argument list", () => {
  const diagnostics = analyze("(defun foo x)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "defun-arglist");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 12, offset: 11 });
});

test("reports a lambda without an argument list", () => {
  const diagnostics = analyze("(lambda 1)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "lambda-arglist");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 9, offset: 8 });
});

test("reports a let without a bindings list", () => {
  const diagnostics = analyze("(let 1 2)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "let-bindings");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 6, offset: 5 });
});

test("reports a let* without a bindings list", () => {
  const diagnostics = analyze("(let* 1 2)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "let-bindings");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 7, offset: 6 });
});

test("ignores a malformed form inside a quote", () => {
  assert.deepEqual(analyze("'(defun 1 (x) x)"), []);
});

test("ignores a malformed form inside a vector literal", () => {
  assert.deepEqual(analyze("#(defun 1 (x) x)"), []);
});

test("accepts a defun with no body", () => {
  assert.deepEqual(analyze("(defun f ())"), []);
});

test("accepts a let with a bare symbol binding", () => {
  assert.deepEqual(analyze("(let (x) x)"), []);
});

test("finds a malformed form nested inside a valid one", () => {
  const diagnostics = analyze("(defun foo (x) (let 1 2))");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "let-bindings");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 21, offset: 20 });
});
