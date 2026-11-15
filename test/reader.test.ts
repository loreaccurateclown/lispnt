import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, parseAll, type AstNode } from "../src/core/reader";

//Position and atoms tests
test("guards the origin conventions", () => {
  const node = parse("a");

  assert.deepEqual(node, {
    kind: "atom",
    atomType: "symbol",
    value: "a",
    start: { line: 1, column: 1, offset: 0 },
  });
});

test("guards against parsing whitespace and ensures position is atom not string", () => {
  const node = parse("   foo");

  assert.deepEqual(node, {
    kind: "atom",
    atomType: "symbol",
    value: "foo",
    start: {
      line: 1,
      column: 4,
      offset: 3,
    },
  });
});

test("ensures numeric atoms become numbers, not strings", () => {
  const node = parse("42");

  if (node.kind !== "atom") {
    //Version B start
    assert.fail("expected an atom node");
  }

  if (node.atomType !== "number") {
    //Version B start
    assert.fail("expected a number atom type");
  }

  assert.equal(typeof node.value, "number");
  assert.equal(node.value, 42); // Version B end

  // assert.deepEqual(node, { //Version A
  //     kind: "atom",
  //     value: 42,
  //     start: {line: 1, column: 1, offset: 0}
  // });
});

test("ensures correct sign and decimal point", () => {
  const node = parse("-3.5");

  if (node.kind !== "atom") {
    assert.fail("expected an atom node");
  }

  assert.equal(node.value, -3.5);
});

test("ensures operands parse properly", () => {
  const node = parse("+");

  if (node.kind !== "atom") {
    assert.fail("expected an atom node");
  }
  if (node.atomType !== "symbol") {
    assert.fail("expected a symbol atom type");
  }

  assert.equal(node.value, "+");
});

//Lists tests

test("ensures empty list is legal", () => {
  const node = parse("()");

  assert.deepEqual(node, {
    kind: "list",
    children: [],
    start: {
      line: 1,
      column: 1,
      offset: 0,
    },
    end: {
      line: 1,
      column: 3,
      offset: 2,
    },
  });
});

test("ensures children are in order and positions are correct", () => {
  const node = parse("(a b)");

  assert.deepEqual(node, {
    kind: "list",
    children: [
      {
        kind: "atom",
        atomType: "symbol",
        value: "a",
        start: { line: 1, column: 2, offset: 1 },
      },
      {
        kind: "atom",
        atomType: "symbol",
        value: "b",
        start: { line: 1, column: 4, offset: 3 },
      },
    ],
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 6, offset: 5 },
  });
});

test("critical: ensures recursion parses", () => {
  const node = parse("(a (b) c)");

  assert.deepEqual(node, {
    kind: "list",
    children: [
      {
        kind: "atom",
        atomType: "symbol",
        value: "a",
        start: { line: 1, column: 2, offset: 1 },
      }, //this is where I actually realized what 1-based column means
      {
        kind: "list",
        children: [
          {
            kind: "atom",
            atomType: "symbol",
            value: "b",
            start: { line: 1, column: 5, offset: 4 },
          },
        ],
        start: { line: 1, column: 4, offset: 3 },
        end: { line: 1, column: 7, offset: 6 }, //isn't offset 0-based? test doc says offset should be 6 but i think column is 6 offset 5?
      },
      {
        kind: "atom",
        atomType: "symbol",
        value: "c",
        start: { line: 1, column: 8, offset: 7 },
      },
    ],
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 10, offset: 9 },
  });
});

test("ensures newline resets column to 1 and line is incremented by 1", () => {
  const node = parse("(\n  a\n)");

  assert.deepEqual(node, {
    kind: "list",
    children: [
      {
        kind: "atom",
        atomType: "symbol",
        value: "a",
        start: { line: 2, column: 3, offset: 4 },
      },
    ],
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 3, column: 2, offset: 7 }, //wasn't sure where it ended so I just assumed it ended where the bracket after the second \n is
  });
});

test("ensures comments are skipped as trivia and validity is parsed after newline", () => {
  const node = parse("; hello\na");
  assert.deepEqual(node, {
    kind: "atom",
    atomType: "symbol",
    value: "a",
    start: { line: 2, column: 1, offset: 8 }, //starting at the line after the comment
  });
});

test("ensures comments after code are not parsed", () => {
  const node = parse("(a ; c\n b)");

  assert.deepEqual(node, {
    kind: "list",
    children: [
      {
        kind: "atom",
        atomType: "symbol",
        value: "a",
        start: { line: 1, column: 2, offset: 1 },
      },
      {
        kind: "atom",
        atomType: "symbol",
        value: "b",
        start: { line: 2, column: 2, offset: 8 },
      },
    ],
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 2, column: 4, offset: 10 },
  });
});

test("rejects if data is solely comments", () => {
  assert.throws(() => parse("; only")); //not sure if this was fish drift again but it works as either ; or ; only
});

