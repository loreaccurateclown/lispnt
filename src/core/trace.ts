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
import type { FunctionValue, LispValue } from "./values";

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
}

const TRACE_STEP_CEILING = 200_000;
const TRACE_DEPTH_LIMIT = 64;
const TRACE_FRAME_LIMIT = 1_000;

export function traceCalls(source: string): TraceResult {
  let forms: AstNode[];
  try {
    forms = parseAll(source);
  } catch {
    return { frames: [], truncated: false, unavailable: "unparsed" };
  }

  const roots: TraceFrame[] = [];
  // null marks a call that was too deep or past the frame cap to record.
  const stack: Array<TraceFrame | null> = [];
  let frameCount = 0;
  let truncated = false;
  let unavailable: TraceResult["unavailable"];
  let failed: string | undefined;

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

  const env = createEnv(null);

  try {
    withStepCeiling(TRACE_STEP_CEILING, () =>
      withObserver(observer, () => {
        for (const form of forms) evaluate(form, env);
      }),
    );
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

  if (unavailable !== undefined) return { frames: roots, truncated, unavailable };
  if (failed !== undefined) return { frames: roots, truncated, failed };
  return { frames: roots, truncated };
}

export function renderTrace(result: TraceResult): string {
  const lines: string[] = result.frames.map((frame) => renderFrame(frame, 0));

  if (result.unavailable === "unparsed") lines.push("… could not parse");
  else if (result.unavailable === "budget") lines.push("… stopped: budget");
  else if (result.failed !== undefined) lines.push(`… stopped: ${result.failed}`);

  if (result.truncated) lines.push("… trace truncated");

  return lines.join("\n");
}

function renderFrame(frame: TraceFrame, depth: number): string {
  const indent = "  ".repeat(depth);
  let line = `${indent}${frame.name}(${frame.args.join(", ")})`;

  if (frame.result !== undefined) line += ` => ${frame.result}`;
  if (frame.error !== undefined) line += ` !! ${frame.error}`;

  for (const child of frame.children) {
    line += `\n${renderFrame(child, depth + 1)}`;
  }

  return line;
}
