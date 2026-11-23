import { LispEvalError } from "./errors";
import {
  createEnv,
  evaluate,
  ReturnSignal,
  visibleBindings,
  withObserver,
  withStepCeiling,
} from "./interpreter";
import { parseAll, type AstNode } from "./reader";
import type { Env, LispValue } from "./values";

export interface BindingSnapshot {
  readonly start: number;
  readonly end: number;
  readonly bindings: Map<string, LispValue>;
}

export type BindingsUnavailable = "budget" | "unparsed" | "truncated";

export interface BindingsRun {
  readonly snapshots: BindingSnapshot[];
  readonly unavailable?: BindingsUnavailable;
}

export interface BindingsResult {
  readonly snapshot: BindingSnapshot | null;
  readonly unavailable?: BindingsUnavailable;
}

const BINDINGS_STEP_CEILING = 200_000;
const SNAPSHOT_LIMIT = 20_000;

export function recordBindings(source: string): BindingsRun {
  let forms: AstNode[];
  try {
    forms = parseAll(source);
  } catch {
    return { snapshots: [], unavailable: "unparsed" };
  }

  const snapshots: BindingSnapshot[] = [];
  let truncated = false;
  let unavailable: BindingsUnavailable | undefined;

  const observer = {
    onLeaveForm(node: AstNode, env: Env): void {
      if (node.kind !== "list") return;
      if (truncated) return;

      if (snapshots.length >= SNAPSHOT_LIMIT) {
        truncated = true;
        return;
      }

      snapshots.push({
        start: node.start.offset,
        end: node.end.offset,
        bindings: visibleCopy(env),
      });
    },
  };

  const env = createEnv(null);

  withStepCeiling(BINDINGS_STEP_CEILING, () =>
    withObserver(observer, () => {
      for (const form of forms) {
        try {
          evaluate(form, env);
        } catch (error) {
          if (error instanceof LispEvalError) {
            // A failing form is reported elsewhere: skip it so the rest of the
            // file still gets values. Only the budget ends the pass.
            if (error.code === "evaluation-budget") {
              unavailable = "budget";
              break;
            }
            continue;
          }
          if (error instanceof ReturnSignal) continue;
          // Deep recursion blows the JS stack before the ceiling trips.
          if (error instanceof RangeError) {
            unavailable = "budget";
            break;
          }
          throw error;
        }
      }
    }),
  );

  if (unavailable !== undefined) return { snapshots, unavailable };
  if (truncated) return { snapshots, unavailable: "truncated" };
  return { snapshots };
}

export function snapshotAt(
  run: BindingsRun,
  offset: number,
): BindingSnapshot | null {
  let innermost: BindingSnapshot | null = null;

  for (const snapshot of run.snapshots) {
    if (offset < snapshot.start || offset >= snapshot.end) continue;
    if (
      innermost === null ||
      snapshot.end - snapshot.start <= innermost.end - innermost.start
    )
      innermost = snapshot;
  }

  if (innermost !== null) return innermost;
  // The fallback infers state from the last form to finish, so it is only
  // sound when every form ran: truncated or stopped early, later forms may
  // have changed bindings without a snapshot to show for it.
  if (run.unavailable !== undefined) return null;

  let latest: BindingSnapshot | null = null;

  for (const snapshot of run.snapshots) {
    if (snapshot.end > offset) continue;
    if (latest === null || snapshot.end >= latest.end) latest = snapshot;
  }

  return latest;
}

export function bindingsAt(source: string, offset: number): BindingsResult {
  const run = recordBindings(source);
  const snapshot = snapshotAt(run, offset);

  if (run.unavailable === undefined) return { snapshot };
  return { snapshot, unavailable: run.unavailable };
}

function visibleCopy(env: Env): Map<string, LispValue> {
  const copy = new Map<string, LispValue>();

  for (const [name, value] of visibleBindings(env)) {
    if (value.kind === "builtin") continue;
    if (name === "T" || name === "NIL") continue;
    copy.set(name, value);
  }

  return copy;
}
