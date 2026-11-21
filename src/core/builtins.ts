import {
  ArrayValue,
  BuiltInValue,
  cons,
  ConsValue,
  intern,
  isNil,
  LispValue,
  NIL,
} from "./values";

export const builtins = new Map<string, BuiltInValue>(); //needed to assign a new map, not just map

export function applyBuiltIn(fn: BuiltInValue, args: LispValue[]) {
  if (args.length < fn.min || (fn.max !== null && args.length > fn.max)) {
    throw new Error(
      `${fn.name}: wrong number of arguments: got (${args.length})`,
    );
  }
  return fn.fn(args);
}

export function expectNumber(value: LispValue): number {
  if (value.kind !== "number")
    throw new Error(`expected a number, got ${value.kind}`);
  return value.value; //2 for 1 deal. great value
}

export function expectCons(value: LispValue): ConsValue {
  if (value.kind !== "cons")
    throw new Error(`expected a list, got ${value.kind}`);
  return value;
}

export function expectInteger(value: LispValue): number {
  const number = expectNumber(value);
  if (!Number.isInteger) throw new Error(`expected an integer, got ${number}`);
  return number;
}

export function expectArray(value: LispValue): ArrayValue {
  if (value.kind !== "array") {
    throw new Error(`expected an array, got ${value.kind}`);
  }
  return value;
}

//don't confuse this from with form
function listFrom(items: LispValue[], tail: LispValue = NIL): LispValue {
  let result: LispValue = tail;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    result = cons(items[index]!, result);
  }

  return result;
}

//don't confuse this form with from either!!!!
export function consForm(value: LispValue): LispValue[] {
  const items: LispValue[] = [];
  let cursor = value;
  while (cursor.kind === "cons") {
    items.push(cursor.car);
    cursor = cursor.cdr;
  }
  return items;
}

function isEq(left: LispValue, right: LispValue): boolean {
  if (left === right) return true; //because it is
  if (left.kind === "number" && right.kind === "number")
    return left.value === right.value;
  if (left.kind === "string" && right.kind === "string")
    return left.value === right.value;

  return false; //because it isn't
}

function isEqual(left: LispValue, right: LispValue): boolean {
  if (isEq(left, right)) return true;
  if (left.kind === "cons" && right.kind === "cons") {
    return isEqual(left.car, right.car) && isEqual(left.cdr, right.cdr);
  }
  if (left.kind === "array" && right.kind === "array") {
    return (
      left.elements.length === right.elements.length &&
      left.elements.every((element, index) =>
        isEqual(element, right.elements[index]!),
      )
    );
  }
  return false;
}

function compareChain(
  args: LispValue[],
  test: (a: number, b: number) => boolean,
): LispValue {
  for (let index = 0; index + 1 < args.length; index += 1) {
    if (!test(expectNumber(args[index]!), expectNumber(args[index + 1]!)))
      return NIL;
  }
  return intern("T");
}

export function register(
  name: string,
  min: number,
  max: number | null,
  fn: (args: LispValue[]) => LispValue,
): void {
  builtins.set(name, { kind: "builtin", name, min, max, fn });
}

//apparently you can just set these without a function container? they're saved to a table somewhere? I don't know
//2 hours later: I remembered what RAM is. The table sits in RAM. computeing
register("+", 0, null, (args) => ({
  kind: "number",
  value: args.reduce((total, arg) => total + expectNumber(arg), 0),
}));

register("-", 1, null, (args) => {
  const first = expectNumber(args[0]!);
  if (args.length === 1) return { kind: "number", value: -first };
  return {
    kind: "number",
    value: args
      .slice(1)
      .reduce((total, arg) => total - expectNumber(arg), first),
  };
});

register("CAR", 1, 1, (args) => expectCons(args[0]!).car);
register("CDR", 1, 1, (args) => expectCons(args[0]!).cdr);
register("CONS", 2, 2, (args) => cons(args[0]!, args[1]!));
register("LIST", 0, null, (args) => listFrom(args));
register("LENGTH", 1, 1, (args) => {
  const value = args[0]!;
  const size =
    value.kind === "array" ? value.elements.length : consForm(value).length;
  return {
    kind: "number",
    value: size,
  };
});
register("NOT", 1, 1, (args) => (isNil(args[0]!) ? intern("T") : NIL));
register("EQ", 2, 2, (args) => (isEq(args[0]!, args[1]!) ? intern("T") : NIL));
register("EQUAL", 2, 2, (args) =>
  isEqual(args[0]!, args[1]!) ? intern("T") : NIL,
);
register("EQUALP", 2, 2, (args) =>
  isEqual(args[0]!, args[1]!) ? intern("T") : NIL,
); //in a modern language this ends up more or less being the same it seems

register("/", 1, null, (args) => {
  //division. not too sure since Lisp does division Weirdly
  const first = expectNumber(args[0]!);
  if (args.length === 1) {
    if (first === 0) throw new Error("/: division by zero");
    return { kind: "number", value: 1 / first }; //moment of truth
  }
  return {
    kind: "number",
    value: args.slice(1).reduce((total, arg) => {
      const divisor = expectNumber(arg);
      if (divisor === 0) throw new Error("/: division by zero");
      return total / divisor; //hmm
    }, first),
  };
});

