import { AstNode } from "./reader";

export type SymbolValue = { kind: "symbol"; name: string };
export type NumberValue = { kind: "number"; value: number; float?: boolean };
export type StringValue = { kind: "string"; value: string };
// A character is its own type in Common Lisp: not a string, not a number, and
// case matters (#\a and #\A are different characters). The value is the single
// character itself, never the name a reader used to write it.
export type CharValue = { kind: "char"; value: string };
export type NilValue = { kind: "nil" };
export type ConsValue = { kind: "cons"; car: LispValue; cdr: LispValue };

// A number carries whether it was written as a float. The flag is left off for
// integers rather than set to false, so an integer stays a plain value.
export function numberValue(value: number, float = false): NumberValue {
  return float ? { kind: "number", value, float: true } : { kind: "number", value };
}

export function isFloatNumber(value: LispValue): boolean {
  return value.kind === "number" && value.float === true;
}

export interface Env {
  vars: Map<string, LispValue>;
  parent: Env | null;
}

export interface Place {
  get(): LispValue;
  set(value: LispValue): void;
}

//mutable
// A vector may carry a fill pointer: length and printing stop there, while aref
// stays bounded by the capacity, which is what lets the push-then-read idiom
// work on a big preallocated vector.
export type ArrayValue = {
  kind: "array";
  elements: LispValue[];
  fillPointer?: number;
};
// A structure instance: its type name, and its slots in definition order. A
// defstruct accessor is setf-able in CL unless the slot is :read-only, so the
// slot map is mutable.
export type StructValue = {
  kind: "struct";
  type: string;
  slots: Map<string, LispValue>;
};
// A hash table. Keys are kept by a canonical form chosen by `test`, so the
// table can find a key again without hashing an arbitrary object.
export type HashTest = "eq" | "eql" | "equal" | "equalp";
// A string output stream: with-output-to-string binds one for its body, and
// the write functions append to it.
export type StreamValue = { kind: "stream"; chunks: string[] };
// Several values from one form. It never reaches a single-value context —
// evaluate() takes the primary — and exists so VALUES, MULTIPLE-VALUE-BIND and
// the trace can see the rest.
export type ValuesValue = { kind: "values"; values: LispValue[] };
export type HashTableValue = {
  kind: "hash";
  test: HashTest;
  entries: Map<string, { key: LispValue; value: LispValue }>;
};
export type LispValue =
  | SymbolValue
  | NumberValue
  | StringValue
  | CharValue
  | NilValue
  | ConsValue
  | ArrayValue
  | StructValue
  | HashTableValue
  | StreamValue
  | ValuesValue
  | FunctionValue
  | BuiltInValue;

// A lambda list, parsed once when a function is defined rather than on every
// call: a malformed one is an error at the definition, which is the line the
// learner wrote. `default` and `init` stay unevaluated — CL runs them in the
// call's scope, so they can see the parameters bound before them.
export type OptionalParameter = {
  name: string;
  default?: AstNode;
  suppliedP?: string;
};
// A &key parameter answers to a keyword name, which the ((:kw var) …) form can
// make different from the variable it binds.
export type KeywordParameter = OptionalParameter & { keyword: string };
export type LambdaList = {
  required: string[];
  optional: OptionalParameter[];
  rest?: string;
  keys: KeywordParameter[];
  aux: Array<{ name: string; init?: AstNode }>;
};
export type FunctionValue = {
  kind: "function";
  name: string;
  lambdaList: LambdaList;
  body: AstNode[];
  env: Env;
};

export type BuiltInValue = {
  //apparently this kind of table lets us avoid switch casing in the function
  kind: "builtin";
  name: string;
  min: number;
  max: number | null;
  fn: (args: LispValue[]) => LispValue;
  // Set on a defstruct accessor: the type it reads and the slot it names, so
  // resolvePlace can treat (accessor object) as an assignable place.
  readonly accessor?: { readonly type: string; readonly slot: string };
};

export const NIL: NilValue = { kind: "nil" };
export const symbols = new Map<string, SymbolValue>();

// How many elements a vector is said to hold: its fill pointer when it has one,
// otherwise its capacity.
export function arrayLength(value: ArrayValue): number {
  return value.fillPointer ?? value.elements.length;
}

export function cons(car: LispValue, cdr: LispValue): ConsValue {
  return { kind: "cons", car, cdr };
}

export function isTruthy(value: LispValue): boolean {
  return value !== NIL;
}

export function intern(name: string): SymbolValue {
  const key = name.toUpperCase(); //matching SBCL which is apparently case insensitive when compiling?
  const existing = symbols.get(key);
  if (existing !== undefined) return existing;

  const created: SymbolValue = { kind: "symbol", name: key };
  symbols.set(key, created);
  return created;
}

export function isNil(value: LispValue): boolean {
  return value === NIL; //Computer Science is a complex field with many varied and interesting solutions to problems. This is not one of those solutions.
}


