import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyze } from "../src/core/analyze";
import { CONSTANTS } from "../src/core/constants";
import { createEnv, evaluate } from "../src/core/interpreter";
import { parse, parseAll } from "../src/core/reader";
import type { LispValue } from "../src/core/values";

const fixture = readFileSync(
  join(process.cwd(), "fixtures", "constants", "sbcl-constants.lisp"),
  "utf8",
);

function value(source: string, env = createEnv(null)): LispValue {
  return evaluate(parse(source), env);
}

function numeric(source: string): number {
  const found = value(source);
  assert.equal(found.kind, "number", source);
  if (found.kind !== "number") throw new Error(source);
  return found.value;
}

test("the constants table has the sixty ANSI and nine SB-EXT names", () => {
  assert.equal(CONSTANTS.size, 69);
  assert.ok(CONSTANTS.has("PI"));
  assert.ok(CONSTANTS.has("LAMBDA-LIST-KEYWORDS"));
  assert.ok(CONSTANTS.has("SB-EXT:MOST-POSITIVE-WORD"));
  assert.ok(!CONSTANTS.has("MOST-POSITIVE-WORD"));
});

test("the constants fixture analyses with no diagnostics", () => {
  assert.deepEqual(analyze(fixture), []);
});

test("every form in the constants fixture evaluates", () => {
  const env = createEnv(null);
  const forms = parseAll(fixture);

  assert.equal(forms.length, 71);
  for (const form of forms) evaluate(form, env);
});

test("PI is the double the image reports", () => {
  const found = value("pi");

  assert.equal(found.kind, "number");
  assert.equal(found.kind === "number" && found.float, true);
  assert.ok(Math.abs(numeric("pi") - Math.PI) < 1e-15);
});

test("the integer constants carry the image's values", () => {
  assert.equal(numeric("boole-xor"), 8);
  assert.equal(numeric("boole-and"), 6);
  assert.equal(numeric("char-code-limit"), 1_114_112);
  assert.equal(numeric("array-rank-limit"), 129);
  assert.equal(numeric("array-dimension-limit"), 35_184_372_088_832);
  assert.equal(numeric("internal-time-units-per-second"), 1_000_000);
  assert.equal(numeric("call-arguments-limit"), 1_073_741_824);
});

test("the large integer constants survive as approximate doubles", () => {
  // 2^62 - 1 and 2^64 - 1 are past 2^53; the literals round the same way SBCL's
  // values round when they enter JavaScript.
  assert.equal(numeric("most-positive-fixnum"), 4_611_686_018_427_387_903);
  assert.equal(
    numeric("sb-ext:most-positive-word"),
    18_446_744_073_709_551_615,
  );
});

test("the SB-EXT infinities are JavaScript infinities", () => {
  assert.equal(numeric("sb-ext:double-float-positive-infinity"), Infinity);
  assert.equal(numeric("sb-ext:double-float-negative-infinity"), -Infinity);
});

test("LAMBDA-LIST-KEYWORDS is the nine-symbol list in SBCL's order", () => {
  const names: string[] = [];
  let current = value("lambda-list-keywords");
  while (current.kind === "cons") {
    assert.equal(current.car.kind, "symbol");
    if (current.car.kind !== "symbol") break;
    names.push(current.car.name);
    current = current.cdr;
  }

  assert.deepEqual(names, [
    "&ALLOW-OTHER-KEYS",
    "&AUX",
    "&BODY",
    "&ENVIRONMENT",
    "&KEY",
    "SB-INT:&MORE",
    "&OPTIONAL",
    "&REST",
    "&WHOLE",
  ]);
});

test("a function using PI analyses clean and computes", () => {
  assert.deepEqual(analyze("(defun area (r) (* pi r r))"), []);

  const env = createEnv(null);
  evaluate(parse("(defun area (r) (* pi r r))"), env);
  const area = evaluate(parse("(area 2)"), env);
  assert.equal(area.kind, "number");
  assert.ok(Math.abs((area.kind === "number" ? area.value : 0) - 12.566) < 0.001);
});

test("the SB-EXT names need their package prefix", () => {
  assert.deepEqual(
    analyze("(defun f () sb-ext:most-positive-word)"),
    [],
  );
  assert.deepEqual(
    analyze("(defun f () most-positive-word)").map((found) => found.code),
    ["unbound-variable"],
  );
});
