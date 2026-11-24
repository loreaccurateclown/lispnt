import * as vscode from "vscode";
import { activateExtension } from "./extension/activate";
import type {
  VsCodeApi,
  VsDiagnostic,
  VsDiagnosticCollection,
  VsSeverity,
  VsTextDocument,
} from "./extension/api";

// The only file that imports vscode for value. Everything it teaches the rest of
// the extension is declared in ./extension/api, so the wiring can be tested
// against a fake in a plain Node process.

const SEVERITY: Record<VsSeverity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

function toVscodeDiagnostic(diagnostic: VsDiagnostic): vscode.Diagnostic {
  const { start, end } = diagnostic.range;
  const result = new vscode.Diagnostic(
    new vscode.Range(start.line, start.character, end.line, end.character),
    diagnostic.message,
    SEVERITY[diagnostic.severity],
  );
  result.code = diagnostic.code;
  result.source = "Lispnt";
  return result;
}

function createDiagnosticCollection(name: string): VsDiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection(name);

  return {
    // The uri is always one the editor handed us with a document, so the cast
    // cannot produce a Uri that was not already a vscode.Uri.
    set: (uri, diagnostics) =>
      collection.set(
        uri as vscode.Uri,
        diagnostics.map(toVscodeDiagnostic),
      ),
    delete: (uri) => collection.delete(uri as vscode.Uri),
    dispose: () => collection.dispose(),
  };
}

function adapter(): VsCodeApi {
  return {
    createOutputChannel: (name) => vscode.window.createOutputChannel(name),
    createDiagnosticCollection,
    registerCommand: (id, run) => vscode.commands.registerCommand(id, run),
    onDidOpenTextDocument: (listener) =>
      vscode.workspace.onDidOpenTextDocument((document) => listener(document)),
    onDidChangeTextDocument: (listener) =>
      vscode.workspace.onDidChangeTextDocument((event) =>
        listener({ document: event.document }),
      ),
    onDidSaveTextDocument: (listener) =>
      vscode.workspace.onDidSaveTextDocument((document) => listener(document)),
    onDidCloseTextDocument: (listener) =>
      vscode.workspace.onDidCloseTextDocument((document) => listener(document)),
    getConfiguration: (section) => ({
      get: (key) => vscode.workspace.getConfiguration(section).get(key),
    }),
    get activeTextDocument(): VsTextDocument | undefined {
      return vscode.window.activeTextEditor?.document;
    },
    get textDocuments(): readonly VsTextDocument[] {
      return vscode.workspace.textDocuments;
    },
  };
}

export function activate(context: vscode.ExtensionContext): void {
  activateExtension(adapter(), context);
}

export function deactivate(): void {
  // Everything is held by context.subscriptions, so there is nothing to release.
}