register("APPEND", 0, null, (args) => {
  if (args.length === 0) return NIL;
  const last = args[args.length - 1];
  const heads = args.slice(0, -1).flatMap((arg) => consForm(arg));
  return listFrom(heads, last);
});

register("ASSOC", 2, 2, (args) => {
  const key = args[0]!;
  for (const entry of consForm(args[1]!)) {
    if (entry.kind === "cons" && isEqual(entry.car, key)) return entry;
  }
  return NIL;
});

register("VECTOR", 0, null, (args) => {
  const size = expectInteger(args[0]!);
  const initial = args[2] === undefined ? NIL : args[2];
  return {
    kind: "array",
    elements: args,
  };
});

register("MAKE-ARRAY", 1, null, (args) => {
  const size = expectInteger(args[0]!);
  const initial = args[2] === undefined ? NIL : args[2]; //:initial-element value
  return {
    kind: "array",
    elements: Array.from({ length: size }, () => initial),
  };
});

register("AREF", 2, 2, (args) => {
  const array = expectArray(args[0]!);
  const at = expectInteger(args[1]!);
  if (at < 0 || at >= array.elements.length)
    throw new Error(`AREF: index ${at} out of range`);
  return array.elements[at] ?? NIL;
});

register("ELT", 2, 2, (args) => {
  const at = expectInteger(args[1]!);
  const sequence = args[0]!;
  if (sequence.kind === "array") return sequence.elements[at] ?? NIL;
  return consForm(sequence)[at] ?? NIL;
});

register("=", 1, null, (args) => compareChain(args, (a, b) => a === b));
register("<", 1, null, (args) => compareChain(args, (a, b) => a < b));
register(">", 1, null, (args) => compareChain(args, (a, b) => a > b));
register("<=", 1, null, (args) => compareChain(args, (a, b) => a <= b));
register(">=", 1, null, (args) => compareChain(args, (a, b) => a >= b));

register("/=", 1, null, (args) => {
  //CL's /= is all pairs, not just adjacent forms
  for (let i = 0; i < args.length; i += 1) {
    for (let j = i + 1; j < args.length; j += 1) {
      if (expectNumber(args[i]!) === expectNumber(args[j]!)) return NIL; //non-equality check
    }
  }
  return intern("T");
});

register("REVERSE", 1, 1, (args) => listFrom(consForm(args[0]!).reverse()));
register("NREVERSE", 1, 1, (args) => listFrom(consForm(args[0]!).reverse())); //we do Not mutate the list here unlike CL

//LLM-written registrations
register("FIRST", 1, 1, (args) => expectCons(args[0]!).car);
register("REST", 1, 1, (args) => expectCons(args[0]!).cdr);
register("CADR", 1, 1, (args) => expectCons(expectCons(args[0]!).cdr).car);
register(
  "CADDR",
  1,
  1,
  (args) => expectCons(expectCons(expectCons(args[0]!).cdr).cdr).car,
);
register("EQL", 2, 2, (args) => (isEq(args[0]!, args[1]!) ? intern("T") : NIL));

register("NULL", 1, 1, (args) => (isNil(args[0]!) ? intern("T") : NIL));
register("ATOM", 1, 1, (args) =>
  args[0]!.kind === "cons" ? NIL : intern("T"),
);

register("NUMBERP", 1, 1, (args) =>
  args[0]!.kind === "number" ? intern("T") : NIL,
);
register("INTEGERP", 1, 1, (args) => {
  const value = args[0]!;
  return value.kind === "number" && Number.isInteger(value.value)
    ? intern("T")
    : NIL;
});
register("ZEROP", 1, 1, (args) =>
  expectNumber(args[0]!) === 0 ? intern("T") : NIL,
);
register("EVENP", 1, 1, (args) =>
  expectNumber(args[0]!) % 2 === 0 ? intern("T") : NIL,
);
register("ODDP", 1, 1, (args) =>
  expectNumber(args[0]!) % 2 !== 0 ? intern("T") : NIL,
);

register("*", 0, null, (args) => ({
  kind: "number",
  value: args.reduce((total, arg) => total * expectNumber(arg), 1),
}));
register("EXPT", 2, 2, (args) => ({
  kind: "number",
  value: expectNumber(args[0]!) ** expectNumber(args[1]!),
}));
register("MOD", 2, 2, (args) => {
  const divisor = expectNumber(args[1]!);
  if (divisor === 0) throw new Error("MOD: division by zero");
  // CL's mod takes the sign of the divisor; JS % takes the sign of the dividend
  const remainder = (expectNumber(args[0]!) % divisor) + divisor;
  return { kind: "number", value: remainder % divisor };
});
register("FLOOR", 1, 1, (args) => ({
  kind: "number",
  value: Math.floor(expectNumber(args[0]!)),
}));
register("SQRT", 1, 1, (args) => {
  const value = expectNumber(args[0]!);
  if (value < 0)
    throw new Error("SQRT: cannot take the square root of a negative number");
  return { kind: "number", value: Math.sqrt(value) };
});
