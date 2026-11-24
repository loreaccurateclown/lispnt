import { collectHints, formatHint, type HintRun } from "../core/hints";
import type {
  VsInlayHint,
  VsInlayHintsProvider,
  VsRange,
  VsTextDocument,
} from "./api";

// Inline hints are the M4 value story in the editor: where a name is read and
// the run has a value, paint "X = 5" at that use. The run re-executes the file,
// so it is cached per document version; the editor asks for hints repeatedly as
// the viewport moves, and re-running a file on each scroll would be wasteful.

interface CachedRun {
  readonly uri: string;
  readonly version: number;
  readonly text: string;
  readonly run: HintRun;
}

export function createInlayHintsProvider(
  isEnabled: () => boolean,
): VsInlayHintsProvider {
  let cached: CachedRun | undefined;

  return {
    provideInlayHints(
      document: VsTextDocument,
      range: VsRange,
    ): readonly VsInlayHint[] {
      if (!isEnabled()) return [];

      const uri = document.uri.toString();
      if (
        cached === undefined ||
        cached.uri !== uri ||
        cached.version !== document.version
      ) {
        const text = document.getText();
        cached = { uri, version: document.version, text, run: collectHints(text) };
      }

      const { text, run } = cached;
      const hints: VsInlayHint[] = [];

      // The hint run numbers lines from 1; the editor numbers them from 0.
      for (const lineHints of run.hintsInLines(
        range.start.line + 1,
        range.end.line + 1,
      )) {
        for (const hint of lineHints) {
          hints.push({
            position: { line: hint.line - 1, character: columnOf(text, hint.offset) },
            label: formatHint(hint),
          });
        }
      }

      return hints;
    },
  };
}

// A hint's offset is absolute; the editor wants a column on its line.
function columnOf(text: string, offset: number): number {
  const newline = text.lastIndexOf("\n", offset - 1);
  return offset - (newline + 1);
}
