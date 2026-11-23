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
}

// ;;[trace] (fact 4)   — line comment, bracketed marker, then one form.
const MARKER = /^\s*;+\s*\[\s*trace\s*\]\s*(.*)$/i;

export function traceCases(source: string): TraceCase[] {
  const cases: TraceCase[] = [];
  let fileForms: AstNode[] | null = null;

  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const match = MARKER.exec(lines[index] ?? "");
    if (match === null) continue;

    const expression = (match[1] ?? "").trim();
    const line = index + 1;

    let forms: AstNode[];
    try {
      forms = parseAll(expression);
    } catch {
      cases.push({ line, expression, status: "unreadable", trace: null });
      continue;
    }

    const form = forms[0];
    if (form === undefined) {
      cases.push({ line, expression, status: "unreadable", trace: null });
      continue;
    }

    // Each case starts from a freshly loaded copy of the file, so one case
    // cannot see another's mutations.
    if (fileForms === null) fileForms = readFileForms(source);

    const env = createEnv(null);
    if (fileForms !== null) loadInto(env, fileForms);

    cases.push({ line, expression, status: "ok", trace: traceFormIn(form, env) });
  }

  return cases;
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
