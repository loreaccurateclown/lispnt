import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_MARKERS_MESSAGE, traceTree } from "../src/extension/trace-tree";
import type { TraceNode } from "../src/extension/trace-tree";

const FACT = "(defun fact (n) (if (= n 0) 1 (* n (fact (1- n)))))";

function rootsOf(source: string): readonly TraceNode[] {
  const view = traceTree(source);
  assert.equal(view.kind, "tree");
  return view.kind === "tree" ? view.roots : [];
}

test("says so when a file has no markers", () => {
  assert.deepEqual(traceTree(FACT), {
    kind: "empty",
    message: NO_MARKERS_MESSAGE,
  });
});

test("builds one root per marked call, labelled with the call and its line", () => {
  const roots = rootsOf(`${FACT}\n;;[trace] (fact 3)`);

  assert.equal(roots.length, 1);
  assert.equal(roots[0]?.label, "(fact 3)");
  assert.equal(roots[0]?.description, "line 2");
  assert.equal(roots[0]?.state, "expanded");
});

test("maps a frame to a node with its result and a lazy collapsible state", () => {
  const roots = rootsOf(`${FACT}\n;;[trace] (fact 3)`);
  const top = roots[0]?.children[0];

  assert.equal(top?.label, "FACT(3)");
  assert.equal(top?.description, "= 6");
  assert.equal(top?.state, "collapsed");
  assert.equal(top?.children[0]?.label, "FACT(2)");
});

test("gives a leaf no children and no chevron", () => {
  const roots = rootsOf(`${FACT}\n;;[trace] (fact 3)`);
  const deepest =
    roots[0]?.children[0]?.children[0]?.children[0]?.children[0];

  assert.equal(deepest?.label, "FACT(0)");
  assert.equal(deepest?.state, "none");
  assert.deepEqual(deepest?.children, []);
});

test("marks a frame that threw with the error code", () => {
  const roots = rootsOf("(defun head-of (x) (car x))\n;;[trace] (head-of 1)");
  const frame = roots[0]?.children[0];

  assert.equal(frame?.description, "!! type-error");
  assert.equal(frame?.tone, "error");
});

test("summarises the trace for the view message", () => {
  const view = traceTree(`${FACT}\n;;[trace] (fact 3)`);
  assert.equal(view.kind, "tree");
  if (view.kind !== "tree") return;

  assert.match(view.message, /4 calls/);
  assert.match(view.message, /max depth: 3/);
  assert.match(view.message, /final value: 6/);
});

test("keeps an unreadable marker visible instead of dropping it", () => {
  const view = traceTree(";;[trace] (oops");
  assert.equal(view.kind, "tree");
  if (view.kind !== "tree") return;

  assert.equal(view.roots.length, 1);
  assert.equal(view.roots[0]?.label, "(oops");
  assert.match(view.roots[0]?.description ?? "", /could not be read/);
  assert.match(view.message, /could not be read/);
});

test("lists two marked calls as siblings", () => {
  const view = traceTree(`${FACT}\n;;[trace] (fact 3)\n;;[trace] (fact 4)`);
  assert.equal(view.kind, "tree");
  if (view.kind !== "tree") return;

  assert.deepEqual(
    view.roots.map((root) => root.label),
    ["(fact 3)", "(fact 4)"],
  );
  // Two summaries, so either case can be compared at a glance.
  assert.match(view.message, /4 calls/);
  assert.match(view.message, /final value: 6/);
  assert.match(view.message, /5 calls/);
  assert.match(view.message, /final value: 24/);
});

test("shows a truncated trace ending in a leaf that says so", () => {
  const source =
    "(defun down (n) (if (= n 0) 1 (down (1- n))))\n;;[trace] (down 1200)";
  const roots = rootsOf(source);
  const last = roots[0]?.children.at(-1);

  assert.equal(last?.tone, "truncated");
  assert.equal(last?.label, "recording stopped at the frame limit");
});
