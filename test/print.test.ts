import { test } from "node:test";
import assert from "node:assert/strict";
import { printValue } from "../src/core/print";
import { builtins } from "../src/core/builtins";
import {
  NIL,
  cons,
  intern,
  type ArrayValue,
  type LispValue,
} from "../src/core/values";

//LLM-written tests
function num(value: number): LispValue {
  return { kind: "number", value };
}

function str(value: string): LispValue {
  return { kind: "string", value };
}

function list(...items: LispValue[]): LispValue {
  return items.reduceRight<LispValue>((tail, item) => cons(item, tail), NIL);
}

function vec(...items: LispValue[]): LispValue {
  return { kind: "array", elements: items };
}

function func(name: string): LispValue {
  return {
    kind: "function",
    name,
    params: [],
    body: [],
    env: { vars: new Map(), parent: null },
  };
}

function longList(count: number): LispValue {
  const items: LispValue[] = [];
  for (let index = 1; index <= count; index += 1) items.push(num(index));
  return list(...items);
}

test("prints a number as its digits", () => {
  assert.equal(printValue(num(42)), "42");
});

test("prints a negative fraction without truncating it", () => {
  assert.equal(printValue(num(-3.5)), "-3.5");
});

test("wraps a string in double quotes", () => {
  assert.equal(printValue(str("hi")), '"hi"');
});

test("escapes a quote and a backslash inside a string", () => {
  assert.equal(printValue(str('a"b\\c')), '"a\\"b\\\\c"');
});

test("prints a symbol by its interned uppercase name", () => {
  assert.equal(printValue(intern("foo")), "FOO");
});

test("prints T as a plain symbol", () => {
  assert.equal(printValue(intern("T")), "T");
});

test("prints the empty list as NIL", () => {
  assert.equal(printValue(NIL), "NIL");
});

test("prints a proper list with single spaces between elements", () => {
  assert.equal(printValue(list(num(1), num(2), num(3))), "(1 2 3)");
});

test("prints the empty list built through list() as NIL", () => {
  assert.equal(printValue(list()), "NIL");
});

test("prints an improper pair with a dot", () => {
  assert.equal(printValue(cons(num(1), num(2))), "(1 . 2)");
});

test("prints a dotted tail after the leading elements", () => {
  assert.equal(printValue(cons(num(1), cons(num(2), num(3)))), "(1 2 . 3)");
});

test("prints strings inside a list with their quotes", () => {
  assert.equal(printValue(list(str("a"), str("b"))), '("a" "b")');
});

test("prints an empty vector literal", () => {
  assert.equal(printValue(vec()), "#()");
});

test("prints a vector literal with its elements", () => {
  assert.equal(printValue(vec(num(1), num(2))), "#(1 2)");
});

test("prints a vector nested inside a list", () => {
  assert.equal(printValue(list(vec(num(1)))), "(#(1))");
});

test("prints a builtin by its name", () => {
  const car = builtins.get("CAR");
  assert.ok(car !== undefined);
  assert.equal(printValue(car), "#<builtin CAR>");
});

test("prints a user function by its name", () => {
  assert.equal(printValue(func("F")), "#<function F>");
});

test("prints an anonymous lambda under the name the interpreter gives it", () => {
  assert.equal(printValue(func("LAMBDA")), "#<function LAMBDA>");
});

test("cuts a long list at the default element limit", () => {
  assert.equal(printValue(longList(10)), "(1 2 3 4 5 6 7 8 ...)");
});

test("treats an empty options object as the defaults", () => {
  assert.equal(printValue(longList(9), {}), "(1 2 3 4 5 6 7 8 ...)");
});

test("honours a maxElements of two", () => {
  assert.equal(
    printValue(list(num(1), num(2), num(3)), { maxElements: 2 }),
    "(1 2 ...)",
  );
});

test("adds no marker when the list fits the limit exactly", () => {
  assert.equal(
    printValue(list(num(1), num(2), num(3)), { maxElements: 8 }),
    "(1 2 3)",
  );
});

test("prints only the marker when maxElements is zero", () => {
  assert.equal(
    printValue(list(num(1), num(2), num(3)), { maxElements: 0 }),
    "(...)",
  );
});

test("cuts vector elements at the limit inside a list", () => {
  assert.equal(
    printValue(list(vec(num(1), num(2), num(3))), { maxElements: 2 }),
    "(#(1 2 ...))",
  );
});

test("cuts depth with a hash instead of dots", () => {
  assert.equal(printValue(list(list(list(list(num(1)))))), "(((#)))");
});

test("cuts a nested list at a maxDepth of one", () => {
  assert.equal(printValue(list(list(num(1))), { maxDepth: 1 }), "(#)");
});

