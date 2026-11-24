import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { activateExtension, isLispDocument } from "../src/extension/activate";
import { formatTraceReport } from "../src/extension/trace-report";
import type { TraceNode } from "../src/extension/trace-tree";
import type {
  VsCodeApi,
  VsDiagnostic,
  VsDiagnosticCollection,
  VsDisposable,
  VsOutputChannel,
  VsTextDocument,
  VsTreeItem,
  VsTreeProvider,
  VsTreeView,
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

interface FakeTree {
  readonly id: string;
  readonly provider: VsTreeProvider<TraceNode>;
  refreshes: number;
  message: string;
}

interface Fake {
  readonly api: VsCodeApi;
  readonly context: { subscriptions: VsDisposable[] };
  readonly collections: string[];
  readonly channels: string[];
  readonly commands: Map<string, () => void | Promise<void>>;
  readonly sets: Array<{ uri: VsUri; diagnostics: readonly VsDiagnostic[] }>;
  readonly deletes: VsUri[];
  readonly channelLines: string[];
  readonly providers: Map<string, (uri: string) => string>;
  readonly refreshes: string[];
  readonly shown: string[];
  readonly trees: FakeTree[];
  readonly contexts: Array<{ key: string; value: unknown }>;
  open(document: VsTextDocument): void;
  change(document: VsTextDocument): void;
  save(document: VsTextDocument): void;
  close(document: VsTextDocument): void;
  setActive(document: VsTextDocument | undefined): void;
  activeEditorChanged(): void;
  setTreeVisible(visible: boolean): void;
}

function fakeApi(options: FakeOptions = {}): Fake {
  const collections: string[] = [];
  const channels: string[] = [];
  const commands = new Map<string, () => void | Promise<void>>();
  const sets: Fake["sets"] = [];
  const deletes: VsUri[] = [];
  const channelLines: string[] = [];
  const providers = new Map<string, (uri: string) => string>();
  const refreshes: string[] = [];
  const shown: string[] = [];
  const trees: FakeTree[] = [];
  const contexts: Fake["contexts"] = [];
  let active = options.active;

  const openListeners: Array<(document: VsTextDocument) => void> = [];
  const changeListeners: Array<(event: { document: VsTextDocument }) => void> = [];
  const saveListeners: Array<(document: VsTextDocument) => void> = [];
  const closeListeners: Array<(document: VsTextDocument) => void> = [];
  const activeEditorListeners: Array<(document: VsTextDocument | undefined) => void> = [];
  const visibilityListeners: Array<(visible: boolean) => void> = [];

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
    createTreeView: <Item>(id: string, provider: VsTreeProvider<Item>): VsTreeView => {
      const tree: FakeTree = {
        id,
        provider: provider as unknown as VsTreeProvider<TraceNode>,
        refreshes: 0,
        message: "",
      };
      trees.push(tree);

      return {
        refresh: () => {
          tree.refreshes += 1;
        },
        setMessage: (text) => {
          tree.message = text;
        },
        onDidChangeVisibility: (listener) => {
          visibilityListeners.push(listener);
          return { dispose: () => undefined };
        },
        dispose: () => undefined,
      };
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
    onDidChangeActiveTextEditor: (listener) => {
      activeEditorListeners.push(listener);
      return { dispose: () => undefined };
    },
    getConfiguration: () => ({
      get: (key) => {
        if (key === "enable") return options.enable ?? true;
        if (key === "debounceMs") return options.debounceMs;
        return undefined;
      },
    }),
    setContext: async (key, value) => {
      contexts.push({ key, value });
    },
    registerTextDocumentContentProvider: (scheme, provide) => {
      providers.set(scheme, provide);
      return {
        refresh: (uri) => refreshes.push(uri),
        dispose: () => undefined,
      };
    },
    showDocument: async (uri) => {
      shown.push(uri);
    },
    get activeTextDocument() {
      return active;
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
    providers,
    refreshes,
    shown,
    trees,
    contexts,
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
    setActive: (document) => {
      active = document;
    },
    activeEditorChanged: () => {
      for (const listener of activeEditorListeners) listener(active);
    },
    setTreeVisible: (visible) => {
      for (const listener of visibilityListeners) listener(visible);
    },
  };
}

function activate(fake: Fake, debounceMs = 0): void {
  activateExtension(fake.api, fake.context, { debounceMs });
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

test("registers the collection, channel, listeners, trace provider and four commands", () => {
  const fake = fakeApi();
  activate(fake);

  assert.deepEqual(fake.collections, ["lispnt"]);
  assert.deepEqual(fake.channels, ["Lispnt"]);
  assert.deepEqual([...fake.commands.keys()], [
    "lispnt.checkFile",
    "lispnt.showTrace",
    "lispnt.pinTrace",
    "lispnt.unpinTrace",
  ]);
  assert.deepEqual([...fake.providers.keys()], ["lispnt-trace"]);
  assert.equal(fake.context.subscriptions.length, 15);
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

const FACT = "(defun fact (n) (if (= n 0) 1 (* n (fact (1- n)))))";

test("the trace report explains the marker when a file has none", () => {
  const report = formatTraceReport("a.lisp", FACT);

  assert.match(report, /No ;;\[trace\] calls in this file/);
  assert.match(report, /;;\[trace\] \(fact 4\)/);
});

test("the trace report renders every marked call", () => {
  const report = formatTraceReport("fact.lisp", `${FACT}\n;;[trace] (fact 3)`);

  assert.match(report, /;; Lispnt trace for fact\.lisp/);
  assert.match(report, /;; line 2 {2}\(fact 3\)/);
  assert.match(report, /root: 0: FACT\(3\) => 6/);
  assert.match(report, /max depth: 3: FACT\(0\) => 1/);
});

test("the trace report honours the call limit on a marker", () => {
  const source = [
    "(defun d (x) (* 2 x))",
    "(defun three (a) (+ (d a) (d (+ a 1)) (d (+ a 2))))",
    ";;[trace:1] (three 1)",
  ].join("\n");

  const report = formatTraceReport("three.lisp", source);

  assert.match(report, /root: 0: THREE\(1\) => 12/);
  assert.match(report, /more call hidden/);
});

test("the trace report says when a marker does not hold a call", () => {
  const report = formatTraceReport("bad.lisp", ";;[trace] (oops");

  assert.match(report, /could not be read as an expression/);
});

test("the trace command writes the report and shows it beside the source", async () => {
  const active = documentOf("a.lisp", `${FACT}\n;;[trace] (fact 3)`);
  const fake = fakeApi({ active });
  activate(fake);

  await fake.commands.get("lispnt.showTrace")?.();

  assert.deepEqual(fake.refreshes, ["lispnt-trace:/Trace"]);
  assert.deepEqual(fake.shown, ["lispnt-trace:/Trace"]);

  const provide = fake.providers.get("lispnt-trace");
  assert.ok(provide !== undefined);
  assert.match(provide("lispnt-trace:/Trace"), /root: 0: FACT\(3\) => 6/);
});

test("a second trace run replaces the panel and refreshes it again", async () => {
  const fake = fakeApi({ active: documentOf("one.lisp", ";;[trace] (add 1 2)") });
  activate(fake);

  await fake.commands.get("lispnt.showTrace")?.();
  fake.setActive(
    documentOf("two.lisp", "(defun add (a b) (+ a b))\n;;[trace] (add 3 4)"),
  );
  await fake.commands.get("lispnt.showTrace")?.();

  assert.equal(fake.refreshes.length, 2);
  const provide = fake.providers.get("lispnt-trace");
  assert.ok(provide !== undefined);
  const content = provide("lispnt-trace:/Trace");
  assert.match(content, /two\.lisp/);
  assert.match(content, /ADD\(3, 4\) => 7/);
});

test("the trace command says so when there is no active document", async () => {
  const fake = fakeApi();
  activate(fake);

  await fake.commands.get("lispnt.showTrace")?.();

  assert.deepEqual(fake.shown, []);
  assert.match(fake.channelLines[0] ?? "", /no Lisp document to trace/);
});

test("creates the activity-bar tree and starts on the active document", () => {
  const active = documentOf("a.lisp", `${FACT}\n;;[trace] (fact 3)`);
  const fake = fakeApi({ active });
  activate(fake);

  assert.equal(fake.trees.length, 1);
  const tree = fake.trees[0];
  assert.equal(tree?.id, "lispnt.trace");
  assert.ok((tree?.refreshes ?? 0) >= 1);

  const roots = tree?.provider.getChildren() as readonly TraceNode[];
  assert.equal(roots.length, 1);
  assert.equal(roots[0]?.label, "(fact 3)");

  const rootItem = tree?.provider.getTreeItem(roots[0]!);
  assert.equal(rootItem?.collapsibleState, "expanded");
  assert.equal(rootItem?.description, "line 2");

  const frameItem = tree?.provider.getTreeItem(roots[0]!.children[0]!);
  assert.equal(frameItem?.label, "FACT(3)");
  assert.equal(frameItem?.description, "= 6");
});

test("the tree gives a throwing frame the error icon", () => {
  const active = documentOf("a.lisp", "(defun head-of (x) (car x))\n;;[trace] (head-of 1)");
  const fake = fakeApi({ active });
  activate(fake);

  const roots = fake.trees[0]?.provider.getChildren() as readonly TraceNode[];
  const item = fake.trees[0]?.provider.getTreeItem(roots[0]!.children[0]!);
  assert.equal(item?.iconId, "error");
  assert.equal(item?.description, "!! type-error");
});

test("the tree asks for a Lisp file when there is none", () => {
  const fake = fakeApi();
  activate(fake);

  assert.match(fake.trees[0]?.message ?? "", /Open a Lisp file/);
  assert.deepEqual(fake.trees[0]?.provider.getChildren(), []);
});

test("the trace command refreshes the tree as well as the panel", async () => {
  const active = documentOf("a.lisp", `${FACT}\n;;[trace] (fact 3)`);
  const fake = fakeApi({ active });
  activate(fake);

  const before = fake.trees[0]?.refreshes ?? 0;
  await fake.commands.get("lispnt.showTrace")?.();

  assert.equal(fake.trees[0]?.refreshes, before + 1);
});

// Activation can run before the editor is restored, which is why the tree had
// nothing in it until the command was run by hand.
test("the tree follows the active editor, so opening a file fills it", () => {
  const fake = fakeApi();
  activate(fake);

  assert.deepEqual(fake.trees[0]?.provider.getChildren(), []);
  assert.match(fake.trees[0]?.message ?? "", /Open a Lisp file/);

  fake.setActive(documentOf("a.lisp", `${FACT}\n;;[trace] (fact 3)`));
  fake.activeEditorChanged();

  const roots = fake.trees[0]?.provider.getChildren() as readonly TraceNode[];
  assert.equal(roots.length, 1);
  assert.equal(roots[0]?.label, "(fact 3)");
});

test("saving the file the tree shows re-traces it", () => {
  const active = documentOf("a.lisp", `${FACT}\n;;[trace] (fact 3)`);
  const fake = fakeApi({ active });
  activate(fake);

  const before = fake.trees[0]?.refreshes ?? 0;
  fake.save(active);

  assert.equal(fake.trees[0]?.refreshes, before + 1);
});

test("opening the view refreshes it, hiding it does not", () => {
  const active = documentOf("a.lisp", `${FACT}\n;;[trace] (fact 3)`);
  const fake = fakeApi({ active });
  activate(fake);

  const before = fake.trees[0]?.refreshes ?? 0;
  fake.setTreeVisible(false);
  assert.equal(fake.trees[0]?.refreshes, before);

  fake.setTreeVisible(true);
  assert.equal(fake.trees[0]?.refreshes, before + 1);
});

test("typing does not re-trace, so the tree does not run the file per keystroke", async () => {
  const active = documentOf("a.lisp", `${FACT}\n;;[trace] (fact 3)`);
  const fake = fakeApi({ active });
  activate(fake);

  const before = fake.trees[0]?.refreshes ?? 0;
  fake.change(active);
  await wait(25);

  assert.equal(fake.trees[0]?.refreshes, before);
});

test("focusing the generated trace document leaves the tree on its file", () => {
  const active = documentOf("a.lisp", `${FACT}\n;;[trace] (fact 3)`);
  const fake = fakeApi({ active });
  activate(fake);

  fake.setActive(documentOf("Trace", "root: 0: FACT(3) => 6", "markdown"));
  fake.activeEditorChanged();

  const roots = fake.trees[0]?.provider.getChildren() as readonly TraceNode[];
  assert.equal(roots.length, 1);
  assert.equal(roots[0]?.label, "(fact 3)");
});

test("closing the traced file clears the tree", () => {
  const active = documentOf("a.lisp", `${FACT}\n;;[trace] (fact 3)`);
  const fake = fakeApi({ active });
  activate(fake);

  fake.close(active);

  assert.deepEqual(fake.trees[0]?.provider.getChildren(), []);
  assert.match(fake.trees[0]?.message ?? "", /Open a Lisp file/);
});

test("pinning holds the tree while another Lisp file is worked on", async () => {
  const first = documentOf("one.lisp", `${FACT}\n;;[trace] (fact 3)`);
  const fake = fakeApi({ active: first });
  activate(fake);

  await fake.commands.get("lispnt.pinTrace")?.();
  assert.deepEqual(fake.contexts.at(-1), { key: "lispnt.pinned", value: true });
  assert.match(fake.trees[0]?.message ?? "", /pinned/);

  const second = documentOf(
    "two.lisp",
    "(defun add (a b) (+ a b))\n;;[trace] (add 3 4)",
  );
  fake.setActive(second);
  fake.activeEditorChanged();

  const pinnedRoots = fake.trees[0]?.provider.getChildren() as readonly TraceNode[];
  assert.equal(pinnedRoots[0]?.label, "(fact 3)");

  await fake.commands.get("lispnt.unpinTrace")?.();
  const released = fake.trees[0]?.provider.getChildren() as readonly TraceNode[];
  assert.equal(released[0]?.label, "(add 3 4)");
});

test("the trace command falls back to the traced file when focus is elsewhere", async () => {
  const lisp = documentOf("a.lisp", `${FACT}\n;;[trace] (fact 3)`);
  const fake = fakeApi({ active: lisp });
  activate(fake);

  fake.setActive(documentOf("Trace", "root: 0: FACT(3) => 6", "markdown"));
  fake.activeEditorChanged();

  await fake.commands.get("lispnt.showTrace")?.();

  const provide = fake.providers.get("lispnt-trace");
  assert.ok(provide !== undefined);
  assert.match(provide("lispnt-trace:/Trace"), /root: 0: FACT\(3\) => 6/);
});

test("the message carries the summary and the explanation stays in the text view", () => {
  const active = documentOf("a.lisp", `${FACT}\n;;[trace] (fact 3)`);
  const fake = fakeApi({ active });
  activate(fake);

  const message = fake.trees[0]?.message ?? "";
  assert.match(message, /final value: 6/);
  assert.doesNotMatch(message, /This is a summary/);

  const roots = fake.trees[0]?.provider.getChildren() as readonly TraceNode[];
  assert.equal(roots.length, 1);
  assert.equal(roots[0]?.label, "(fact 3)");
});