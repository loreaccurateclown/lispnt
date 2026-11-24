import { LispEvalError } from "./errors";
import { createEnv, evaluate, ReturnSignal, withStepCeiling } from "./interpreter";
import { parseAll, type AstNode } from "./reader";
import { TRACE_STEP_CEILING, traceFormIn, type TraceResult } from "./trace";
import type { Env } from "./values";

export type TraceCaseStatus = "ok" | "unreadable";

export interface TraceCase {
  readonly line: number;
  readonly expression: string;
  readonly status: TraceCaseStatus;
  readonly trace: TraceResult | null;
  // Calls per level the marker's ;;trace:N asks the renderer to show.
  readonly limit?: number | "all";
}

// ;;[trace] (fact 4)        — line comment, bracketed marker, then one form.
// ;;[trace:3] (fact 4)      — same, showing at most three calls per level.
// ;;[trace:all] (fact 4)    — same, showing every recorded call.
const MARKER = /^\s*;+\s*\[\s*trace\s*(?::\s*([A-Za-z0-9]+))?\s*\]\s*(.*)$/i;

export interface EmptyTraceMarker {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

// The expressions the markers name, without running them. The hint pass uses
// this to evaluate the calls a learner already asked to inspect, so a traced
// function body has values even though the file never calls it.
export function traceExpressions(source: string): string[] {
  const found: string[] = [];

  for (const line of source.split(/\r?\n/)) {
    const match = MARKER.exec(line);
    if (match === null) continue;
    const expression = (match[2] ?? "").trim();
    if (expression !== "") found.push(expression);
  }

  return found;
}

// A marker with nothing after it is the common first mistake: the syntax reads
// like a switch, but it names the call to follow. The analyzer turns these into
// warnings so the editor can underline and explain them.
export function emptyTraceMarkers(source: string): EmptyTraceMarker[] {
  const found: EmptyTraceMarker[] = [];
  const lines = source.split(/\r?\n/);

  // Exact line starts, so the offsets are right for CRLF files too.
  const lineStarts: number[] = [0];
  for (let at = 0; at < source.length; at += 1) {
    if (source[at] === "\n") lineStarts.push(at + 1);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = MARKER.exec(line);
    if (match === null || (match[2] ?? "").trim() !== "") continue;

    const lead = /^[ \t]*/.exec(line)?.[0].length ?? 0;
    found.push({
      line: index + 1,
      column: lead + 1,
      offset: (lineStarts[index] ?? 0) + lead,
    });
  }

  return found;
}

export function traceCases(source: string): TraceCase[] {
  const cases: TraceCase[] = [];
  let fileForms: AstNode[] | null = null;

  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const match = MARKER.exec(lines[index] ?? "");
    if (match === null) continue;

    const expression = (match[2] ?? "").trim();
    const line = index + 1;
    const limit = readLimit(match[1]);

    // A limit we cannot read makes the marker unreadable, the same as text
    // after it that is not a form.
    if (limit === "bad") {
      cases.push({ line, expression, status: "unreadable", trace: null });
      continue;
    }

    const add = (status: TraceCaseStatus, trace: TraceResult | null): void => {
      if (limit === undefined) {
        cases.push({ line, expression, status, trace });
        return;
      }
      cases.push({ line, expression, status, trace, limit });
    };

    let forms: AstNode[];
    try {
      forms = parseAll(expression);
    } catch {
      add("unreadable", null);
      continue;
    }

    const form = forms[0];
    if (form === undefined) {
      add("unreadable", null);
      continue;
    }

    // Each case starts from a freshly loaded copy of the file, so one case
    // cannot see another's mutations.
    if (fileForms === null) fileForms = readFileForms(source);

    const env = createEnv(null);
    if (fileForms !== null) loadInto(env, fileForms);

    add("ok", traceFormIn(form, env));
  }

  return cases;
}

function readLimit(raw: string | undefined): number | "all" | "bad" | undefined {
  if (raw === undefined) return undefined;
  if (/^all$/i.test(raw)) return "all";
  if (/^\d+$/.test(raw)) return Number(raw);
  return "bad";
}

function readFileForms(source: string): AstNode[] | null {
  try {
    return parseAll(source);
  } catch {
    return null;
  }
}

// Loading is best effort: a form that fails is the analyzer's business, and the
// definitions made before it are still available to the case, as they would be
// after loading the file in a REPL.
function loadInto(env: Env, forms: AstNode[]): void {
  try {
    withStepCeiling(TRACE_STEP_CEILING, () => {
      for (const form of forms) evaluate(form, env);
    });
  } catch (error) {
    if (
      error instanceof LispEvalError ||
      error instanceof ReturnSignal ||
      error instanceof RangeError
    ) {
      return;
    }
    throw error;
  }
}