test("keeps the elements of a shallow list at a maxDepth of one", () => {
  assert.equal(printValue(list(num(1), num(2)), { maxDepth: 1 }), "(1 2)");
});

test("prints a hash for anything past a maxDepth of zero", () => {
  assert.equal(printValue(list(num(1)), { maxDepth: 0 }), "#");
});

test("cuts nested vectors at the depth limit", () => {
  assert.equal(printValue(vec(vec(num(1))), { maxDepth: 1 }), "#(#)");
});

test("marks a list that points at itself through its tail", () => {
  const cell = cons(num(1), NIL);
  cell.cdr = cell;
  assert.equal(printValue(cell), "(1 ...)");
});

test("marks a list that points at itself through its head", () => {
  const cell = cons(NIL, NIL);
  cell.car = cell;
  assert.equal(printValue(cell), "((...))");
});

test("marks two cells that point at each other", () => {
  const first = cons(NIL, NIL);
  const second = cons(first, NIL);
  first.car = second;
  assert.equal(printValue(first), "(((...)))");
});

test("marks a vector that contains itself", () => {
  const array: ArrayValue = { kind: "array", elements: [] };
  array.elements.push(array);
  assert.equal(printValue(array), "#(...)");
});

test("prints shared structure twice rather than calling it a cycle", () => {
  const shared = list(num(2));
  assert.equal(printValue(list(shared, shared)), "((2) (2))");
});

test("prints a NIL element but not a NIL tail", () => {
  assert.equal(printValue(list(num(1), NIL)), "(1 NIL)");
  assert.equal(printValue(cons(num(1), NIL)), "(1)");
});

test("drops the dotted tail once the element limit is reached", () => {
  assert.equal(
    printValue(cons(num(1), cons(num(2), cons(num(3), num(4)))), {
      maxElements: 2,
    }),
    "(1 2 ...)",
  );
});

test("keeps the dotted tail when it lands inside the limit", () => {
  assert.equal(
    printValue(cons(num(1), cons(num(2), num(3))), { maxElements: 3 }),
    "(1 2 . 3)",
  );
});

test("leaves a real newline inside a string alone", () => {
  assert.equal(printValue(str("a\nb")), '"a\nb"');
});

test("does not share state between two calls", () => {
  printValue(longList(9));
  assert.equal(printValue(list(num(1), num(2))), "(1 2)");
});

test("prints a character", () => {
  assert.equal(printValue({ kind: "char", value: "a" }), "#\\a");
  assert.equal(printValue({ kind: "char", value: "A" }), "#\\A");
});

test("prints a named character by name", () => {
  assert.equal(printValue({ kind: "char", value: " " }), "#\\Space");
  assert.equal(printValue({ kind: "char", value: "\n" }), "#\\Newline");
  assert.equal(printValue({ kind: "char", value: "\t" }), "#\\Tab");
});

test("prints a character inside a list and a vector", () => {
  assert.equal(
    printValue(list({ kind: "char", value: "a" }, { kind: "char", value: " " })),
    "(#\\a #\\Space)",
  );
});

test("prints a structure the way SBCL does", () => {
  const point: LispValue = {
    kind: "struct",
    type: "POINT",
    slots: new Map<string, LispValue>([
      ["X", num(1)],
      ["Y", num(2)],
    ]),
  };

  assert.equal(printValue(point), "#S(POINT :X 1 :Y 2)");
});

test("prints a nested structure", () => {
  const inner: LispValue = {
    kind: "struct",
    type: "PNT",
    slots: new Map([["X", num(1)]]),
  };
  const outer: LispValue = {
    kind: "struct",
    type: "BOX",
    slots: new Map([["IN", inner]]),
  };

  assert.equal(printValue(outer), "#S(BOX :IN #S(PNT :X 1))");
});

test("cuts a structure at the depth limit", () => {
  let wrapped: LispValue = { kind: "struct", type: "A", slots: new Map() };
  for (let index = 0; index < 3; index += 1) {
    wrapped = { kind: "struct", type: "A", slots: new Map([["NEXT", wrapped]]) };
  }

  assert.equal(printValue(wrapped, { maxDepth: 2 }), "#S(A :NEXT #S(A :NEXT #))");
});


test("prints a hash table", () => {
  const table: LispValue = {
    kind: "hash",
    test: "eql",
    entries: new Map([["a", { key: intern("A"), value: num(1) }]]),
  };

  assert.equal(printValue(table), "#<hash-table :count 1>");
});

test("renders princ-style when asked", () => {
  assert.equal(printValue(str("a"), { princ: true }), "a");
  assert.equal(printValue({ kind: "char", value: "a" }, { princ: true }), "a");
  assert.equal(printValue(list(str("a")), { princ: true }), "(a)");
});
