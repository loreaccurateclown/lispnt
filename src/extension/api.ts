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

export interface VsCodeApi {
  createOutputChannel(name: string): VsOutputChannel;
  createDiagnosticCollection(name: string): VsDiagnosticCollection;
  registerCommand(id: string, run: () => void): VsDisposable;
  onDidOpenTextDocument(listener: (document: VsTextDocument) => void): VsDisposable;
  onDidChangeTextDocument(
    listener: (event: { readonly document: VsTextDocument }) => void,
  ): VsDisposable;
  onDidSaveTextDocument(listener: (document: VsTextDocument) => void): VsDisposable;
  onDidCloseTextDocument(listener: (document: VsTextDocument) => void): VsDisposable;
  getConfiguration(section: string): VsConfiguration;
  readonly activeTextDocument: VsTextDocument | undefined;
  readonly textDocuments: readonly VsTextDocument[];
}
