import { analyze } from "../core/analyze";
import type {
  VsCodeApi,
  VsDiagnosticCollection,
  VsDisposable,
  VsOutputChannel,
  VsTextDocument,
} from "./api";
import { presentDiagnostics } from "./present";
import { formatTraceReport, TRACE_SCHEME, TRACE_URI } from "./trace-report";
import { traceTree, type TraceNode } from "./trace-tree";
import {
  createHintRuns,
  createHoverProvider,
  createInlayHintsProvider,
} from "./value-hints";

// A file is ours when the editor calls it Lisp, or when its name says so. The
// second test matters when no Lisp extension is installed and the language id is
// plain text; it is also why Lispnt does not contribute a language of its own and
// fight OLIVE for the id.
const LISP_PATH = /\.(lisp|lsp|cl|asd)$/i;

export interface ActivationOptions {
  readonly debounceMs?: number;
}

export interface ActivationContext {
  readonly subscriptions: VsDisposable[];
}

export function isLispDocument(document: VsTextDocument): boolean {
  return document.languageId === "lisp" || LISP_PATH.test(document.uri.fsPath);
}

export function activateExtension(
  api: VsCodeApi,
  context: ActivationContext,
  options: ActivationOptions = {},
): void {
  const channel: VsOutputChannel = api.createOutputChannel("Lispnt");
  const collection: VsDiagnosticCollection = api.createDiagnosticCollection("lispnt");
  const configured = api.getConfiguration("lispnt").get("debounceMs");
  const debounceMs =
    options.debounceMs ?? (typeof configured === "number" ? configured : 300);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  // Value hints have two surfaces. Hovering is on demand and paints nothing, so
  // it is always registered. End-of-line hints are switched on per file from the
  // trace view; the set is session state, not a setting, so a reload means
  // clicking again rather than writing to the user's configuration.
  const hintRuns = createHintRuns();
  const valueHintFiles = new Set<string>();

  const registerInlayHints = (): VsDisposable =>
    api.registerInlayHintsProvider(
      createInlayHintsProvider(hintRuns, (document) =>
        valueHintFiles.has(document.uri.toString()),
      ),
    );

  let inlayHints = registerInlayHints();
  const hoverHints = api.registerHoverProvider(createHoverProvider(hintRuns));

  context.subscriptions.push(channel, collection, inlayHints, hoverHints, {
    dispose: () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  });

  const enabled = (): boolean =>
    api.getConfiguration("lispnt").get("enable") !== false;

  const cancel = (key: string): void => {
    const timer = timers.get(key);
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.delete(key);
  };

  // Analysis is synchronous and cheap — under 6 ms on the largest corpus file —
  // so a refresh is always the whole document, never a partial pass.
  const refresh = (document: VsTextDocument): void => {
    cancel(document.uri.toString());

    if (!isLispDocument(document) || !enabled()) {
      collection.delete(document.uri);
      return;
    }

    try {
      const text = document.getText();
      collection.set(document.uri, presentDiagnostics(text, analyze(text)));
    } catch (error) {
      // A failure here is Lispnt's bug, not the learner's mistake, so it goes to
      // the channel and never to the Problems panel.
      collection.delete(document.uri);
      channel.appendLine(
        `Lispnt internal error while checking ${document.uri.toString()}: ${String(error)}`,
      );
    }
  };

  const schedule = (document: VsTextDocument): void => {
    const key = document.uri.toString();
    cancel(key);

    if (!isLispDocument(document) || !enabled()) {
      collection.delete(document.uri);
      return;
    }

    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        refresh(document);
      }, debounceMs),
    );
  };

  // The tree view mirrors the traced file's marked calls. It is built from the
  // same traceCases data as the text view, so the two cannot disagree.
  let roots: readonly TraceNode[] = [];
  // The file the tree is showing. Bringing a non-Lisp editor into focus — the
  // text trace itself, a README — leaves it alone; only a Lisp file retargets.
  let treeDocument: VsTextDocument | undefined;
  let pinned = false;

  const activeLispDocument = (): VsTextDocument | undefined => {
    const document = api.activeTextDocument;
    return document !== undefined && isLispDocument(document) ? document : undefined;
  };

  const traceTreeView = api.createTreeView<TraceNode>("lispnt.trace", {
    getChildren: (node) => (node === undefined ? roots : node.children),
    getTreeItem: (node) => ({
      label: node.label,
      ...(node.description === undefined ? {} : { description: node.description }),
      collapsibleState: node.state,
      ...(node.tone === undefined
        ? {}
        : { iconId: node.tone === "error" ? "error" : "warning" }),
    }),
  });

  const refreshTraceTree = (target?: VsTextDocument): void => {
    if (target !== undefined) treeDocument = target;
    const document = treeDocument;

    if (document === undefined) {
      roots = [];
      traceTreeView.setMessage("Open a Lisp file to see its traces.");
      traceTreeView.refresh();
      return;
    }

    const view = traceTree(document.getText());
    roots = view.kind === "tree" ? view.roots : [];
    traceTreeView.setMessage(pinned ? `${view.message} · pinned` : view.message);
    traceTreeView.refresh();
  };

  const togglePin = async (): Promise<void> => {
    pinned = !pinned;
    await api.setContext("lispnt.pinned", pinned);

    // Unpinning hands the tree back to whatever Lisp file is in front.
    if (!pinned) {
      const document = activeLispDocument();
      if (document !== undefined) treeDocument = document;
    }

    refreshTraceTree();
  };

  // One command, not two: an eye / eye-closed pair put a differently titled
  // command in the same menu slot, and the editor then ordered that slot by
  // title, so the button jumped. A single command has no second identity to
  // swap, so it cannot move; the hints appearing is the state.
  const toggleValueHints = async (): Promise<void> => {
    const document = treeDocument ?? activeLispDocument();
    if (document === undefined) {
      channel.appendLine("Lispnt: no Lisp file to show values for");
      return;
    }

    const uri = document.uri.toString();
    if (valueHintFiles.has(uri)) valueHintFiles.delete(uri);
    else valueHintFiles.add(uri);

    // There is no refresh event for inlay hints, so replacing the registration is
    // what makes the editor ask again.
    inlayHints.dispose();
    inlayHints = registerInlayHints();
    context.subscriptions.push(inlayHints);

    refreshTraceTree();
  };
  // The trace view is a generated read-only document. Keeping the text in a map
  // lets the provider answer with the latest report, and refresh() is how a
  // second run replaces what the learner is looking at.
  const traceText = new Map<string, string>();
  const traceProvider = api.registerTextDocumentContentProvider(
    TRACE_SCHEME,
    (uri) => traceText.get(uri) ?? "",
  );

  const showTrace = async (): Promise<void> => {
    // Focus may be on the text trace itself, so fall back to the file the tree
    // already shows rather than tracing the generated document.
    const document = activeLispDocument() ?? treeDocument;
    if (document === undefined) {
      channel.appendLine("Lispnt: no Lisp document to trace");
      return;
    }

    try {
      const text = document.getText();
      traceText.set(TRACE_URI, formatTraceReport(document.uri.fsPath, text));
      traceProvider.refresh(TRACE_URI);
      refreshTraceTree(document);
      await api.showDocument(TRACE_URI);
    } catch (error) {
      channel.appendLine(
        `Lispnt internal error while tracing ${document.uri.toString()}: ${String(error)}`,
      );
    }
  };

  // Saving re-checks the file and, when it is the one the tree shows, re-traces
  // it too. Typing does not: a trace runs the file, which is fine once per save
  // and too much per keystroke.
  const onSave = (document: VsTextDocument): void => {
    refresh(document);
    if (treeDocument !== undefined && treeDocument.uri.toString() === document.uri.toString())
      refreshTraceTree(document);
  };

  context.subscriptions.push(
    traceTreeView,
    traceProvider,
    api.onDidOpenTextDocument(refresh),
    api.onDidSaveTextDocument(onSave),
    api.onDidChangeTextDocument((event) => schedule(event.document)),
    api.onDidCloseTextDocument((document) => {
      cancel(document.uri.toString());
      collection.delete(document.uri);

      // The traced file went away; show another Lisp file if one is in front,
      // but never the one being closed.
      if (
        treeDocument !== undefined &&
        treeDocument.uri.toString() === document.uri.toString()
      ) {
        treeDocument = undefined;
        const next = activeLispDocument();
        if (next !== undefined && next.uri.toString() !== document.uri.toString()) {
          treeDocument = next;
        }
        refreshTraceTree();
      }
    }),
    // Activation can run before the editor is restored, so the tree also
    // follows the active editor: that is what makes it populate on open. A focus
    // change to anything that is not Lisp leaves the current trace alone, and a
    // pinned file ignores focus changes entirely.
    api.onDidChangeActiveTextEditor(() => {
      if (pinned) return;
      const document = activeLispDocument();
      if (document !== undefined) refreshTraceTree(document);
    }),
    traceTreeView.onDidChangeVisibility((visible) => {
      if (visible) refreshTraceTree();
    }),
    api.registerCommand("lispnt.checkFile", () => {
      const document = api.activeTextDocument;
      if (document === undefined) {
        channel.appendLine("Lispnt: no active document to check");
        return;
      }
      refresh(document);
    }),
    api.registerCommand("lispnt.showTrace", showTrace),
    api.registerCommand("lispnt.pinTrace", togglePin),
    api.registerCommand("lispnt.unpinTrace", togglePin),
    api.registerCommand("lispnt.toggleValueHints", toggleValueHints),
  );

  // Documents already open when the extension activates get checked too, so a
  // window restored on a Lisp file is not silently unchecked.
  for (const document of api.textDocuments) refresh(document);

  // And the tree starts on the active Lisp file, so opening the view shows the
  // current file rather than an empty pane.
  refreshTraceTree(activeLispDocument());
}
