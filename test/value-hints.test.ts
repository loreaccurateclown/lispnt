import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHintRuns,
  createHoverProvider,
  createInlayHintsProvider,
} from "../src/extension/value-hints";
import type { VsRange, VsTextDocument } from "../src/extension/api";

// Both surfaces share one hint run, so the tests drive them through the same
// cache object and check what each one shows.

interface FakeDocument extends Omit<VsTextDocument, "version"> {
  version: number;
  reads: number;
}

function documentOf(
  text: string,
  path = "/a.lisp",
  version = 1,
): FakeDocument {
  const document: FakeDocument = {
    uri: { fsPath: path, toString: () => `file://${path}` },
    languageId: "lisp",
    version,
    reads: 0,
    getText: () => {
      document.reads += 1;
      return text;
    },
  };
  return document;
}

const EVERYTHING: VsRange = {
  start: { line: 0, character: 0 },
  end: { line: 50, character: 0 },
};

const SOURCE = "(defun f (x) (* x 2))\n(f 5)";

test("puts one hint at the end of the line, not inside the expression", () => {
  const hints = createInlayHintsProvider(
    createHintRuns(),
    () => true,
  ).provideInlayHints(documentOf(SOURCE), EVERYTHING);

  assert.deepEqual(hints, [
    { position: { line: 0, character: 21 }, label: "X = 5", paddingLeft: true },
  ]);
});

test("joins every value on a line into one hint", () => {
  const source = "(defun f (a b) (list a b))\n(f 1 2)";
  const hints = createInlayHintsProvider(
    createHintRuns(),
    () => true,
  ).provideInlayHints(documentOf(source), EVERYTHING);

  assert.equal(hints.length, 1);
  assert.equal(hints[0]?.label, "A = 1, B = 2");
  assert.equal(hints[0]?.position.character, source.split("\n")[0]?.length);
});

test("is off unless the file was switched on", () => {
  const hintList = createInlayHintsProvider(
    createHintRuns(),
    () => false,
  ).provideInlayHints(documentOf(SOURCE), EVERYTHING);

  assert.deepEqual(hintList, []);
});

test("switches on per file, not globally", () => {
  const on = new Set(["file:///a.lisp"]);
  const provider = createInlayHintsProvider(createHintRuns(), (document) =>
    on.has(document.uri.toString()),
  );

  assert.equal(
    provider.provideInlayHints(documentOf(SOURCE, "/a.lisp"), EVERYTHING).length,
    1,
  );
  assert.deepEqual(
    provider.provideInlayHints(documentOf(SOURCE, "/b.lisp"), EVERYTHING),
    [],
  );
});

test("only answers for the lines the editor asked about", () => {
  const provider = createInlayHintsProvider(createHintRuns(), () => true);
  const later = provider.provideInlayHints(documentOf(SOURCE), {
    start: { line: 1, character: 0 },
    end: { line: 1, character: 10 },
  });

  assert.deepEqual(later, []);
});

test("runs the file once per version, and runs the ;;[trace] calls", () => {
  const runs = createHintRuns();
  const document = documentOf("(defun d (x) (* x 2))\n;;[trace] (d 4)");
  const provider = createInlayHintsProvider(runs, () => true);

  const first = provider.provideInlayHints(document, EVERYTHING);
  provider.provideInlayHints(document, EVERYTHING);
  assert.equal(document.reads, 1);
  assert.deepEqual(first, [
    { position: { line: 0, character: 21 }, label: "X = 4", paddingLeft: true },
  ]);

  document.version = 2;
  provider.provideInlayHints(document, EVERYTHING);
  assert.equal(document.reads, 2);
});

test("hovering a name shows its value, with no toggle involved", () => {
  const hover = createHoverProvider(createHintRuns());

  assert.deepEqual(
    hover.provideHover(documentOf(SOURCE), { line: 0, character: 16 }),
    { contents: "X = 5" },
  );
  // The same document, not on a name.
  assert.equal(
    hover.provideHover(documentOf(SOURCE), { line: 0, character: 0 }),
    undefined,
  );
});

test("hovering a name with no value says nothing", () => {
  const hover = createHoverProvider(createHintRuns());

  assert.equal(
    hover.provideHover(documentOf("(defun g (y) y)"), { line: 0, character: 12 }),
    undefined,
  );
});
