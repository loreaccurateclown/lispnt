
type SymbolValue = { kind: "symbol"; name: string };
type NumberValue = { kind: "number"; value: number };
type StringValue = { kind: "string"; value: string };
type NilValue = { kind: "nil" };
type ConsValue = { kind: "cons"; car: LispValue; cdr: LispValue };


//mutable
type ArrayValue = { kind: "array"; elements: LispValue[] };
export type LispValue =
  | SymbolValue
  | NumberValue
  | StringValue
  | NilValue
  | ConsValue
  | ArrayValue;

export const NIL: NilValue = { kind: "nil" };
export const symbols = new Map<string, SymbolValue>();

export function cons(car: LispValue, cdr: LispValue): ConsValue {
    return { kind: "cons", car, cdr}
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