test("ensures comments on multiple lines are not parsed", () => {
  const node = parse(";a\n;b\nx");

  assert.deepEqual(node, {
    kind: "atom",
    atomType: "symbol",
    value: "x",
    start: { line: 3, column: 1, offset: 6 },
  });
});

test("rejects unterminated list", () => {
  assert.throws(() => parse("(a b"));
});

test("rejects stray closing brackets", () => {
  assert.throws(() => parse(")"));
});

test("rejects two adjacent forms with no function", () => {
  assert.throws(() => parse("a b"));
});

test("rejects empty form", () => {
  assert.throws(() => parse(""));
  assert.throws(() => parse(" \n ")); //big fish put these on the same line...
});

//LLM-written tests
test("ensures block comments are skipped as trivia", () => {
  const node = parse("#| hi |#a");

  assert.deepEqual(node, {
    kind: "atom",
    atomType: "symbol",
    value: "a",
    start: { line: 1, column: 9, offset: 8 },
  });
});

test("ensures nested block comments are skipped as a single comment", () => {
  const node = parse("#| a #| b |# c |#x");

  assert.deepEqual(node, {
    kind: "atom",
    atomType: "symbol",
    value: "x",
    start: { line: 1, column: 18, offset: 17 },
  });
});

test("ensures a block comment spanning lines keeps position tracking", () => {
  const node = parse("#| a\n b |#x");

  assert.deepEqual(node, {
    kind: "atom",
    atomType: "symbol",
    value: "x",
    start: { line: 2, column: 6, offset: 10 },
  });
});

test("rejects an unterminated block comment", () => {
  assert.throws(() => parse("#| a"));
});

//LLM-written tests
test("parses a string literal as a string atom", () => {
  const node = parse('"hi"');

  assert.deepEqual(node, {
    kind: "atom",
    atomType: "string",
    value: "hi",
    start: { line: 1, column: 1, offset: 0 },
  });
});

test("parses an empty string literal", () => {
  const node = parse('""');

  assert.deepEqual(node, {
    kind: "atom",
    atomType: "string",
    value: "",
    start: { line: 1, column: 1, offset: 0 },
  });
});

test("decodes an escaped quote inside a string", () => {
  const node = parse('"a\\"b"'); // six chars: " a \ " b "

  assert.deepEqual(node, {
    kind: "atom",
    atomType: "string",
    value: 'a"b',
    start: { line: 1, column: 1, offset: 0 },
  });
});

test("decodes an escaped backslash inside a string", () => {
  const node = parse('"a\\\\b"'); // six chars: " a \ \ b "

  assert.deepEqual(node, {
    kind: "atom",
    atomType: "string",
    value: "a\\b",
    start: { line: 1, column: 1, offset: 0 },
  });
});

test("rejects an unterminated string", () => {
  assert.throws(() => parse('"hi'));
});

test("keeps line tracking across a newline inside a string", () => {
  const node = parse('("a\nb")');

  assert.deepEqual(node, {
    kind: "list",
    children: [
      {
        kind: "atom",
        atomType: "string",
        value: "a\nb",
        start: { line: 1, column: 2, offset: 1 },
      },
    ],
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 2, column: 4, offset: 7 },
  });
});

//LLM-written tests
test("parses a quoted symbol", () => {
  const node = parse("'x");

  assert.deepEqual(node, {
    kind: "quote",
    target: {
      kind: "atom",
      atomType: "symbol",
      value: "x",
      start: { line: 1, column: 2, offset: 1 },
    },
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 3, offset: 2 },
  });
});

test("parses a quoted list", () => {
  const node = parse("'(1 2)");

  assert.deepEqual(node, {
    kind: "quote",
    target: {
      kind: "list",
      children: [
        {
          kind: "atom",
          atomType: "number",
          value: 1,
          start: { line: 1, column: 3, offset: 2 },
        },
        {
          kind: "atom",
          atomType: "number",
          value: 2,
          start: { line: 1, column: 5, offset: 4 },
        },
      ],
      start: { line: 1, column: 2, offset: 1 },
      end: { line: 1, column: 7, offset: 6 },
    },
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 7, offset: 6 },
  });
});

test("parses nested quotes", () => {
  const node = parse("''x");

  assert.deepEqual(node, {
    kind: "quote",
    target: {
      kind: "quote",
      target: {
        kind: "atom",
        atomType: "symbol",
        value: "x",
        start: { line: 1, column: 3, offset: 2 },
      },
      start: { line: 1, column: 2, offset: 1 },
      end: { line: 1, column: 4, offset: 3 },
    },
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 4, offset: 3 },
  });
});

test("rejects a quote with nothing to quote", () => {
  assert.throws(() => parse("'"));
});

//LLM-written tests
test("parseAll returns an empty array for empty input", () => {
  assert.deepEqual(parseAll(""), []);
});

