import { LispEvalError } from "./errors";
import { printValue } from "./print";
import {
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
      ? value.elements.length
      : value.kind === "string"
        ? value.value.length
        : consForm(value).length;
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

// CL's COUNT takes :test, :key, :start, :end and :from-end. Lispnt has no
// keyword arguments anywhere, so this is the two-argument form and the arity
// check is what a keyword call meets.
register("COUNT", 2, 2, (args) => {
  const item = args[0]!;
  const sequence = args[1]!;
  const items =
    sequence.kind === "array" ? sequence.elements : consForm(sequence);
  let total = 0;
  for (const candidate of items) if (isEqual(candidate, item)) total += 1;
  return { kind: "number", value: total };
});

register("BUTLAST", 1, 2, (args) => {
  const items = consForm(args[0]!);
  const count = args[1] === undefined ? 1 : expectInteger(args[1]);
  const keep = Math.max(0, items.length - Math.max(0, count));
  return listFrom(items.slice(0, keep));
});

register("SCHAR", 2, 2, (args) => charAt(args[0]!, args[1]!, "SCHAR"));
register("CHAR", 2, 2, (args) => charAt(args[0]!, args[1]!, "CHAR"));

register("CHAR=", 2, 2, (args) =>
  expectCharValue(args[0]!) === expectCharValue(args[1]!)
    ? intern("T")
    : NIL,
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

register("TYPEP", 2, 2, (args) => {
  const specifier = args[1]!;
  if (specifier.kind !== "symbol")
    throw new LispEvalError(
      "unsupported-standard",
      null,
      `TYPEP: Lispnt answers type specifiers written as a symbol, got ${specifier.kind}`,
    );

  const predicate = typePredicates.get(specifier.name);
  if (predicate !== undefined)
    return predicate(args[0]!) ? intern("T") : NIL;

  // A structure type is answered by comparing the instance's type name, so
  // (typep 5 'tree-node) is NIL once tree-node has been defined.
  if (structTypeNames.has(specifier.name)) {
    const value = args[0]!;
    return value.kind === "struct" && value.type === specifier.name
      ? intern("T")
      : NIL;
  }

  throw new LispEvalError(
    "unsupported-standard",
    null,
    `TYPEP: Lispnt does not know the type specifier ${specifier.name}`,
  );
});

// A hash table finds a key again through a canonical string chosen by its
// :test. Atoms are compared by value; under eq/eql a cons, array or structure
// key is compared by identity; under equal/equalp by its full printed form, so
// two structurally equal lists are one key. Full printed form, not the
// truncated REPL form, so long keys do not collide.
const hashKeyIds = new WeakMap<object, number>();
let nextHashKeyId = 1;

export function hashTableKey(value: LispValue, test: HashTest): string {
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

  if (test === "eq" || test === "eql") {
    const object = value as unknown as object;
    const known = hashKeyIds.get(object);
    if (known !== undefined) return `o:${known}`;
    const id = nextHashKeyId;
    nextHashKeyId += 1;
    hashKeyIds.set(object, id);
    return `o:${id}`;
  }

  return `e:${printValue(value, {
    maxElements: Number.POSITIVE_INFINITY,
    maxDepth: Number.POSITIVE_INFINITY,
  })}`;
}

const hashTests: ReadonlyMap<string, HashTest> = new Map<string, HashTest>([
  ["EQ", "eq"],
  ["EQL", "eql"],
  ["EQUAL", "equal"],
  ["EQUALP", "equalp"],
]);

function hashTestFromFunction(value: LispValue): HashTest {
  if (value.kind === "builtin") {
    const test = hashTests.get(value.name);
    if (test !== undefined) return test;
  }
  throw new LispEvalError(
    "unsupported-standard",
    null,
    "MAKE-HASH-TABLE: only EQ, EQL, EQUAL and EQUALP are supported as :test",
  );
}

register("MAKE-HASH-TABLE", 0, null, (args) => {
  let test: HashTest = "eql";

  for (let index = 0; index < args.length; index += 2) {
    const keyword = args[index]!;
    const name = keyword.kind === "symbol" ? keyword.name : "";
    if (name !== ":TEST")
      throw new LispEvalError(
        "unsupported-standard",
        null,
        `MAKE-HASH-TABLE: the ${name || keyword.kind} option is not implemented`,
      );

    const value = args[index + 1];
    if (value === undefined)
      throw new LispEvalError(
        "malformed-form",
        null,
        "MAKE-HASH-TABLE: :test needs a function",
      );
    test = hashTestFromFunction(value);
  }

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

register("STRING<", 2, 2, (args) =>
  stringDesignator(args[0]!, "STRING<") < stringDesignator(args[1]!, "STRING<")
    ? intern("T")
    : NIL,
);



