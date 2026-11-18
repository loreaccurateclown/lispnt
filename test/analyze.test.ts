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
