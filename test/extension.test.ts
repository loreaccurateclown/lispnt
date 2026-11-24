import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { activateExtension, isLispDocument } from "../src/extension/activate";
import type {
  VsCodeApi,
  VsDiagnostic,
  VsDiagnosticCollection,
  VsDisposable,
  VsOutputChannel,
  VsTextDocument,
  VsUri,
} from "../src/extension/api";

// The extension wiring runs against this fake instead of the editor, which is the
// point of the seam: the only untested code is the adapter in src/extension.ts.
function uriOf(path: string): VsUri {
  return { fsPath: path, toString: () => `file:///${path}` };
}

function documentOf(
  path: string,
  text: string,
  languageId = "lisp",
): VsTextDocument {
  return { uri: uriOf(path), languageId, version: 1, getText: () => text };
}

interface FakeOptions {
  readonly enable?: boolean;
  readonly debounceMs?: number;
  readonly active?: VsTextDocument;
  readonly open?: VsTextDocument[];
}

interface Fake {
  readonly api: VsCodeApi;
  readonly context: { subscriptions: VsDisposable[] };
  readonly collections: string[];
  readonly channels: string[];
  readonly commands: Map<string, () => void>;
  readonly sets: Array<{ uri: VsUri; diagnostics: readonly VsDiagnostic[] }>;
  readonly deletes: VsUri[];
  readonly channelLines: string[];
  open(document: VsTextDocument): void;
  change(document: VsTextDocument): void;
  save(document: VsTextDocument): void;
  close(document: VsTextDocument): void;
}

function fakeApi(options: FakeOptions = {}): Fake {
  const collections: string[] = [];
  const channels: string[] = [];
  const commands = new Map<string, () => void>();
  const sets: Fake["sets"] = [];
  const deletes: VsUri[] = [];
  const channelLines: string[] = [];

  const openListeners: Array<(document: VsTextDocument) => void> = [];
  const changeListeners: Array<(event: { document: VsTextDocument }) => void> = [];
  const saveListeners: Array<(document: VsTextDocument) => void> = [];
  const closeListeners: Array<(document: VsTextDocument) => void> = [];

  const collection: VsDiagnosticCollection = {
    set: (uri, diagnostics) => sets.push({ uri, diagnostics }),
    delete: (uri) => deletes.push(uri),
    dispose: () => undefined,
  };
  const channel: VsOutputChannel = {
    appendLine: (text) => channelLines.push(text),
    dispose: () => undefined,
  };

  const api: VsCodeApi = {
    createOutputChannel: (name) => {
      channels.push(name);
      return channel;
    },
    createDiagnosticCollection: (name) => {
      collections.push(name);
      return collection;
    },
    registerCommand: (id, run) => {
      commands.set(id, run);
      return { dispose: () => undefined };
    },
    onDidOpenTextDocument: (listener) => {
      openListeners.push(listener);
      return { dispose: () => undefined };
    },
    onDidChangeTextDocument: (listener) => {
      changeListeners.push(listener);
      return { dispose: () => undefined };
    },
    onDidSaveTextDocument: (listener) => {
      saveListeners.push(listener);
      return { dispose: () => undefined };
    },
    onDidCloseTextDocument: (listener) => {
      closeListeners.push(listener);
      return { dispose: () => undefined };
    },
    getConfiguration: () => ({
      get: (key) => {
        if (key === "enable") return options.enable ?? true;
        if (key === "debounceMs") return options.debounceMs;
        return undefined;
      },
    }),
    get activeTextDocument() {
      return options.active;
    },
    get textDocuments() {
      return options.open ?? [];
    },
  };

  return {
    api,
    context: { subscriptions: [] },
    collections,
    channels,
    commands,
    sets,
    deletes,
    channelLines,
    open: (document) => {
      for (const listener of openListeners) listener(document);
    },
    change: (document) => {
      for (const listener of changeListeners) listener({ document });
    },
    save: (document) => {
      for (const listener of saveListeners) listener(document);
    },
    close: (document) => {
      for (const listener of closeListeners) listener(document);
    },
  };
}

function activate(fake: Fake, debounceMs = 0): void {
  activateExtension(fake.api, fake.context, { debounceMs });
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

test("registers one collection, one channel, four listeners and the command", () => {
  const fake = fakeApi();
  activate(fake);

  assert.deepEqual(fake.collections, ["lispnt"]);
  assert.deepEqual(fake.channels, ["Lispnt"]);
  assert.deepEqual([...fake.commands.keys()], ["lispnt.checkFile"]);
  assert.equal(fake.context.subscriptions.length, 8);
});

test("reports a mistake in an opened Lisp file", () => {
  const fake = fakeApi();
  activate(fake);

  fake.open(documentOf("a.lisp", "(foo)"));

  assert.equal(fake.sets.length, 1);
  const diagnostic = fake.sets[0]?.diagnostics[0];
  assert.equal(diagnostic?.code, "undefined-function");
  assert.equal(diagnostic?.severity, "warning");
  assert.deepEqual(diagnostic?.range, {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 5 },
  });
});

