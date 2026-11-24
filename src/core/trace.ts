import { LispEvalError } from "./errors";
import {
  createEnv,
  evaluate,
  ReturnSignal,
  withObserver,
  withStepCeiling,
} from "./interpreter";
import { printValue } from "./print";
import { parseAll, type AstNode } from "./reader";
import type { Env, FunctionValue, LispValue } from "./values";

export interface TraceFrame {
  readonly name: string;
  readonly args: string[];
  readonly children: TraceFrame[];
  result?: string;
  error?: string;
}

export interface TraceResult {
  readonly frames: TraceFrame[];
  readonly truncated: boolean;
  readonly unavailable?: "budget" | "unparsed";
  readonly failed?: string;
  // The value the traced run returned: the last top-level form's for a whole
  // file, the marked form's for a ;;[trace] case.
  readonly finalValue?: string;
}

// The explanation appended by renderTrace when asked for it.
export const EXPLAIN_TRACE =
  "This is a summary, not a full trace. The final value is on the top line: " +
  "the function recurses down to max depth, then the values are combined back up. " +
  "If using tail-call recursion, nothing is combined — the answer returns unchanged.";

export const DEFAULT_TRACE_LIMIT = 10;

export interface TraceRenderOptions {
  // Calls shown per level before the middle is hidden. "all" shows every call.
  readonly limit?: number | "all";
  // Append EXPLAIN_TRACE below the summary.
  readonly explain?: boolean;
}

export const TRACE_STEP_CEILING = 200_000;
const TRACE_DEPTH_LIMIT = 64;
const TRACE_FRAME_LIMIT = 1_000;

export function traceCalls(source: string): TraceResult {
  let forms: AstNode[];
  try {
    forms = parseAll(source);
  } catch {
    return { frames: [], truncated: false, unavailable: "unparsed" };
  }

  const env = createEnv(null);

  return record(() => {
    let last: LispValue | undefined;
    for (const form of forms) last = evaluate(form, env);
    return last;
  });
}

// Traces a single already-parsed expression in a prepared environment, so a
// caller can load a file first and then trace one call in it.
export function traceFormIn(form: AstNode, env: Env): TraceResult {
  return record(() => evaluate(form, env));
}

function record(run: () => LispValue | undefined): TraceResult {
  const roots: TraceFrame[] = [];
  // null marks a call that was too deep or past the frame cap to record.
  const stack: Array<TraceFrame | null> = [];
  let frameCount = 0;
  let truncated = false;
  let unavailable: TraceResult["unavailable"];
  let failed: string | undefined;
  let finalValue: string | undefined;

  function closeOpenFrames(code: string): void {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const frame = stack[index];
      if (frame === null || frame === undefined) continue;
      frame.error = code;
      return;
    }
  }

  const observer = {
    onCallEnter(fn: FunctionValue, args: LispValue[]): void {
      if (stack.length >= TRACE_DEPTH_LIMIT || frameCount >= TRACE_FRAME_LIMIT) {
        truncated = true;
        stack.push(null);
        return;
      }

      const frame: TraceFrame = {
        name: fn.name,
        args: args.map((arg) => printValue(arg)),
        children: [],
      };

      frameCount += 1;

      const parent = stack[stack.length - 1];
      if (parent === undefined) roots.push(frame);
      else parent?.children.push(frame);

      stack.push(frame);
    },

    onCallExit(_fn: FunctionValue, value: LispValue): void {
      const frame = stack.pop();
      if (frame === null || frame === undefined) return;
      frame.result = printValue(value);
    },
  };

  try {
    const value = withStepCeiling(TRACE_STEP_CEILING, () =>
      withObserver(observer, run),
    );
    if (value !== undefined) finalValue = printValue(value);
  } catch (error) {
    if (error instanceof ReturnSignal) {
      // A stray return ends evaluation; the frames recorded so far stand.
    } else if (error instanceof LispEvalError) {
      if (error.code === "evaluation-budget") unavailable = "budget";
      else failed = error.code;
      closeOpenFrames(error.code);
    } else if (error instanceof RangeError) {
      // Deep recursion trips the JS stack before the step ceiling.
      unavailable = "budget";
      closeOpenFrames("evaluation-budget");
    } else {
      throw error;
    }
  }

  return {
    frames: roots,
    truncated,
    ...(unavailable === undefined ? {} : { unavailable }),
    ...(failed === undefined ? {} : { failed }),
    ...(finalValue === undefined ? {} : { finalValue }),
  };
}

