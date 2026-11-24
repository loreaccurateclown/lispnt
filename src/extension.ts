import * as vscode from "vscode";
import { activateExtension } from "./extension/activate";
import type {
  VsCodeApi,
  VsCollapsibleState,
  VsDiagnostic,
  VsDiagnosticCollection,
  VsHoverProvider,
  VsInlayHint,
  VsInlayHintsProvider,
  VsSeverity,
  VsTextDocument,
  VsTreeItem,
  VsTreeProvider,
  VsTreeView,
} from "./extension/api";

// The only file that imports vscode for value. Everything it teaches the rest of
// the extension is declared in ./extension/api, so the wiring can be tested
// against a fake in a plain Node process.

// Inlay hints are registered by selector, and a file with no Lisp extension
// installed is plain text, so the patterns matter as much as the language id.
const LISP_SELECTOR: vscode.DocumentSelector = [
  { language: "lisp" },
  { pattern: "**/*.lisp" },
  { pattern: "**/*.lsp" },
  { pattern: "**/*.cl" },
  { pattern: "**/*.asd" },
];

const SEVERITY: Record<VsSeverity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

const COLLAPSIBLE: Record<VsCollapsibleState, vscode.TreeItemCollapsibleState> = {
  none: vscode.TreeItemCollapsibleState.None,
  collapsed: vscode.TreeItemCollapsibleState.Collapsed,
  expanded: vscode.TreeItemCollapsibleState.Expanded,
};

function toTreeItem(item: VsTreeItem): vscode.TreeItem {
  const result = new vscode.TreeItem(item.label, COLLAPSIBLE[item.collapsibleState]);
  if (item.description !== undefined) result.description = item.description;
  if (item.tooltip !== undefined) result.tooltip = item.tooltip;
  if (item.iconId !== undefined) result.iconPath = new vscode.ThemeIcon(item.iconId);
  return result;
}

function createTreeView<Item>(id: string, provider: VsTreeProvider<Item>): VsTreeView {
  const changed = new vscode.EventEmitter<Item | undefined>();
  const view = vscode.window.createTreeView(id, {
    treeDataProvider: {
      onDidChangeTreeData: changed.event,
      getChildren: (item?: Item) => [...provider.getChildren(item)],
      getTreeItem: (item: Item) => toTreeItem(provider.getTreeItem(item)),
    },
    showCollapseAll: true,
  });

  return {
    refresh: () => changed.fire(undefined),
    setMessage: (text) => {
      view.message = text;
    },
    onDidChangeVisibility: (listener) => {
      const registration = view.onDidChangeVisibility((event) => listener(event.visible));
      return { dispose: () => registration.dispose() };
    },
    dispose: () => {
      view.dispose();
      changed.dispose();
    },
  };
}


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
    createTreeView,
    registerInlayHintsProvider: (provider: VsInlayHintsProvider) =>
      vscode.languages.registerInlayHintsProvider(LISP_SELECTOR, {
        provideInlayHints: (document, range) =>
          provider.provideInlayHints(document, range).map((hint) => {
            const item = new vscode.InlayHint(
              new vscode.Position(hint.position.line, hint.position.character),
              hint.label,
            );
            if (hint.paddingLeft !== undefined) item.paddingLeft = hint.paddingLeft;
            // One bullet per binding keeps the full text scannable in a hover,
            // and appendText stops the Lisp names being read as markdown.
            if (hint.tooltip !== undefined) {
              const tooltip = new vscode.MarkdownString();
              for (const line of hint.tooltip) {
                tooltip.appendMarkdown("- ");
                tooltip.appendText(line);
                tooltip.appendMarkdown("\n");
              }
              item.tooltip = tooltip;
            }
            return item;
          }),
      }),
    registerHoverProvider: (provider: VsHoverProvider) =>
      vscode.languages.registerHoverProvider(LISP_SELECTOR, {
        provideHover: (document, position) => {
          const hover = provider.provideHover(document, {
            line: position.line,
            character: position.character,
          });
          return hover === undefined ? undefined : new vscode.Hover(hover.contents);
        },
      }),
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
    onDidChangeActiveTextEditor: (listener) =>
      vscode.window.onDidChangeActiveTextEditor((editor) =>
        listener(editor?.document),
      ),
    getConfiguration: (section) => ({
      get: (key) => vscode.workspace.getConfiguration(section).get(key),
    }),
    setContext: async (key, value) => {
      await vscode.commands.executeCommand("setContext", key, value);
    },
    registerTextDocumentContentProvider: (scheme, provide) => {
      const changed = new vscode.EventEmitter<vscode.Uri>();
      const registration = vscode.workspace.registerTextDocumentContentProvider(
        scheme,
        {
          onDidChange: changed.event,
          provideTextDocumentContent: (uri) => provide(uri.toString()),
        },
      );

      return {
        refresh: (uri) => changed.fire(vscode.Uri.parse(uri)),
        dispose: () => {
          registration.dispose();
          changed.dispose();
        },
      };
    },
    showDocument: async (uri) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
      // preview: false keeps the trace in a normal tab. A preview tab is
      // replaced whenever a file is clicked in the explorer, which would make the
      // output view a place where source files open.
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: false,
      });
    },
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
