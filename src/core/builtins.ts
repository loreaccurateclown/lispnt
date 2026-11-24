import { LispEvalError } from "./errors";
import { printValue } from "./print";
import {
  arrayLength,
  ArrayValue,
  BuiltInValue,
  cons,
  ConsValue,
  HashTableValue,
  HashTest,
  intern,
  isNil,
  LispValue,
  NIL,
  StreamValue,
} from "./values";

export const builtins = new Map<string, BuiltInValue>(); //needed to assign a new map, not just map

export function applyBuiltIn(fn: BuiltInValue, args: LispValue[]) {
  if (args.length < fn.min || (fn.max !== null && args.length > fn.max)) {
    throw new LispEvalError(
      "arity",
      null,
      `${fn.name}: wrong number of arguments: got (${args.length})`,
    );
  }
  return fn.fn(args);
}

export function expectNumber(value: LispValue): number {
  if (value.kind !== "number")
    throw new LispEvalError("type-error", null, `expected a number, got ${value.kind}`);
  return value.value; //2 for 1 deal. great value
}

export function expectCons(value: LispValue): ConsValue {
  if (value.kind !== "cons")
    throw new LispEvalError("type-error", null, `expected a list, got ${value.kind}`);
  return value;
}

export function expectInteger(value: LispValue): number {
  const number = expectNumber(value);
  if (!Number.isInteger(number))
    throw new LispEvalError("type-error", null, `expected an integer, got ${number}`);
  return number;
}

export function expectArray(value: LispValue): ArrayValue {
  if (value.kind !== "array") {
    throw new LispEvalError("type-error", null, `expected an array, got ${value.kind}`);
  }
  return value;
}

export function expectStringValue(value: LispValue): string {
  if (value.kind !== "string")
    throw new LispEvalError("type-error", null, `expected a string, got ${value.kind}`);
  return value.value;
}

export function expectCharValue(value: LispValue): string {
  if (value.kind !== "char")
    throw new LispEvalError("type-error", null, `expected a character, got ${value.kind}`);
  return value.value;
}

export function expectStream(value: LispValue): StreamValue {
  if (value.kind !== "stream")
    throw new LispEvalError("type-error", null, `expected a stream, got ${value.kind}`);
  return value;
}

// With no stream argument there is nowhere to write, so the text is discarded
// and the call still returns its object, as CL's princ does.
function writeTo(stream: LispValue | undefined, text: string): void {
  if (stream === undefined || isNil(stream)) return;
  expectStream(stream).chunks.push(text);
}

// CL keyword arguments, shared by every builtin that takes them. A key Lispnt
// does not model is our gap and is reported as unsupported-standard; a
// non-keyword in a key position, or an odd number of arguments, is the caller's
// mistake. A repeated key keeps its first value, which is what SBCL does.
export function parseKeywords(
  args: readonly LispValue[],
  name: string,
  allowed: ReadonlySet<string>,
): Map<string, LispValue> {
  if (args.length % 2 !== 0)
    throw new LispEvalError(
      "malformed-form",
      null,
      `${name}: arguments come in :keyword value pairs`,
    );

  const given = new Map<string, LispValue>();

  for (let index = 0; index < args.length; index += 2) {
    const keyword = args[index]!;
    const key =
      keyword.kind === "symbol" && keyword.name.startsWith(":")
        ? keyword.name.toUpperCase()
        : undefined;

    if (key === undefined)
      throw new LispEvalError(
        "type-error",
        null,
        `${name}: expected a :keyword, got ${keyword.kind}`,
      );

    if (!allowed.has(key))
      throw new LispEvalError(
        "unsupported-standard",
        null,
        `${name} does not take ${key}`,
      );

    if (!given.has(key)) given.set(key, args[index + 1]!);
  }

  return given;
}

function expectSize(value: LispValue, name: string): number {
  const size = expectInteger(value);
  if (size < 0)
    throw new LispEvalError("index-error", null, `${name}: size ${size} is negative`);
  return size;
}


export function expectHashTable(value: LispValue): HashTableValue {
  if (value.kind !== "hash")
    throw new LispEvalError("type-error", null, `expected a hash table, got ${value.kind}`);
  return value;
}

// SCHAR and CHAR agree here: both read one character and both reject an index
// outside the string.
function charAt(sequence: LispValue, index: LispValue, name: string): LispValue {
  const text = expectStringValue(sequence);
  const at = expectInteger(index);
  if (at < 0 || at >= text.length)
    throw new LispEvalError("index-error", null, `${name}: index ${at} out of range`);
  return { kind: "char", value: text[at]! };
}

