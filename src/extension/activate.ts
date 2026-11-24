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

  context.subscriptions.push(channel, collection, {
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

  // The trace view is a generated read-only document. Keeping the text in a map
  // lets the provider answer with the latest report, and refresh() is how a
  // second run replaces what the learner is looking at.
  const traceText = new Map<string, string>();
  const traceProvider = api.registerTextDocumentContentProvider(
    TRACE_SCHEME,
    (uri) => traceText.get(uri) ?? "",
  );

  const showTrace = async (): Promise<void> => {
    const document = api.activeTextDocument;
    if (document === undefined) {
      channel.appendLine("Lispnt: no active document to trace");
      return;
    }

    try {
      const text = document.getText();
      traceText.set(TRACE_URI, formatTraceReport(document.uri.fsPath, text));
      traceProvider.refresh(TRACE_URI);
      await api.showDocument(TRACE_URI);
    } catch (error) {
      channel.appendLine(
        `Lispnt internal error while tracing ${document.uri.toString()}: ${String(error)}`,
      );
    }
  };

  context.subscriptions.push(
    traceProvider,
    api.onDidOpenTextDocument(refresh),
    api.onDidSaveTextDocument(refresh),
    api.onDidChangeTextDocument((event) => schedule(event.document)),
    api.onDidCloseTextDocument((document) => {
      cancel(document.uri.toString());
      collection.delete(document.uri);
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
  );

  // Documents already open when the extension activates get checked too, so a
  // window restored on a Lisp file is not silently unchecked.
  for (const document of api.textDocuments) refresh(document);
}
