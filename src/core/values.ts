import { AstNode } from "./reader";

export type SymbolValue = { kind: "symbol"; name: string };
export type NumberValue = { kind: "number"; value: number };
export type StringValue = { kind: "string"; value: string };
export type NilValue = { kind: "nil" };
export type ConsValue = { kind: "cons"; car: LispValue; cdr: LispValue };

export interface Env {
  vars: Map<string, LispValue>;
  parent: Env | null;
}

//mutable
type ArrayValue = { kind: "array"; elements: LispValue[] };
export type LispValue =
  | SymbolValue
  | NumberValue
  | StringValue
  | NilValue
  | ConsValue
  | ArrayValue
  | FunctionValue
  | BuiltInValue;

export type FunctionValue = {
  kind: "function";
  name: string;
  params: string[];
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
};

export const NIL: NilValue = { kind: "nil" };
export const symbols = new Map<string, SymbolValue>();

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