//don't confuse this from with form
export function listFrom(items: LispValue[], tail: LispValue = NIL): LispValue {
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

export function isEq(left: LispValue, right: LispValue): boolean {
  if (left === right) return true; //because it is
  if (left.kind === "number" && right.kind === "number")
    return left.value === right.value;
  if (left.kind === "string" && right.kind === "string")
    return left.value === right.value;
  // SBCL answers EQ true for two characters with the same code, though the
  // standard only promises EQL.
  if (left.kind === "char" && right.kind === "char")
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

register("CAR", 1, 1, (args) => carOf(args[0]!));
register("CDR", 1, 1, (args) => cdrOf(args[0]!));
register("CONS", 2, 2, (args) => cons(args[0]!, args[1]!));
register("LIST", 0, null, (args) => listFrom(args));
register("LENGTH", 1, 1, (args) => {
  const value = args[0]!;
  const size =
    value.kind === "array"
      ? arrayLength(value)
      : value.kind === "string"
        ? value.value.length
        : consForm(value).length;
  return {
    kind: "number",
    value: size,
  };
});
// A proper list has a length; a dotted one is a type error, and CL answers NIL
// for a circular one rather than looping — the seen set is what keeps a
// learner's (setf (cdr x) x) from hanging the analysis.
register("LIST-LENGTH", 1, 1, (args) => {
  const seen = new Set<object>();
  let value = args[0]!;
  let count = 0;

  while (value.kind === "cons") {
    if (seen.has(value)) return NIL;
    seen.add(value);
    value = value.cdr;
    count += 1;
  }

  if (!isNil(value))
    throw new LispEvalError("type-error", null, "LIST-LENGTH needs a proper list");

  return { kind: "number", value: count };
});
register("NOT", 1, 1, (args) => (isNil(args[0]!) ? intern("T") : NIL));
register("EQ", 2, 2, (args) => (isEq(args[0]!, args[1]!) ? intern("T") : NIL));
register("EQUAL", 2, 2, (args) =>
  isEqual(args[0]!, args[1]!) ? intern("T") : NIL,
);
register("EQUALP", 2, 2, (args) =>
  isEqualP(args[0]!, args[1]!) ? intern("T") : NIL,
);

// EQUALP descends where EQUAL does not: numbers by value, characters and strings
// ignoring case, conses recursively, arrays element by element up to the fill
// pointer, structures of the same type slot by slot. Hash tables compare by
// identity, as CL specifies.
function isEqualP(left: LispValue, right: LispValue): boolean {
  if (left === right) return true;

  if (left.kind === "number" && right.kind === "number")
    return left.value === right.value;
  if (left.kind === "char" && right.kind === "char")
    return left.value.toLowerCase() === right.value.toLowerCase();
  if (left.kind === "string" && right.kind === "string")
    return left.value.toLowerCase() === right.value.toLowerCase();
  if (left.kind === "cons" && right.kind === "cons")
    return isEqualP(left.car, right.car) && isEqualP(left.cdr, right.cdr);

  if (left.kind === "array" && right.kind === "array") {
    const length = arrayLength(left);
    if (length !== arrayLength(right)) return false;
    for (let index = 0; index < length; index += 1) {
      const a = left.elements[index];
      const b = right.elements[index];
      if (a === undefined || b === undefined || !isEqualP(a, b)) return false;
    }
    return true;
  }

  if (left.kind === "struct" && right.kind === "struct") {
    if (left.type !== right.type) return false;
    if (left.slots.size !== right.slots.size) return false;
    for (const [name, value] of left.slots) {
      const other = right.slots.get(name);
      if (other === undefined || !isEqualP(value, other)) return false;
    }
    return true;
  }

  return false;
}

register("/", 1, null, (args) => {
  //division. not too sure since Lisp does division Weirdly
  const first = expectNumber(args[0]!);
  if (args.length === 1) {
    if (first === 0)
      throw new LispEvalError("division-by-zero", null, "/: division by zero");
    return { kind: "number", value: 1 / first }; //moment of truth
  }
  return {
    kind: "number",
    value: args.slice(1).reduce((total, arg) => {
      const divisor = expectNumber(arg);
      if (divisor === 0)
        throw new LispEvalError("division-by-zero", null, "/: division by zero");
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

register("VECTOR", 0, null, (args) => ({ kind: "array", elements: args }));

// MAKE-ARRAY's keywords. Each builtin that takes keywords declares the set it
// models; anything else in a key position is our gap, not the caller's mistake.
const MAKE_ARRAY_KEYS: ReadonlySet<string> = new Set([
  ":INITIAL-ELEMENT",
  ":INITIAL-CONTENTS",
  ":ADJUSTABLE",
  ":FILL-POINTER",
]);
const MAKE_STRING_KEYS: ReadonlySet<string> = new Set([":INITIAL-ELEMENT"]);

register("MAKE-ARRAY", 1, null, (args) => {
  const size = expectSize(args[0]!, "MAKE-ARRAY");
  const keywords = parseKeywords(args.slice(1), "MAKE-ARRAY", MAKE_ARRAY_KEYS);

  const element = keywords.get(":INITIAL-ELEMENT");
  const contents = keywords.get(":INITIAL-CONTENTS");
  if (element !== undefined && contents !== undefined)
    throw new LispEvalError(
      "malformed-form",
      null,
      "MAKE-ARRAY: :initial-element and :initial-contents cannot both be given",
    );

  let elements: LispValue[];
  if (contents !== undefined) {
    // A list or a vector, either one is a sequence of the right length.
    const items =
      contents.kind === "array"
        ? contents.elements
        : contents.kind === "string"
          ? [...contents.value].map<LispValue>((character) => ({
              kind: "char",
              value: character,
            }))
          : consForm(contents);
    if (items.length !== size)
      throw new LispEvalError(
        "type-error",
        null,
        `MAKE-ARRAY: :initial-contents has ${items.length} elements, the array holds ${size}`,
      );
    elements = items.slice();
  } else {
    const initial = element ?? NIL;
    elements = Array.from({ length: size }, () => initial);
  }

  // :adjustable has no observable effect until the array is grown, which
  // VECTOR-PUSH-EXTEND does anyway.
  const fill = fillPointerFrom(keywords.get(":FILL-POINTER"), size);
  return fill === undefined
    ? { kind: "array", elements }
    : { kind: "array", elements, fillPointer: fill };
});

// T asks for the whole capacity; an integer below it is a partially filled
// vector, which is how a preallocated buffer starts life.
function fillPointerFrom(value: LispValue | undefined, size: number): number | undefined {
  if (value === undefined) return undefined;

  if (value.kind === "symbol" && value.name === "T") return size;

  if (value.kind !== "number")
    throw new LispEvalError(
      "type-error",
      null,
      "MAKE-ARRAY: a fill pointer is T or an integer",
    );

  const at = expectInteger(value);
  if (at < 0 || at > size)
    throw new LispEvalError(
      "index-error",
      null,
      `MAKE-ARRAY: fill pointer ${at} is outside an array of ${size}`,
    );
  return at;
}

// VECTOR-PUSH needs a fill pointer to know where the end is; VECTOR-PUSH-EXTEND
// grows the vector instead of returning NIL, which is what the preallocated
// vector and binary-heap idioms rely on.
function pushOntoVector(
  args: readonly LispValue[],
  extend: boolean,
  name: string,
): LispValue {
  const item = args[0]!;
  const vector = expectArray(args[1]!);
  if (args.length > 2)
    throw new LispEvalError(
      "unsupported-standard",
      null,
      `${name}: the extension argument is not implemented`,
    );

  const fill = vector.fillPointer;
  if (fill === undefined)
    throw new LispEvalError(
      "type-error",
      null,
      `${name}: the vector has no fill pointer`,
    );

  if (fill < vector.elements.length) {
    vector.elements[fill] = item;
    vector.fillPointer = fill + 1;
    return { kind: "number", value: fill };
  }

  if (!extend) return NIL;

  vector.elements.push(item);
  vector.fillPointer = fill + 1;
  return { kind: "number", value: fill };
}

register("VECTOR-PUSH", 2, 2, (args) => pushOntoVector(args, false, "VECTOR-PUSH"));
register("VECTOR-PUSH-EXTEND", 2, null, (args) =>
  pushOntoVector(args, true, "VECTOR-PUSH-EXTEND"),
);

register("MAKE-STRING", 1, null, (args) => {
  const size = expectSize(args[0]!, "MAKE-STRING");
  const keywords = parseKeywords(args.slice(1), "MAKE-STRING", MAKE_STRING_KEYS);
  const element = keywords.get(":INITIAL-ELEMENT");
  // CL leaves an unspecified character; SBCL fills with spaces.
  const character = element === undefined ? " " : expectCharValue(element);
  return { kind: "string", value: character.repeat(size) };
});

register("AREF", 2, 2, (args) => {
  const array = expectArray(args[0]!);
  const at = expectInteger(args[1]!);
  if (at < 0 || at >= array.elements.length)
    throw new LispEvalError("index-error", null, `AREF: index ${at} out of range`);
  return array.elements[at] ?? NIL;
});

register("ELT", 2, 2, (args) => {
  const at = expectInteger(args[1]!);
  const sequence = args[0]!;
  if (sequence.kind === "array") return sequence.elements[at] ?? NIL;
  // A string is a sequence of characters.
  if (sequence.kind === "string")
    return at >= 0 && at < sequence.value.length
      ? { kind: "char", value: [...sequence.value][at]! }
      : NIL;
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

// CL: the car and cdr of NIL are NIL; any other non-list is a type error.
// A tolerant reader lets learners walk a list without guarding every step.
function carOf(value: LispValue): LispValue {
  return isNil(value) ? NIL : expectCons(value).car;
}

function cdrOf(value: LispValue): LispValue {
  return isNil(value) ? NIL : expectCons(value).cdr;
}

//LLM-written registrations
register("FIRST", 1, 1, (args) => carOf(args[0]!));
register("SECOND", 1, 1, (args) => carOf(cdrOf(args[0]!)));
register("REST", 1, 1, (args) => cdrOf(args[0]!));
register("CADR", 1, 1, (args) => carOf(cdrOf(args[0]!)));
register("CADDR", 1, 1, (args) => carOf(cdrOf(cdrOf(args[0]!))));
register("EQL", 2, 2, (args) => (isEq(args[0]!, args[1]!) ? intern("T") : NIL));

register("NULL", 1, 1, (args) => (isNil(args[0]!) ? intern("T") : NIL));
register("ATOM", 1, 1, (args) =>
  args[0]!.kind === "cons" ? NIL : intern("T"),
);

register("NUMBERP", 1, 1, (args) =>
  args[0]!.kind === "number" ? intern("T") : NIL,
);
// Every number Lispnt has is real: there are no complex numbers.
register("REALP", 1, 1, (args) =>
  args[0]!.kind === "number" ? intern("T") : NIL,
);
register("STRINGP", 1, 1, (args) =>
  args[0]!.kind === "string" ? intern("T") : NIL,
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
  if (divisor === 0)
    throw new LispEvalError("division-by-zero", null, "MOD: division by zero");
  // CL's mod takes the sign of the divisor; JS % takes the sign of the dividend
  const remainder = (expectNumber(args[0]!) % divisor) + divisor;
  return { kind: "number", value: remainder % divisor };
});
register("FLOOR", 1, 2, (args) => {
  const value = expectNumber(args[0]!);
  const divisor = args[1] === undefined ? 1 : expectNumber(args[1]);
  if (divisor === 0)
    throw new LispEvalError(
      "division-by-zero",
      null,
      "FLOOR: division by zero",
    );
  const quotient = Math.floor(value / divisor);
  // CL's floor answers two values: the quotient and the remainder, which takes
  // the sign of the divisor.
  return {
    kind: "values",
    values: [
      { kind: "number", value: quotient },
      { kind: "number", value: value - quotient * divisor },
    ],
  };
});
register("SQRT", 1, 1, (args) => {
  const value = expectNumber(args[0]!);
  if (value < 0)
    throw new LispEvalError(
      "type-error",
      null,
      "SQRT: cannot take the square root of a negative number",
    );
  return { kind: "number", value: Math.sqrt(value) };
});

//LLM-written registrations for the evaluator-gap slice
register("1+", 1, 1, (args) => ({
  kind: "number",
  value: expectNumber(args[0]!) + 1,
}));

register("1-", 1, 1, (args) => ({
  kind: "number",
  value: expectNumber(args[0]!) - 1,
}));

register("MAX", 1, null, (args) => {
  let best = expectNumber(args[0]!);
  for (const arg of args.slice(1)) best = Math.max(best, expectNumber(arg));
  return { kind: "number", value: best };
});

register("MIN", 1, null, (args) => {
  let best = expectNumber(args[0]!);
  for (const arg of args.slice(1)) best = Math.min(best, expectNumber(arg));
  return { kind: "number", value: best };
});

register("BUTLAST", 1, 2, (args) => {
  const items = consForm(args[0]!);
  const count = args[1] === undefined ? 1 : expectInteger(args[1]);
  const keep = Math.max(0, items.length - Math.max(0, count));
  return listFrom(items.slice(0, keep));
});

register("SCHAR", 2, 2, (args) => charAt(args[0]!, args[1]!, "SCHAR"));
register("CHAR", 2, 2, (args) => charAt(args[0]!, args[1]!, "CHAR"));

// CL's character comparisons are variadic: they compare each character with the
// one after it, and answer T for fewer than two — (char= #\a) is T. The
// ...-EQUAL / ...-LESSP / ...-GREATERP family folds case; CHAR=, CHAR< and CHAR>
// do not.
function allChars(
  args: readonly LispValue[],
  same: (left: string, right: string) => boolean,
): boolean {
  for (let index = 1; index < args.length; index += 1) {
    const left = expectCharValue(args[index - 1]!);
    const right = expectCharValue(args[index]!);
    if (!same(left, right)) return false;
  }
  return true;
}

const charResult = (matched: boolean): LispValue => (matched ? intern("T") : NIL);

register("CHAR=", 0, null, (args) =>
  charResult(allChars(args, (left, right) => left === right)),
);

register("CHAR-EQUAL", 0, null, (args) =>
  charResult(
    allChars(args, (left, right) => left.toLowerCase() === right.toLowerCase()),
  ),
);

register("CHAR-LESSP", 0, null, (args) =>
  charResult(
    allChars(args, (left, right) => left.toLowerCase() < right.toLowerCase()),
  ),
);

register("CHAR-GREATERP", 0, null, (args) =>
  charResult(
    allChars(args, (left, right) => left.toLowerCase() > right.toLowerCase()),
  ),
);

register("CHAR<", 0, null, (args) =>
  charResult(allChars(args, (left, right) => left < right)),
);

register("CHAR>", 0, null, (args) =>
  charResult(allChars(args, (left, right) => left > right)),
);

register("CHAR-UPCASE", 1, 1, (args) => {
  const character = expectCharValue(args[0]!);
  const upper = character.toUpperCase();
  // A single character's uppercase form is not always one character (ß), and a
  // value here must stay one character.
  return { kind: "char", value: upper.length === 1 ? upper : character };
});

register("ERROR", 1, null, (args) => {
  const datum = args[0]!;
  const text = datum.kind === "string" ? datum.value : printValue(datum);
  const extras = args.slice(1).map((arg) => printValue(arg));
  throw new LispEvalError(
    "signalled-error",
    null,
    extras.length === 0 ? text : `${text} ${extras.join(" ")}`,
  );
});

// A type specifier is normally a quoted symbol, so the table is keyed by name.
// Anything not in it — compound specifiers such as (integer 0 10) or (or …), and
// a struct name no DEFSTRUCT has defined — is Lispnt's gap, not the learner's
// mistake: it is reported as unsupported-standard so analyze stays quiet rather
// than answering NIL.
// Type names defined by DEFSTRUCT, so TYPEP can answer (typep x 'tree-node).
// The interpreter adds to this when a structure is defined.
export const structTypeNames = new Set<string>();

const typePredicates = new Map<string, (value: LispValue) => boolean>([
  ["T", () => true],
  ["NIL", (value) => isNil(value)],
  ["NULL", (value) => isNil(value)],
  ["SYMBOL", (value) => value.kind === "symbol" || isNil(value)],
  ["KEYWORD", (value) => value.kind === "symbol" && value.name.startsWith(":")],
  ["HASH-TABLE", (value) => value.kind === "hash"],
  ["STREAM", (value) => value.kind === "stream"],
  ["NUMBER", (value) => value.kind === "number"],
  ["INTEGER", (value) => value.kind === "number" && Number.isInteger(value.value)],
  ["RATIONAL", (value) => value.kind === "number" && Number.isInteger(value.value)],
  ["FLOAT", (value) => value.kind === "number" && !Number.isInteger(value.value)],
  ["LIST", (value) => value.kind === "cons" || isNil(value)],
  ["CONS", (value) => value.kind === "cons"],
  ["ATOM", (value) => value.kind !== "cons"],
  ["ARRAY", (value) => value.kind === "array"],
  ["VECTOR", (value) => value.kind === "array"],
  ["STRING", (value) => value.kind === "string"],
  ["CHARACTER", (value) => value.kind === "char"],
  ["FUNCTION", (value) => value.kind === "function" || value.kind === "builtin"],
]);

register("TYPEP", 2, 2, (args) =>
  typepMatches(args[0]!, args[1]!) ? intern("T") : NIL,
);

// A type specifier is a name, a structure name, or a list whose head says how to
// combine the rest. CL has far more of these than Lispnt models: an unknown head
// stays unsupported-standard so it is silent rather than answering a confident
// NIL, which would be our gap reported as the learner's mistake.
function typepMatches(value: LispValue, specifier: LispValue): boolean {
  if (specifier.kind === "symbol") {
    const predicate = typePredicates.get(specifier.name);
    if (predicate !== undefined) return predicate(value);
    // A structure type is answered by comparing the instance's type name, so
    // (typep 5 'tree-node) is NIL once tree-node has been defined.
    if (structTypeNames.has(specifier.name))
      return value.kind === "struct" && value.type === specifier.name;
    throw unsupportedType(
      `TYPEP: Lispnt does not know the type specifier ${specifier.name}`,
    );
  }

  if (specifier.kind !== "cons")
    throw unsupportedType(
      "TYPEP: Lispnt answers type specifiers written as a symbol or a list",
    );

  const parts = consForm(specifier);
  const head = parts[0];
  const name = head?.kind === "symbol" ? head.name : undefined;
  const rest = parts.slice(1);

  switch (name) {
    case "OR":
      return rest.some((part) => typepMatches(value, part));
    case "AND":
      return rest.every((part) => typepMatches(value, part));
    case "NOT": {
      const only = rest[0];
      if (only === undefined) break;
      return !typepMatches(value, only);
    }
    case "MEMBER":
      return rest.some((candidate) => isEql(candidate, value));
    case "EQL": {
      const only = rest[0];
      if (only === undefined) break;
      return isEql(only, value);
    }
    case "INTEGER":
    case "RATIONAL":
    case "FLOAT":
      return matchesNumberRange(value, rest, name);
    case "MOD": {
      const bound = rest[0];
      if (bound === undefined || bound.kind !== "number") break;
      return (
        value.kind === "number" &&
        Number.isInteger(value.value) &&
        value.value >= 0 &&
        value.value < bound.value
      );
    }
    case "CONS":
      return matchesCons(value, rest);
    case "VECTOR":
      return matchesVector(value, rest);
    case "ARRAY":
      return value.kind === "array" && rest.length === 0;
    default:
      break;
  }

  throw unsupportedType(
    `TYPEP: Lispnt does not model the type specifier (${String(name ?? "?")} …)`,
  );
}

function unsupportedType(message: string): LispEvalError {
  return new LispEvalError("unsupported-standard", null, message);
}

// EQL, which is what MEMBER and EQL specifiers compare with: numbers and
// characters by value, symbols by name, anything else by identity.
function isEql(left: LispValue, right: LispValue): boolean {
  if (left.kind === "number" && right.kind === "number")
    return left.value === right.value;
  if (left.kind === "char" && right.kind === "char")
    return left.value === right.value;
  if (left.kind === "symbol" && right.kind === "symbol")
    return left.name === right.name;
  return isEq(left, right);
}

// (integer 0 10), (rational * 1), (float 0 *): bounds are inclusive, and * is
// the unbounded end. Lispnt's numbers are doubles, so INTEGER means an integer
// value and FLOAT the rest.
function matchesNumberRange(
  value: LispValue,
  bounds: readonly LispValue[],
  kind: string,
): boolean {
  if (value.kind !== "number") return false;
  if (kind === "INTEGER" && !Number.isInteger(value.value)) return false;
  if (kind === "FLOAT" && Number.isInteger(value.value)) return false;

  const low = bounds[0];
  const high = bounds[1];
  const atLeast =
    low === undefined ||
    (low.kind === "symbol" && low.name === "*") ||
    (low.kind === "number" && value.value >= low.value);
  const atMost =
    high === undefined ||
    (high.kind === "symbol" && high.name === "*") ||
    (high.kind === "number" && value.value <= high.value);
  return atLeast && atMost;
}

function matchesCons(value: LispValue, parts: readonly LispValue[]): boolean {
  if (value.kind !== "cons") return false;
  const carSpecifier = parts[0];
  if (carSpecifier === undefined) return true;
  if (!typepMatches(value.car, carSpecifier)) return false;
  const cdrSpecifier = parts[1];
  if (cdrSpecifier === undefined) return true;
  return typepMatches(value.cdr, cdrSpecifier);
}

function matchesVector(value: LispValue, parts: readonly LispValue[]): boolean {
  if (value.kind !== "array") return false;
  const element = parts[0];
  if (element === undefined) return true;

  const length = arrayLength(value);
  for (let index = 0; index < length; index += 1) {
    const item = value.elements[index];
    if (item === undefined || !typepMatches(item, element)) return false;
  }
  return true;
}

// A hash table finds a key again through a canonical string chosen by its
// :test. Atoms are compared by value; under eq/eql a cons, array or structure
// key is compared by identity; under equal/equalp by its full printed form, so
// two structurally equal lists are one key. Full printed form, not the
// truncated REPL form, so long keys do not collide.
const hashKeyIds = new WeakMap<object, number>();
let nextHashKeyId = 1;

export function hashTableKey(value: LispValue, test: HashTest): string {
  // EQUALP keys fold case in strings and characters and descend into lists,
  // arrays and structures, so "abc" and "ABC" are one key. The recursive key
  // carries a seen set, because a cyclic structure would otherwise recurse
  // forever; a cycle falls back to identity, which is stable for the run.
  if (test === "equalp") return `p:${equalpKey(value, new Set())}`;

  switch (value.kind) {
    case "nil":
      return "nil";
    case "number":
      return `n:${value.value}`;
    case "string":
      return `s:${value.value}`;
    case "char":
      return `c:${value.value}`;
    case "symbol":
      return `y:${value.name}`;
    default:
      break;
  }

  if (test === "eq" || test === "eql") return `o:${identityId(value)}`;

  return `e:${printValue(value, {
    maxElements: Number.POSITIVE_INFINITY,
    maxDepth: Number.POSITIVE_INFINITY,
  })}`;
}

function identityId(value: LispValue): number {
  const object = value as unknown as object;
  const known = hashKeyIds.get(object);
  if (known !== undefined) return known;
  const id = nextHashKeyId;
  nextHashKeyId += 1;
  hashKeyIds.set(object, id);
  return id;
}

// The canonical form EQUALP would compare by: numbers by value, strings and
// characters ignoring case, conses, arrays and structures recursively.
function equalpKey(value: LispValue, seen: Set<object>): string {
  switch (value.kind) {
    case "nil":
      return "nil";
    case "number":
      return `n:${value.value}`;
    case "string":
      return `s:${value.value.toLowerCase()}`;
    case "char":
      return `c:${value.value.toLowerCase()}`;
    case "symbol":
      return `y:${value.name}`;
    case "cons": {
      const object = value as unknown as object;
      if (seen.has(object)) return `o:${identityId(value)}`;
      seen.add(object);
      const key = `(${equalpKey(value.car, seen)} . ${equalpKey(value.cdr, seen)})`;
      seen.delete(object);
      return key;
    }
    case "array": {
      const object = value as unknown as object;
      if (seen.has(object)) return `o:${identityId(value)}`;
      seen.add(object);
      const length = arrayLength(value);
      const parts: string[] = [];
      for (let index = 0; index < length; index += 1) {
        const item = value.elements[index];
        parts.push(item === undefined ? "nil" : equalpKey(item, seen));
      }
      seen.delete(object);
      return `#(${parts.join(" ")})`;
    }
    case "struct": {
      const object = value as unknown as object;
      if (seen.has(object)) return `o:${identityId(value)}`;
      seen.add(object);
      const slots: string[] = [];
      for (const [name, slot] of value.slots) {
        slots.push(`${name}=${equalpKey(slot, seen)}`);
      }
      seen.delete(object);
      return `#S(${value.type} ${slots.join(" ")})`;
    }
    default:
      // Hash tables compare by identity under EQUALP, and so do streams,
      // functions and the rest.
      return `o:${identityId(value)}`;
  }
}

const hashTests: ReadonlyMap<string, HashTest> = new Map<string, HashTest>([
  ["EQ", "eq"],
  ["EQL", "eql"],
  ["EQUAL", "equal"],
  ["EQUALP", "equalp"],
]);

// A :test is a function designator, so the symbol naming one works as well as
// the function value itself.
function hashTestFromFunction(value: LispValue): HashTest {
  const name =
    value.kind === "builtin"
      ? value.name
      : value.kind === "symbol"
        ? value.name
        : "";
  const test = hashTests.get(name);
  if (test !== undefined) return test;

  throw new LispEvalError(
    "unsupported-standard",
    null,
    "MAKE-HASH-TABLE: only EQ, EQL, EQUAL and EQUALP are supported as :test",
  );
}

// :size and the rehash hints describe how the table is laid out. CL gives them
// no effect a program can observe, so they are checked and then ignored.
const MAKE_HASH_TABLE_KEYS: ReadonlySet<string> = new Set([
  ":TEST",
  ":SIZE",
  ":REHASH-SIZE",
  ":REHASH-THRESHOLD",
]);

register("MAKE-HASH-TABLE", 0, null, (args) => {
  const keywords = parseKeywords(args, "MAKE-HASH-TABLE", MAKE_HASH_TABLE_KEYS);

  const testNode = keywords.get(":TEST");
  const test: HashTest = testNode === undefined ? "eql" : hashTestFromFunction(testNode);

  const size = keywords.get(":SIZE");
  if (size !== undefined) expectSize(size, "MAKE-HASH-TABLE");

  const rehashSize = keywords.get(":REHASH-SIZE");
  if (rehashSize !== undefined) expectNumber(rehashSize);

  const rehashThreshold = keywords.get(":REHASH-THRESHOLD");
  if (rehashThreshold !== undefined) expectNumber(rehashThreshold);

  return { kind: "hash", test, entries: new Map() };
});

// CL's gethash answers two values: the value (or the default) and whether the
// key was present.
register("GETHASH", 2, 3, (args) => {
  const table = expectHashTable(args[1]!);
  const entry = table.entries.get(hashTableKey(args[0]!, table.test));
  return {
    kind: "values",
    values: [
      entry === undefined ? (args[2] ?? NIL) : entry.value,
      entry === undefined ? NIL : intern("T"),
    ],
  };
});

register("REMHASH", 2, 2, (args) => {
  const table = expectHashTable(args[1]!);
  return table.entries.delete(hashTableKey(args[0]!, table.test))
    ? intern("T")
    : NIL;
});

register("CLRHASH", 1, 1, (args) => {
  const table = expectHashTable(args[0]!);
  table.entries.clear();
  return table;
});

register("HASH-TABLE-COUNT", 1, 1, (args) => ({
  kind: "number",
  value: expectHashTable(args[0]!).entries.size,
}));

register("HASH-TABLE-P", 1, 1, (args) =>
  args[0]!.kind === "hash" ? intern("T") : NIL,
);

// CL answers the test as a function designator; the table stores it by name.
register("HASH-TABLE-TEST", 1, 1, (args) =>
  intern(expectHashTable(args[0]!).test.toUpperCase()),
);


// FORMAT — a control string with a small directive language. NIL returns the
// string; T returns NIL and discards it, because Lispnt has no console. A
// directive CL defines but Lispnt has not built is our gap (unsupported-
// standard); a character that is not a directive at all is the learner's
// mistake (malformed-form).
const implementedDirectives = new Set(["A", "S", "D", "%", "~", "&"]);

// ANSI FORMAT directives. Anything here that is not in implementedDirectives is
// valid CL we have not built.
const standardDirectives = new Set([
  "A", "S", "D", "B", "O", "X", "R", "P", "C", "F", "E", "G", "$",
  "%", "&", "~", "T", "<", ">", "[", "]", "{", "}", "?", "*", "^",
  "|", "_", "I", "W", "N",
]);

function formatText(control: string, args: LispValue[]): string {
  let out = "";
  let next = 0;

  const argument = (directive: string): LispValue => {
    const value = args[next];
    if (value === undefined)
      throw new LispEvalError(
        "malformed-form",
        null,
        `FORMAT: not enough arguments for ~${directive}`,
      );
    next += 1;
    return value;
  };

  for (let index = 0; index < control.length; index += 1) {
    const character = control[index]!;
    if (character !== "~") {
      out += character;
      continue;
    }

    index += 1;
    const raw = control[index];
    if (raw === undefined)
      throw new LispEvalError(
        "malformed-form",
        null,
        "FORMAT: the control string ends with ~",
      );

    // Prefix parameters and modifiers (~5d, ~:@a, ~,2f) are not implemented.
    if ("0123456789,:'@vV#+-".includes(raw))
      throw new LispEvalError(
        "unsupported-standard",
        null,
        "FORMAT: directive parameters and modifiers are not implemented",
      );

    const directive = raw.toUpperCase();

    if (!implementedDirectives.has(directive)) {
      if (standardDirectives.has(directive))
        throw new LispEvalError(
          "unsupported-standard",
          null,
          `FORMAT: the ~${directive} directive is not implemented`,
        );
      throw new LispEvalError(
        "malformed-form",
        null,
        `FORMAT: ~${raw} is not a FORMAT directive`,
      );
    }

    switch (directive) {
      case "A":
        out += printValue(argument("A"), { princ: true });
        break;
      case "S":
        out += printValue(argument("S"));
        break;
      case "D":
        out += String(expectInteger(argument("D")));
        break;
      case "%":
        out += "\n";
        break;
      case "~":
        out += "~";
        break;
      case "&":
        // Fresh-line: only when the output does not already start a new line.
        if (out.length > 0 && !out.endsWith("\n")) out += "\n";
        break;
    }
  }

  return out;
}

register("VALUES", 0, null, (args) => ({ kind: "values", values: args }));

register("FORMAT", 2, null, (args) => {
  const destination = args[0]!;
  const control = expectStringValue(args[1]!);

  if (destination.kind === "nil")
    return { kind: "string", value: formatText(control, args.slice(2)) };

  if (destination.kind === "symbol" && destination.name === "T") {
    formatText(control, args.slice(2));
    return NIL;
  }

  if (destination.kind === "stream") {
    destination.chunks.push(formatText(control, args.slice(2)));
    return NIL;
  }

  throw new LispEvalError(
    "unsupported-standard",
    null,
    "FORMAT: only NIL, T and a string output stream are implemented as destinations",
  );
});

// Writing: a string output stream collects text until with-output-to-string
// returns it. Without a stream, the text is discarded — Lispnt has no console.
register("WRITE-CHAR", 1, 2, (args) => {
  writeTo(args[1], expectCharValue(args[0]!));
  return args[0]!;
});

register("WRITE-STRING", 1, 2, (args) => {
  writeTo(args[1], expectStringValue(args[0]!));
  return args[0]!;
});

register("PRINC", 1, 2, (args) => {
  writeTo(args[1], printValue(args[0]!, { princ: true }));
  return args[0]!;
});

register("PRIN1", 1, 2, (args) => {
  writeTo(args[1], printValue(args[0]!));
  return args[0]!;
});

register("PRINC-TO-STRING", 1, 1, (args) => ({
  kind: "string",
  value: printValue(args[0]!, { princ: true }),
}));

register("PRIN1-TO-STRING", 1, 1, (args) => ({
  kind: "string",
  value: printValue(args[0]!),
}));


// GETF reads a property list: pairs of indicator and value. `eql` is CL's test.
register("GETF", 2, 3, (args) => {
  const entry = findProperty(args[0]!, args[1]!);
  return entry === undefined ? (args[2] ?? NIL) : entry.value;
});

export function findProperty(
  plist: LispValue,
  indicator: LispValue,
): { readonly value: LispValue } | undefined {
  if (plist.kind !== "cons" && !isNil(plist))
    throw new LispEvalError(
      "type-error",
      null,
      `GETF: expected a property list, got ${plist.kind}`,
    );

  let cursor = plist;
  while (cursor.kind === "cons") {
    const rest = cursor.cdr;
    if (!isNil(rest) && rest.kind !== "cons")
      throw new LispEvalError(
        "malformed-form",
        null,
        "GETF: the property list ends with a lone indicator",
      );
    if (rest.kind !== "cons") break;
    if (isEq(cursor.car, indicator)) return { value: rest.car };
    cursor = rest.cdr;
  }
  return undefined;
}

export function setProperty(
  plist: LispValue,
  indicator: LispValue,
  value: LispValue,
): LispValue {
  let cursor = plist;
  while (cursor.kind === "cons") {
    const rest = cursor.cdr;
    if (rest.kind !== "cons") break;
    if (isEq(cursor.car, indicator)) {
      rest.car = value;
      return plist;
    }
    cursor = rest.cdr;
  }
  // Absent: a new pair goes on the front, as CL's getf place does.
  return cons(indicator, cons(value, plist));
}

// STRING< compares string designators — a string, a symbol's name, or a
// character as a one-character string.
function stringDesignator(value: LispValue, name: string): string {
  if (value.kind === "string") return value.value;
  if (value.kind === "symbol") return value.name;
  if (value.kind === "char") return value.value;
  throw new LispEvalError("type-error", null, `${name}: expected a string designator, got ${value.kind}`);
}

// CL's STRING< answers the index of the first character where the strings differ
// (or the length of the shorter one when it is a proper prefix), and NIL when the
// order does not hold — not T, because callers may use the index.
register("STRING<", 2, 2, (args) => {
  const left = stringDesignator(args[0]!, "STRING<");
  const right = stringDesignator(args[1]!, "STRING<");
  const limit = Math.min(left.length, right.length);

  for (let index = 0; index < limit; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    if (a !== b) return a < b ? { kind: "number", value: index } : NIL;
  }

  return left.length < right.length
    ? { kind: "number", value: left.length }
    : NIL;
});