test("parseAll returns an empty array when the input is only comments", () => {
  assert.deepEqual(parseAll("; only"), []);
});

test("parseAll collects multiple top-level forms", () => {
  const nodes = parseAll("a b");

  assert.deepEqual(nodes, [
    {
      kind: "atom",
      atomType: "symbol",
      value: "a",
      start: { line: 1, column: 1, offset: 0 },
    },
    {
      kind: "atom",
      atomType: "symbol",
      value: "b",
      start: { line: 1, column: 3, offset: 2 },
    },
  ]);
});

test("parseAll keeps positions across forms separated by comments", () => {
  const nodes = parseAll("(a) ; c\n(b)");

  assert.deepEqual(nodes, [
    {
      kind: "list",
      children: [
        {
          kind: "atom",
          atomType: "symbol",
          value: "a",
          start: { line: 1, column: 2, offset: 1 },
        },
      ],
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 4, offset: 3 },
    },
    {
      kind: "list",
      children: [
        {
          kind: "atom",
          atomType: "symbol",
          value: "b",
          start: { line: 2, column: 2, offset: 9 },
        },
      ],
      start: { line: 2, column: 1, offset: 8 },
      end: { line: 2, column: 4, offset: 11 },
    },
  ]);
});

test("parseAll rejects a stray closing bracket", () => {
  assert.throws(() => parseAll("a b)"));
});

//LLM-written tests
function collectStrings(node: AstNode): string[] {
  if (node.kind === "atom") {
    return node.atomType === "string" ? [String(node.value)] : [];
  }
  if (node.kind === "quote") {
    return collectStrings(node.target);
  }
  return node.children.flatMap(collectStrings);
}

function readFixture(name: string): string {
  return readFileSync(join(__dirname, "../../lisp_test_files", name), "utf8");
}

test("parses a real Lisp file from disk", () => {
  const forms = parseAll(readFixture("recursion_nested_lists.lisp"));

  assert.equal(forms.length, 1);
  assert.equal(forms[0]?.kind, "list");
});

function collectPrefixes(node: AstNode): string[] {
  if (node.kind === "quote") {
    return collectPrefixes(node.target);
  }
  if (node.kind !== "list") {
    return [];
  }
  const own = node.prefix === undefined ? [] : [node.prefix];
  return own.concat(node.children.flatMap(collectPrefixes));
}

test("parses the smoke fixture with all constructs in it", () => {
  const forms = parseAll(readFixture("reader_smoke.lisp"));

  assert.equal(forms.length, 6);

  const describePoint = forms[2];
  assert.ok(describePoint);
  assert.deepEqual(collectPrefixes(describePoint), ["#("]);
});

test("decodes escapes in a real file", () => {
  const forms = parseAll(readFixture("reader_smoke.lisp"));
  const describePoint = forms[2];

  assert.ok(describePoint);
  assert.deepEqual(collectStrings(describePoint), [
    "Signed decimals are numbers; escaped quotes and backslashes decode.",
    'a quoted word: "yes"',
    "a windows path: C:\\temp",
  ]);
});

//LLM-written tests
test("parses a vector literal with the #( prefix", () => {
  const node = parse("#(1 2 3)");

  assert.deepEqual(node, {
    kind: "list",
    prefix: "#(",
    children: [
      {
        kind: "atom",
        atomType: "number",
        value: 1,
        start: { line: 1, column: 3, offset: 2 },
      },
      {
        kind: "atom",
        atomType: "number",
        value: 2,
        start: { line: 1, column: 5, offset: 4 },
      },
      {
        kind: "atom",
        atomType: "number",
        value: 3,
        start: { line: 1, column: 7, offset: 6 },
      },
    ],
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 9, offset: 8 },
  });
});

test("parses an empty vector literal", () => {
  const node = parse("#()");

  assert.deepEqual(node, {
    kind: "list",
    prefix: "#(",
    children: [],
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 4, offset: 3 },
  });
});

test("keeps the #( prefix off enclosing and sibling forms", () => {
  const node = parse("(#(1) 2)");

  assert.deepEqual(node, {
    kind: "list",
    children: [
      {
        kind: "list",
        prefix: "#(",
        children: [
          {
            kind: "atom",
            atomType: "number",
            value: 1,
            start: { line: 1, column: 4, offset: 3 },
          },
        ],
        start: { line: 1, column: 2, offset: 1 },
        end: { line: 1, column: 6, offset: 5 },
      },
      {
        kind: "atom",
        atomType: "number",
        value: 2,
        start: { line: 1, column: 7, offset: 6 },
      },
    ],
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 9, offset: 8 },
  });
});

test("still parses a # not followed by a paren as an atom", () => {
  const node = parse("#\\a");

  assert.deepEqual(node, {
    kind: "atom",
    atomType: "symbol",
    value: "#\\a",
    start: { line: 1, column: 1, offset: 0 },
  });
});
