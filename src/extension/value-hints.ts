import { collectHints, formatHint, type HintRun } from "../core/hints";
import { traceExpressions } from "../core/trace-cases";
import type {
  VsHoverProvider,
  VsInlayHint,
  VsInlayHintsProvider,
  VsPosition,
  VsTextDocument,
} from "./api";

// Value hints answer one question — what did this name hold when the code ran? —
// and there are two surfaces for it. Hovering is on demand and paints nothing, so
// it is always registered. End-of-line hints put the same answer at the end of
// the line, one hint per line, and are switched on per file from the trace view.

export interface HintRuns {
  runFor(document: VsTextDocument): { text: string; run: HintRun };
}

// The run re-executes the file, including the calls the ;;[trace] markers name, so
// it is cached per document version rather than per request.
export function createHintRuns(): HintRuns {
  let cached:
    | { uri: string; version: number; text: string; run: HintRun }
    | undefined;

  return {
    runFor(document) {
      const uri = document.uri.toString();
      if (
        cached === undefined ||
        cached.uri !== uri ||
        cached.version !== document.version
      ) {
        const text = document.getText();
        cached = {
          uri,
          version: document.version,
          text,
          run: collectHints(text, { calls: traceExpressions(text) }),
        };
      }
      return cached;
    },
  };
}

export function createInlayHintsProvider(
  hintRuns: HintRuns,
  isEnabled: (document: VsTextDocument) => boolean,
  maxLength: () => number,
): VsInlayHintsProvider {
  return {
    provideInlayHints(document, range) {
      if (!isEnabled(document)) return [];

      const { text, run } = hintRuns.runFor(document);
      const lines = text.split(/\r?\n/);
      const hints: VsInlayHint[] = [];
      // The editor caps a line's total hint text at this many characters and
      // truncates with an ellipsis; 0 means no cap.
      const budget = maxLength();

      // One hint per line at the line's end, values joined: inside an expression
      // the same information stops the code being readable.
      for (let line = range.start.line; line <= range.end.line; line += 1) {
        const lineHints = run.hintsForLine(line + 1);
        if (lineHints.length === 0) continue;

        const label = lineHints.map(formatHint).join(", ");
        const truncated = budget !== 0 && label.length > budget;

        hints.push({
          position: { line, character: (lines[line] ?? "").length },
          label,
          paddingLeft: true,
          // Hovering the truncated hint shows everything the editor could not,
          // including bindings it dropped from the line entirely.
          ...(truncated ? { tooltip: lineHints.map(formatHint) } : {}),
        });
      }

      return hints;
    },
  };
}

export function createHoverProvider(hintRuns: HintRuns): VsHoverProvider {
  return {
    provideHover(document, position) {
      const { text, run } = hintRuns.runFor(document);
      const offset = offsetAt(text, position);
      if (offset === undefined) return undefined;

      const hint = run.hintAt(offset);
      return hint === null ? undefined : { contents: formatHint(hint) };
    },
  };
}

// The editor gives a line and column; the hint run resolves an absolute offset.
function offsetAt(text: string, position: VsPosition): number | undefined {
  let lineStart = 0;

  for (let line = 0; line < position.line; line += 1) {
    const newline = text.indexOf("\n", lineStart);
    if (newline === -1) return undefined;
    lineStart = newline + 1;
  }

  return lineStart + position.character;
}
