import type { Diagnostic } from "../core/diagnostics";
import type { VsDiagnostic } from "./api";

// A core diagnostic carries one position, and a point range is invisible in the
// editor, so each problem underlines the line it was reported on. M2 deferred
// ranges to this layer; widening them means carrying an end position through the
// core rather than guessing one here.
export function presentDiagnostics(
  text: string,
  diagnostics: readonly Diagnostic[],
): VsDiagnostic[] {
  const lines = text.split(/\r?\n/);

  return diagnostics.map((diagnostic) => {
    const line = Math.max(0, diagnostic.position.line - 1);
    const width = Math.max(1, (lines[line] ?? "").length);

    return {
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      range: { start: { line, character: 0 }, end: { line, character: width } },
    };
  });
}
