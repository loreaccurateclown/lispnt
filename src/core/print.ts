import type { ArrayValue, ConsValue, LispValue } from "./values";

export interface PrintOptions {
  maxElements?: number;
  maxDepth?: number;
}

const DEFAULT_MAX_ELEMENTS = 8;
const DEFAULT_MAX_DEPTH = 3;

interface PrintState {
  maxElements: number;
  maxDepth: number;
  ancestors: Set<ConsValue | ArrayValue>;
}

export function printValue(value: LispValue, options?: PrintOptions): string {
  const state: PrintState = {
    maxElements: options?.maxElements ?? DEFAULT_MAX_ELEMENTS,
    maxDepth: options?.maxDepth ?? DEFAULT_MAX_DEPTH,
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
      return quoteString(value.value);
    case "char":
      return renderChar(value.value);
    case "builtin":
      return `#<builtin ${value.name}>`;
    case "function":
      return `#<function ${value.name}>`;
    case "cons":
    case "array":
      if (depth >= state.maxDepth) return "#";
      return value.kind === "cons"
        ? renderCons(value, depth, state)
        : renderArray(value, depth, state);
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
