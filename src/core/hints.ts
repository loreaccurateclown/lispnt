import { recordBindings, snapshotAt, type BindingsUnavailable } from "./bindings";
import { printValue, type PrintOptions } from "./print";
import { parseAll, type AstNode } from "./reader";
import {
  collectSymbols,
  createFileScope,
  symbolWord,
  walkWithScopes,
} from "./scopes";

export interface ValueHint {
  readonly name: string;
  readonly line: number;
  readonly offset: number;
  readonly text: string;
}

export interface HintOptions {
  readonly maxElements?: number;
  readonly maxDepth?: number;
}

export interface HintRun {
  hintsForLine(line: number): ValueHint[];
  hintsInLines(first: number, last: number): ValueHint[][];
  hintAt(offset: number): ValueHint | null;
  readonly unavailable?: BindingsUnavailable;
}

interface AtomUse {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
}// Provisional: the same limits as a REPL print. Narrow them once the hint line
// has been seen with real values in it.
const HINT_PRINT_OPTIONS = { maxElements: 8, maxDepth: 3 };

export function collectHints(source: string, options?: HintOptions): HintRun {
  const printOptions: PrintOptions = {
    maxElements: options?.maxElements ?? HINT_PRINT_OPTIONS.maxElements,
    maxDepth: options?.maxDepth ?? HINT_PRINT_OPTIONS.maxDepth,
  };

  const run = recordBindings(source);

  let forms: AstNode[];
  try {
    forms = parseAll(source);
  } catch {
    return {
      hintsForLine: () => [],
      hintsInLines: () => [],
      hintAt: () => null,
      unavailable: "unparsed",
    };
  }

  const uses: AtomUse[] = [];

  walkWithScopes(forms, createFileScope(collectSymbols(forms)), (node) => {
    if (node.kind !== "atom") return;
    const name = symbolWord(node);
    if (name === undefined) return;
    if (name.startsWith(":")) return;

    uses.push({
      name,
      start: node.start.offset,
      // An atom carries no end position; interning uppercases without changing
      // the length, so the name's length spans its source text.
      end: node.start.offset + name.length,
      line: node.start.line,
    });
  });

  const byLine = new Map<number, AtomUse[]>();
  for (const use of uses) {
    const line = byLine.get(use.line);
    if (line === undefined) byLine.set(use.line, [use]);
    else line.push(use);
  }

  function hintFor(use: AtomUse): ValueHint | null {
    const snapshot = snapshotAt(run, use.start);
    if (snapshot === null) return null;

    const value = snapshot.bindings.get(use.name);
    if (value === undefined) return null;

    return {
      name: use.name,
      line: use.line,
      offset: use.start,
      text: printValue(value, printOptions),
    };
  }

  function hintsForLine(line: number): ValueHint[] {
    const found: ValueHint[] = [];
    const seen = new Set<string>();

    for (const use of byLine.get(line) ?? []) {
      if (seen.has(use.name)) continue;

      const hint = hintFor(use);
      if (hint === null) continue;

      seen.add(use.name);
      found.push(hint);
    }

    return found;
  }

  function hintsInLines(first: number, last: number): ValueHint[][] {
    const lines: ValueHint[][] = [];

    for (let line = first; line <= last; line += 1) {
      lines.push(hintsForLine(line));
    }

    return lines;
  }

  function hintAt(offset: number): ValueHint | null {
    for (const use of uses) {
      if (offset < use.start || offset >= use.end) continue;
      return hintFor(use);
    }

    return null;
  }

  if (run.unavailable === undefined) return { hintsForLine, hintsInLines, hintAt };
  return { hintsForLine, hintsInLines, hintAt, unavailable: run.unavailable };
}

export function formatHint(hint: ValueHint): string {
  return `${hint.name} = ${hint.text}`;
}

export function formatLine(hints: ValueHint[]): string {
  return hints.map(formatHint).join(", ");
}
