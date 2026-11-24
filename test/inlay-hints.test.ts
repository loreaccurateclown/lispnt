import { test } from "node:test";
import assert from "node:assert/strict";
import { createInlayHintsProvider } from "../src/extension/inlay-hints";
import type { VsRange, VsTextDocument } from "../src/extension/api";

// The provider is pure apart from the editor types, so it is tested against a
// document object that counts reads: the cache is the behaviour worth pinning.

interface FakeDocument extends Omit<VsTextDocument, "version"> {
  version: number;
  reads: number;
}

function documentOf(text: string, version = 1): FakeDocument {
  const document: FakeDocument = {
    uri: { fsPath: "/a.lisp", toString: () => "file:///a.lisp" },
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

test("paints the value a parameter had at the use that reads it", () => {
  const hints = createInlayHintsProvider(() => true).provideInlayHints(
    documentOf(SOURCE),
    EVERYTHING,
  );

  assert.deepEqual(hints, [{ position: { line: 0, character: 16 }, label: "X = 5" }]);
});

test("maps a hint on a later line to that line and column", () => {
  const source = "(defun f (x)\n  (* x 2))\n(f 5)";
  const hints = createInlayHintsProvider(() => true).provideInlayHints(
    documentOf(source),
    EVERYTHING,
  );

  assert.equal(hints.length, 1);
  assert.deepEqual(hints[0]?.position, { line: 1, character: 5 });
});

test("runs the file once per document version, not once per request", () => {
  const provider = createInlayHintsProvider(() => true);
  const document = documentOf(SOURCE);

  provider.provideInlayHints(document, EVERYTHING);
  provider.provideInlayHints(document, EVERYTHING);
  assert.equal(document.reads, 1);

  document.version = 2;
  provider.provideInlayHints(document, EVERYTHING);
  assert.equal(document.reads, 2);
});

test("returns nothing when the setting is off, and does not run the file", () => {
  const document = documentOf(SOURCE);
  const hints = createInlayHintsProvider(() => false).provideInlayHints(
    document,
    EVERYTHING,
  );

  assert.deepEqual(hints, []);
  assert.equal(document.reads, 0);
});

test("only answers for the lines the editor asked about", () => {
  const provider = createInlayHintsProvider(() => true);
  const later = provider.provideInlayHints(documentOf(SOURCE), {
    start: { line: 1, character: 0 },
    end: { line: 1, character: 10 },
  });

  assert.deepEqual(later, []);
});