// One line per call: the entry with its arguments, then its value. Breaking
// with SBCL's enter-then-return interleaving is deliberate — a line reads as
// "called with these arguments; everything below it totals this" — so the tree
// stays short while the value sits inside the subtree that produced it.
export function renderTrace(
  result: TraceResult,
  options: TraceRenderOptions = {},
): string {
  const lines: string[] = [];

  if (result.frames.length > 0) {
    const context: RenderContext = {
      limit: resolveLimit(options.limit),
      maxDepth: deepestDepth(result.frames),
      depthIsFloor: result.truncated || result.unavailable === "budget",
    };

    for (const frame of result.frames) {
      lines.push(...renderFrame(frame, 0, context));
    }

    lines.push(traceSummary(result));
  }

  if (result.unavailable === "unparsed") lines.push("… could not parse");
  else if (result.unavailable === "budget") lines.push("… stopped: budget");
  else if (result.failed !== undefined) lines.push(`… stopped: ${result.failed}`);

  if (result.truncated) lines.push("… trace truncated");

  if (options.explain === true) {
    if (lines.length > 0) lines.push("");
    lines.push(EXPLAIN_TRACE);
  }

  return lines.join("\n");
}

interface RenderContext {
  readonly limit: number;
  readonly maxDepth: number;
  // The deepest recorded level is a floor: a cap or a budget stopped the run.
  readonly depthIsFloor: boolean;
}

function resolveLimit(limit: number | "all" | undefined): number {
  if (limit === undefined) return DEFAULT_TRACE_LIMIT;
  if (limit === "all") return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.min(Math.floor(limit), TRACE_FRAME_LIMIT));
}

function deepestDepth(frames: readonly TraceFrame[]): number {
  let max = 0;
  const pending: Array<{ frame: TraceFrame; depth: number }> = frames.map(
    (frame) => ({ frame, depth: 0 }),
  );

  while (pending.length > 0) {
    const entry = pending.pop()!;
    if (entry.depth > max) max = entry.depth;
    for (const child of entry.frame.children) {
      pending.push({ frame: child, depth: entry.depth + 1 });
    }
  }

  return max;
}

function countFrames(frames: readonly TraceFrame[]): number {
  let total = 0;
  const pending: TraceFrame[] = [...frames];

  while (pending.length > 0) {
    const frame = pending.pop()!;
    total += 1;
    for (const child of frame.children) pending.push(child);
  }

  return total;
}

function renderFrame(
  frame: TraceFrame,
  depth: number,
  context: RenderContext,
): string[] {
  const entry = `${indentFor(depth)}${depthPrefix(depth, context)}${renderCall(frame)}`;
  const lines = [entry];
  const children = frame.children;

  // Keep the first limit entries and the last one, and say how many went.
  const hidden = children.length - context.limit - 1;
  if (hidden > 0) {
    for (const child of children.slice(0, context.limit)) {
      lines.push(...renderFrame(child, depth + 1, context));
    }
    lines.push(
      `${indentFor(depth + 1)}… ${hidden} more call${hidden === 1 ? "" : "s"} hidden`,
    );
    lines.push(...renderFrame(children[children.length - 1]!, depth + 1, context));
  } else {
    for (const child of children) {
      lines.push(...renderFrame(child, depth + 1, context));
    }
  }

  return lines;
}

function indentFor(depth: number): string {
  return "  ".repeat(depth);
}

// root at the top of the recursion, max depth at the bottom of it; every entry
// line at the deepest level is labelled so that level reads as one block.
function depthPrefix(depth: number, context: RenderContext): string {
  if (depth === 0) return "root: 0: ";
  if (depth === context.maxDepth) {
    const suffix = context.depthIsFloor ? " (limit reached)" : "";
    return `max depth: ${depth}${suffix}: `;
  }
  return `${depth}: `;
}

function renderCall(frame: TraceFrame): string {
  let line = `${frame.name}(${frame.args.join(", ")})`;
  if (frame.result !== undefined) line += ` => ${frame.result}`;
  if (frame.error !== undefined) line += ` !! ${frame.error}`;
  return line;
}

// One line describing a whole trace, shared by the text view and the tree view
// so the two cannot disagree.
export function traceSummary(result: TraceResult): string {
  const calls = countFrames(result.frames);
  const count = `${calls} call${calls === 1 ? "" : "s"}`;
  const floor = result.truncated || result.unavailable === "budget";
  const depth = `max depth: ${deepestDepth(result.frames)}${floor ? " (limit reached)" : ""}`;

  if (result.finalValue === undefined) return `${count} · ${depth}`;
  return `${count} · ${depth} · final value: ${result.finalValue}`;
}
