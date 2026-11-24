import type { Diagnostic } from "../core/diagnostics";
import type { Position } from "../core/reader";
import type { VsDiagnostic, VsPosition, VsRange } from "./api";

function vsPosition(position: Position): VsPosition {
  return { line: position.line - 1, character: position.column - 1 };
}

// A core diagnostic carries where the mistake starts and, when it is longer than
// a point, where it ends. M2 deferred ranges to this layer; the core supplies
// one for the reader mistakes where it knows the extent (an unclosed form runs
// from its `(` through its head, a stray closer to the end of its line). Without
// an end, each problem still underlines its whole line, because a point range is
// invisible in the editor.
export function presentDiagnostics(
  text: string,
  diagnostics: readonly Diagnostic[],
): VsDiagnostic[] {
  const lines = text.split(/\r?\n/);

  return diagnostics.map((diagnostic) => {
    const line = Math.max(0, diagnostic.position.line - 1);
    const width = Math.max(1, (lines[line] ?? "").length);
    let range: VsRange = {
      start: { line, character: 0 },
      end: { line, character: width },
    };

    const end = diagnostic.end;
    if (end !== undefined) {
      const start = vsPosition(diagnostic.position);
      const stop = vsPosition(end);
      const wider =
        stop.line > start.line ||
        (stop.line === start.line && stop.character > start.character);
      // One character is not much of a squiggle; keep at least that much even
      // when the core could only give a point.
      range = wider
        ? { start, end: stop }
        : { start, end: { line: start.line, character: start.character + 1 } };
    }

    return {
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      range,
    };
  });
}
