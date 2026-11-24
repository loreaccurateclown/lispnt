import type { ArrayValue, ConsValue, LispValue, StructValue } from "./values";

export interface PrintOptions {
  maxElements?: number;
  maxDepth?: number;
  // PRINC-style rendering: strings unquoted, characters bare, recursively.
  princ?: boolean;
}

const DEFAULT_MAX_ELEMENTS = 8;
const DEFAULT_MAX_DEPTH = 3;

interface PrintState {
  maxElements: number;
  maxDepth: number;
  princ: boolean;
  ancestors: Set<ConsValue | ArrayValue | StructValue>;
}

export function printValue(value: LispValue, options?: PrintOptions): string {
  const state: PrintState = {
    maxElements: options?.maxElements ?? DEFAULT_MAX_ELEMENTS,
    maxDepth: options?.maxDepth ?? DEFAULT_MAX_DEPTH,
    princ: options?.princ ?? false,
    ancestors: new Set(),
  };

  return render(value, 0, state);
}

function render(value: LispValue, depth: number, state: PrintState): string {
  switch (value.kind) {
    case "nil":
      return "NIL";
    case "symbol":
      return value.name;
    case "number":
      return String(value.value);
    case "string":
      return state.princ ? value.value : quoteString(value.value);
    case "char":
      return state.princ ? value.value : renderChar(value.value);
    case "builtin":
      return `#<builtin ${value.name}>`;
    case "function":
      return `#<function ${value.name}>`;
    case "cons":
    case "array":
    case "struct":
      if (depth >= state.maxDepth) return "#";
      if (value.kind === "cons") return renderCons(value, depth, state);
      if (value.kind === "array") return renderArray(value, depth, state);
      return renderStruct(value, depth, state);
    case "hash":
      return `#<hash-table :count ${value.entries.size}>`;
    case "stream":
      return "#<string-output-stream>";
  }
}

function quoteString(text: string): string {
  return '"' + text.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"';
}

// SBCL prints a space as #\ followed by an invisible space; the name is
// easier to read and reads back identically, so it is printed by name here.
function renderChar(char: string): string {
  if (char === " ") return "#\\Space";
  if (char === "\n") return "#\\Newline";
  if (char === "\t") return "#\\Tab";
  return `#\\${char}`;
}

function renderCons(
  start: ConsValue,
  depth: number,
  state: PrintState,
): string {
  const parts: string[] = [];
  const consumed: ConsValue[] = [];
  let current: LispValue = start;
  let stopped = false;

  for (;;) {
    if (current.kind !== "cons") break;

    if (state.ancestors.has(current)) {
      parts.push("...");
      stopped = true;
      break;
    }

    if (parts.length >= state.maxElements) {
      parts.push("...");
      stopped = true;
      break;
    }

    state.ancestors.add(current);
    consumed.push(current);
    parts.push(render(current.car, depth + 1, state));
    current = current.cdr;
  }

  for (const cell of consumed) state.ancestors.delete(cell);

  if (!stopped && current.kind !== "nil")
    return (
      "(" + parts.join(" ") + " . " + render(current, depth + 1, state) + ")"
    );
  return "(" + parts.join(" ") + ")";
}

function renderArray(
  array: ArrayValue,
  depth: number,
  state: PrintState,
): string {
  if (state.ancestors.has(array)) return "...";

  state.ancestors.add(array);
  const parts: string[] = [];

  for (const element of array.elements) {
    if (parts.length >= state.maxElements) {
      parts.push("...");
      break;
    }
    parts.push(render(element, depth + 1, state));
  }

  state.ancestors.delete(array);
  return "#(" + parts.join(" ") + ")";
}

// #S(TREE-NODE :KEY 5 :LC NIL :RC NIL) — slots in definition order, which is
// why StructValue keeps them in a Map.
function renderStruct(
  value: StructValue,
  depth: number,
  state: PrintState,
): string {
  if (state.ancestors.has(value)) return "...";

  state.ancestors.add(value);
  const parts: string[] = [];
  for (const [slot, slotValue] of value.slots) {
    parts.push(`:${slot} ${render(slotValue, depth + 1, state)}`);
  }
  state.ancestors.delete(value);

  const rendered = parts.length === 0 ? "" : ` ${parts.join(" ")}`;
  return `#S(${value.type}${rendered})`;
}

