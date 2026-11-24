import { traceSummary, type TraceFrame, type TraceResult } from "../core/trace";
import { traceCases } from "../core/trace-cases";

// The tree view's model: pure data, so the shape can be tested without an
// editor. Nodes carry a collapsible state and an optional tone; the adapter
// turns those into VS Code's enum and theme icons.

export interface TraceNode {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly state: "none" | "collapsed" | "expanded";
  readonly tone?: "error" | "truncated";
  readonly children: readonly TraceNode[];
}

export type TraceView =
  | { readonly kind: "empty"; readonly message: string }
  | {
      readonly kind: "tree";
      readonly roots: readonly TraceNode[];
      readonly message: string;
    };

export const NO_MARKERS_MESSAGE =
  "No ;;[trace] calls in this file. Write ;; [trace] (test call) above a function definition, for example ;;[trace] (fact 4).";

export function traceTree(source: string): TraceView {
  const cases = traceCases(source);
  if (cases.length === 0) return { kind: "empty", message: NO_MARKERS_MESSAGE };

  const roots: TraceNode[] = [];
  const summaries: string[] = [];
  let unreadable = 0;

  cases.forEach((one, index) => {
    const id = `case:${index}`;

    if (one.status === "unreadable" || one.trace === null) {
      unreadable += 1;
      roots.push({
        id,
        label: one.expression === "" ? ";;[trace]" : one.expression,
        description: `line ${one.line} · could not be read`,
        state: "none",
        children: [],
      });
      return;
    }

    roots.push({
      id,
      label: one.expression,
      description: `line ${one.line}`,
      state: "expanded",
      children: [
        ...frameNodes(one.trace.frames, id),
        ...(one.trace.truncated ? [truncatedNode(id)] : []),
      ],
    });
    summaries.push(traceSummary(one.trace));
  });

  const message =
    summaries.length === 0
      ? `${unreadable} marker${unreadable === 1 ? "" : "s"} could not be read.`
      : summaries.join("  ·  ") +
        (unreadable > 0 ? `  ·  ${unreadable} unreadable` : "");

  return { kind: "tree", roots, message };
}

function frameNodes(frames: readonly TraceFrame[], prefix: string): TraceNode[] {
  return frames.map((frame, index): TraceNode => {
    const id = `${prefix}/${index}`;
    const children = frameNodes(frame.children, id);

    const description =
      frame.error !== undefined
        ? `!! ${frame.error}`
        : frame.result === undefined
          ? undefined
          : `= ${frame.result}`;

    return {
      id,
      label: `${frame.name}(${frame.args.join(", ")})`,
      ...(description === undefined ? {} : { description }),
      state: children.length === 0 ? "none" : "collapsed",
      ...(frame.error === undefined ? {} : { tone: "error" as const }),
      children,
    };
  });
}

function truncatedNode(id: string): TraceNode {
  return {
    id: `${id}/truncated`,
    label: "recording stopped at the frame limit",
    description: "truncated",
    state: "none",
    tone: "truncated",
    children: [],
  };
}
