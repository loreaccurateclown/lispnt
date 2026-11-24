// The slice of the VS Code API Lispnt uses, declared here rather than imported,
// so the wiring in activate.ts can run against a fake in tests. src/extension.ts
// is the only file that imports the real module; it adapts it to this shape.

export interface VsDisposable {
  dispose(): void;
}

export interface VsPosition {
  readonly line: number;
  readonly character: number;
}

export interface VsRange {
  readonly start: VsPosition;
  readonly end: VsPosition;
}

export type VsSeverity = "error" | "warning" | "info";

// The parts of vscode.Diagnostic Lispnt fills in. The adapter turns one of these
// into the real class, including the severity enum.
export interface VsDiagnostic {
  readonly range: VsRange;
  readonly message: string;
  readonly severity: VsSeverity;
  readonly code: string;
}

export interface VsUri {
  toString(): string;
  readonly fsPath: string;
}

export interface VsDiagnosticCollection {
  set(uri: VsUri, diagnostics: readonly VsDiagnostic[]): void;
  delete(uri: VsUri): void;
  dispose(): void;
}

export interface VsOutputChannel {
  appendLine(text: string): void;
  dispose(): void;
}

export interface VsTextDocument {
  readonly uri: VsUri;
  readonly languageId: string;
  readonly version: number;
  getText(): string;
}

export interface VsConfiguration {
  get(key: string): unknown;
}

// An inline hint the editor paints at a position, such as "X = 5". tooltip
// carries the full text in lines when the editor's length cap would truncate it.
export interface VsInlayHint {
  readonly position: VsPosition;
  readonly label: string;
  readonly paddingLeft?: boolean;
  readonly tooltip?: readonly string[];
}

export interface VsInlayHintsProvider {
  provideInlayHints(
    document: VsTextDocument,
    range: VsRange,
  ): readonly VsInlayHint[];
}

// The on-demand surface: shown when the pointer rests on a name.
export interface VsHover {
  readonly contents: string;
}

export interface VsHoverProvider {
  provideHover(
    document: VsTextDocument,
    position: VsPosition,
  ): VsHover | undefined;
}

// A read-only document the extension generates rather than reads from disk:
// refresh() asks the editor to ask for the content again.
export interface VsContentProvider extends VsDisposable {
  refresh(uri: string): void;
}

export type VsCollapsibleState = "none" | "collapsed" | "expanded";

// The parts of vscode.TreeItem the trace tree fills in. iconId is a ThemeIcon
// id such as "error", not a file path.
export interface VsTreeItem {
  readonly label: string;
  readonly description?: string;
  readonly tooltip?: string;
  readonly collapsibleState: VsCollapsibleState;
  readonly iconId?: string;
}

export interface VsTreeProvider<Item> {
  getChildren(item?: Item): readonly Item[];
  getTreeItem(item: Item): VsTreeItem;
}

// A tree the editor renders from our model. refresh() re-asks the provider,
// setMessage is the muted summary line under the view, and visibility lets the
// extension refresh when the user opens the view.
export interface VsTreeView extends VsDisposable {
  refresh(): void;
  setMessage(text: string): void;
  onDidChangeVisibility(listener: (visible: boolean) => void): VsDisposable;
}

export interface VsCodeApi {
  createOutputChannel(name: string): VsOutputChannel;
  createDiagnosticCollection(name: string): VsDiagnosticCollection;
  createTreeView<Item>(id: string, provider: VsTreeProvider<Item>): VsTreeView;
  registerInlayHintsProvider(provider: VsInlayHintsProvider): VsDisposable;
  registerHoverProvider(provider: VsHoverProvider): VsDisposable;
  registerCommand(id: string, run: () => void | Promise<void>): VsDisposable;
  onDidOpenTextDocument(listener: (document: VsTextDocument) => void): VsDisposable;
  onDidChangeTextDocument(
    listener: (event: { readonly document: VsTextDocument }) => void,
  ): VsDisposable;
  onDidSaveTextDocument(listener: (document: VsTextDocument) => void): VsDisposable;
  onDidCloseTextDocument(listener: (document: VsTextDocument) => void): VsDisposable;
  // Fires with undefined when the last editor closes. The tree uses it because
  // activation can run before the editor is restored.
  onDidChangeActiveTextEditor(
    listener: (document: VsTextDocument | undefined) => void,
  ): VsDisposable;
  getConfiguration(section: string): VsConfiguration;
  // Sets a when-clause context key, so a contributed menu can swap its entry —
  // the pin button uses it to become an unpin button.
  setContext(key: string, value: unknown): Promise<void>;
  registerTextDocumentContentProvider(
    scheme: string,
    provide: (uri: string) => string,
  ): VsContentProvider;
  showDocument(uri: string): Promise<void>;
  readonly activeTextDocument: VsTextDocument | undefined;
  readonly textDocuments: readonly VsTextDocument[];
}
