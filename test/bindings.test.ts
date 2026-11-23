import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bindingsAt,
  recordBindings,
  snapshotAt,
  type BindingSnapshot,
  type BindingsResult,
  type BindingsRun,
} from "../src/core/bindings";
import type { LispValue } from "../src/core/values";

//LLM-written tests
function num(value: number): LispValue {
  return { kind: "number", value };
}

function at(source: string, marker: string): number {
  const offset = source.indexOf(marker);
  assert.notEqual(offset, -1, `marker ${marker} is not in the source`);
  return offset;
}

function expectSnapshot(result: BindingsResult): BindingSnapshot {
  assert.ok(result.snapshot !== null, "expected a snapshot");
  return result.snapshot;
}

function snap(
  start: number,
  end: number,
  bindings: Map<string, LispValue> = new Map(),
): BindingSnapshot {
  return { start, end, bindings };
}

test("holds the value a defparameter gave a top-level name", () => {
  const source = "(defparameter x 5)";
  const result = bindingsAt(source, source.length);

  assert.equal(result.unavailable, undefined);
  assert.deepEqual(expectSnapshot(result).bindings.get("X"), num(5));
});

test("holds a let binding inside its body", () => {
  const source = "(let ((y 2)) (+ y 1))";
  const result = bindingsAt(source, at(source, "(+"));

  assert.deepEqual(expectSnapshot(result).bindings.get("Y"), num(2));
});

test("holds a function parameter inside the call", () => {
  const source = "(defun f (x) (* x 2)) (f 5)";
  const result = bindingsAt(source, at(source, "(*"));

  assert.deepEqual(expectSnapshot(result).bindings.get("X"), num(5));
});

test("keeps a global visible inside a call", () => {
  const source = "(defparameter g 10) (defun f (x) (* x 2)) (f 5)";
  const bindings = expectSnapshot(
    bindingsAt(source, at(source, "(*")),
  ).bindings;

  assert.deepEqual(bindings.get("G"), num(10));
  assert.deepEqual(bindings.get("X"), num(5));
});

test("leaves builtins out of the bindings", () => {
  const source = "(defun f (x) (* x 2)) (f 5)";
  const bindings = expectSnapshot(
    bindingsAt(source, at(source, "(*")),
  ).bindings;

  assert.equal(bindings.has("CAR"), false);
  assert.equal(bindings.has("+"), false);
  assert.equal(bindings.has("*"), false);
});

test("leaves T and NIL out of the bindings", () => {
  const source = "(defparameter x 5)";
  const bindings = expectSnapshot(bindingsAt(source, source.length)).bindings;

  assert.equal(bindings.has("T"), false);
  assert.equal(bindings.has("NIL"), false);
});

test("returns no snapshot for an empty file", () => {
  const result = bindingsAt("", 0);

  assert.equal(result.snapshot, null);
  assert.equal(result.unavailable, undefined);
});

test("reports an unparsed file instead of evaluating it", () => {
  const result = bindingsAt("(defun f", 0);

  assert.equal(result.snapshot, null);
  assert.equal(result.unavailable, "unparsed");
});

test("reports the budget when a form runs too long", () => {
  const result = bindingsAt("(dotimes (i 100000000) 1)", 0);

  assert.equal(result.snapshot, null);
  assert.equal(result.unavailable, "budget");
});

test("stops recording at the snapshot limit and says so", () => {
  const source = "(dotimes (i 30000) (defparameter x i))";
  const result = bindingsAt(source, at(source, "(defparameter"));

  assert.equal(result.unavailable, "truncated");
  assert.deepEqual(expectSnapshot(result).bindings.get("X"), num(19999));
});

test("refuses the fallback once the snapshot limit was reached", () => {
  const source = "(dotimes (i 30000) (defparameter x i))";
  const result = bindingsAt(source, source.length);

  assert.equal(result.snapshot, null);
  assert.equal(result.unavailable, "truncated");
});

test("skips an unimplemented form and keeps going", () => {
  const source = "(loop) (defparameter x 5)";
  const result = bindingsAt(source, source.length);

  assert.equal(result.unavailable, undefined);
  assert.deepEqual(expectSnapshot(result).bindings.get("X"), num(5));
});

test("skips a form that fails and keeps the values before it", () => {
  const source = "(defparameter a 1) (foo 1)";
  const result = bindingsAt(source, source.length);

  assert.equal(result.unavailable, undefined);
  assert.deepEqual(expectSnapshot(result).bindings.get("A"), num(1));
});

test("shows the most recent call when ranges repeat", () => {
  const source = "(defun f (x) (* x 2)) (f 3) (f 4)";
  const result = bindingsAt(source, at(source, "(*"));

  assert.deepEqual(expectSnapshot(result).bindings.get("X"), num(4));
});

test("falls back to the last finished form when nothing contains the offset", () => {
  const source = "(defparameter x 5) ";
  const result = bindingsAt(source, source.length);

  assert.deepEqual(expectSnapshot(result).bindings.get("X"), num(5));
});

test("does not fall back past a budget stop", () => {
  const source = "(defparameter a 1) (dotimes (i 100000000) 1)";
  const result = bindingsAt(source, source.length);

  assert.equal(result.snapshot, null);
  assert.equal(result.unavailable, "budget");
});

test("keeps going after several failing forms", () => {
  const source = "(foo 1) (bar 2) (defparameter x 5)";
  const result = bindingsAt(source, source.length);

  assert.equal(result.unavailable, undefined);
  assert.deepEqual(expectSnapshot(result).bindings.get("X"), num(5));
});

test("records nothing for a form that failed", () => {
  const result = bindingsAt("(foo 1)", 0);

  assert.equal(result.snapshot, null);
  assert.equal(result.unavailable, undefined);
});

test("records one snapshot per evaluated list form", () => {
  const run = recordBindings("(defparameter x 5)");

  assert.equal(run.unavailable, undefined);
  assert.equal(run.snapshots.length, 1);
});

test("finds the snapshot whose range contains the offset", () => {
  const first = snap(0, 10);
  const second = snap(20, 30);
  const run: BindingsRun = { snapshots: [first, second] };

  assert.equal(snapshotAt(run, 5), first);
});

test("prefers the later of two identical ranges", () => {
  const early = snap(0, 10);
  const late = snap(0, 10);
  const run: BindingsRun = { snapshots: [early, late] };

  assert.equal(snapshotAt(run, 5), late);
});

test("falls back to the last finished snapshot on a complete run", () => {
  const only = snap(0, 10);
  const run: BindingsRun = { snapshots: [only] };

  assert.equal(snapshotAt(run, 15), only);
});

test("refuses the fallback when the run stopped early", () => {
  const only = snap(0, 10);
  const run: BindingsRun = { snapshots: [only], unavailable: "budget" };

  assert.equal(snapshotAt(run, 15), null);
});

test("returns null for a run with no snapshots", () => {
  assert.equal(snapshotAt({ snapshots: [] }, 0), null);
});