test("underlines the line a diagnostic was reported on", () => {
  const fake = fakeApi();
  activate(fake);

  fake.open(documentOf("a.lisp", "(defun f (x) x)\n\n(f)\n"));

  assert.equal(fake.sets.length, 1);
  const diagnostic = fake.sets[0]?.diagnostics[0];
  assert.equal(diagnostic?.code, "arity");
  assert.deepEqual(diagnostic?.range, {
    start: { line: 2, character: 0 },
    end: { line: 2, character: 3 },
  });
});

test("recognises a Lisp file by language id or by name", () => {
  assert.equal(isLispDocument(documentOf("a.lisp", "", "lisp")), true);
  assert.equal(isLispDocument(documentOf("a.lisp", "", "plaintext")), true);
  assert.equal(isLispDocument(documentOf("a.cl", "", "plaintext")), true);
  assert.equal(isLispDocument(documentOf("notes.txt", "", "plaintext")), false);
});

test("ignores a document that is not Lisp", () => {
  const fake = fakeApi();
  activate(fake);

  fake.open(documentOf("notes.txt", "(foo)", "plaintext"));

  assert.deepEqual(fake.sets, []);
  assert.equal(fake.deletes.length, 1);
});

test("collapses a burst of edits into one check", async () => {
  const fake = fakeApi();
  activate(fake);
  const document = documentOf("a.lisp", "(foo)");

  fake.change(document);
  fake.change(document);
  fake.change(document);
  assert.deepEqual(fake.sets, []);

  await wait(25);

  assert.equal(fake.sets.length, 1);
});

test("a save checks at once and cancels the pending debounce", async () => {
  const fake = fakeApi();
  activate(fake);
  const document = documentOf("a.lisp", "(foo)");

  fake.change(document);
  fake.save(document);

  assert.equal(fake.sets.length, 1);
  await wait(25);
  assert.equal(fake.sets.length, 1);
});

test("clears the diagnostics for a closed document", async () => {
  const fake = fakeApi();
  activate(fake);
  const document = documentOf("a.lisp", "(foo)");

  fake.change(document);
  fake.close(document);

  assert.equal(fake.deletes.length, 1);
  await wait(25);
  assert.equal(fake.sets.length, 0);
});

test("does nothing when the setting turns checking off", () => {
  const fake = fakeApi({ enable: false });
  activate(fake);

  fake.open(documentOf("a.lisp", "(foo)"));

  assert.deepEqual(fake.sets, []);
  assert.equal(fake.deletes.length, 1);
});

test("keeps an internal failure out of the Problems panel", () => {
  const fake = fakeApi();
  activate(fake);
  const broken: VsTextDocument = {
    uri: uriOf("a.lisp"),
    languageId: "lisp",
    version: 1,
    getText: () => {
      throw new Error("boom");
    },
  };

  fake.open(broken);

  assert.deepEqual(fake.sets, []);
  assert.equal(fake.deletes.length, 1);
  assert.equal(fake.channelLines.length, 1);
  assert.match(fake.channelLines[0] ?? "", /internal error.*boom/);
});

test("checks the active document from the command", () => {
  const active = documentOf("active.lisp", "(foo)");
  const fake = fakeApi({ active });
  activate(fake);

  fake.commands.get("lispnt.checkFile")?.();

  assert.equal(fake.sets.length, 1);
  assert.equal(fake.sets[0]?.uri, active.uri);
});

test("the command says so when there is no active document", () => {
  const fake = fakeApi();
  activate(fake);

  fake.commands.get("lispnt.checkFile")?.();

  assert.deepEqual(fake.sets, []);
  assert.match(fake.channelLines[0] ?? "", /no active document/);
});

test("checks documents that are already open at activation", () => {
  const open = documentOf("open.lisp", "(foo)");
  const fake = fakeApi({ open: [open] });
  activate(fake);

  assert.equal(fake.sets.length, 1);
  assert.equal(fake.sets[0]?.uri, open.uri);
});

// The rule that keeps the core testable in a plain Node process: one file may
// import vscode for value, and everything else takes the seam.
test("only the entry file imports vscode", () => {
  const root = process.cwd();
  const offenders: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;

      const relative = path.slice(root.length + 1).replaceAll("\\", "/");
      if (relative === "src/extension.ts") continue;

      for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
        if (/from\s+"vscode"/.test(line) && !/^import type\b/.test(line.trim())) {
          offenders.push(`${relative}: ${line.trim()}`);
        }
      }
    }
  };

  walk(join(root, "src"));

  assert.deepEqual(offenders, []);
});
