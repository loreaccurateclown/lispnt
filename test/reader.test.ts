import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, parseAll, type AstNode } from "../src/core/reader";
import { ReaderError } from "../src/core/errors";

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
    quoteKind: "'",
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
    quoteKind: "'",
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
    quoteKind: "'",
    target: {
      kind: "quote",
      quoteKind: "'",
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

//LLM-written tests
function expectReaderError(source: string): ReaderError {
  try {
    parse(source);
  } catch (error) {
    if (error instanceof ReaderError) {
      return error;
    }
    throw error;
  }

  assert.fail(`expected ${JSON.stringify(source)} to throw a ReaderError`);
}

test("reports a stray closer with its own position", () => {
  const error = expectReaderError(")");

  assert.equal(error.code, "stray-closer");
  assert.deepEqual(error.position, { line: 1, column: 1, offset: 0 });
});

test("reports an unterminated list at the opening paren", () => {
  const error = expectReaderError("(");

  assert.equal(error.code, "unterminated-list");
  assert.deepEqual(error.position, { line: 1, column: 1, offset: 0 });
});

test("reports an unterminated string at the opening quote", () => {
  const error = expectReaderError('"hi');

  assert.equal(error.code, "unterminated-string");
  assert.deepEqual(error.position, { line: 1, column: 1, offset: 0 });
});

test("reports an unterminated block comment at the #", () => {
  const error = expectReaderError("#| a");

  assert.equal(error.code, "unterminated-block-comment");
  assert.deepEqual(error.position, { line: 1, column: 1, offset: 0 });
});

test("reports empty input", () => {
  const error = expectReaderError("");

  assert.equal(error.code, "empty-input");
  assert.deepEqual(error.position, { line: 1, column: 1, offset: 0 });
});

test("reports trailing content at the first stray character", () => {
  const error = expectReaderError("a b");

  assert.equal(error.code, "trailing-content");
  assert.deepEqual(error.position, { line: 1, column: 3, offset: 2 });
});

test("reports a dangling quote at end of input", () => {
  const error = expectReaderError("'");

  assert.equal(error.code, "unexpected-eof");
  assert.deepEqual(error.position, { line: 1, column: 2, offset: 1 });
});

test("ReaderError carries its fields and is an Error", () => {
  const error = new ReaderError(
    "stray-closer",
    { line: 2, column: 5, offset: 7 },
    "stray closer",
  );

  assert.ok(error instanceof ReaderError);
  assert.ok(error instanceof Error);
  assert.equal(error.name, "ReaderError");
  assert.equal(error.code, "stray-closer");
  assert.equal(error.message, "stray closer");
  assert.deepEqual(error.position, { line: 2, column: 5, offset: 7 });
});

//LLM-written tests
test("parses a dotted pair into a tail", () => {
  assert.deepEqual(parse("(a . b)"), {
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
    end: { line: 1, column: 8, offset: 7 },
    tail: {
      kind: "atom",
      atomType: "symbol",
      value: "b",
      start: { line: 1, column: 6, offset: 5 },
    },
  });
});

test("parses a dotted pair with several leading elements", () => {
  assert.deepEqual(parse("(a b . c)"), {
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
    end: { line: 1, column: 10, offset: 9 },
    tail: {
      kind: "atom",
      atomType: "symbol",
      value: "c",
      start: { line: 1, column: 8, offset: 7 },
    },
  });
});

test("parses a dotted pair whose tail is a list", () => {
  assert.deepEqual(parse("(a . (b c))"), {
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
    end: { line: 1, column: 12, offset: 11 },
    tail: {
      kind: "list",
      children: [
        {
          kind: "atom",
          atomType: "symbol",
          value: "b",
          start: { line: 1, column: 7, offset: 6 },
        },
        {
          kind: "atom",
          atomType: "symbol",
          value: "c",
          start: { line: 1, column: 9, offset: 8 },
        },
      ],
      start: { line: 1, column: 6, offset: 5 },
      end: { line: 1, column: 11, offset: 10 },
    },
  });
});

test("rejects a dot with nothing before it", () => {
  const error = expectReaderError("(. a)");

  assert.equal(error.code, "dotted-tail-without-head");
  assert.deepEqual(error.position, { line: 1, column: 2, offset: 1 });
});

test("rejects more than one form after the dot", () => {
  const error = expectReaderError("(a . b c)");

  assert.equal(error.code, "dotted-tail-extra-form");
  assert.deepEqual(error.position, { line: 1, column: 8, offset: 7 });
});

test("treats a dot inside a symbol as part of the atom", () => {
  assert.deepEqual(parse("(a.b)"), {
    kind: "list",
    children: [
      {
        kind: "atom",
        atomType: "symbol",
        value: "a.b",
        start: { line: 1, column: 2, offset: 1 },
      },
    ],
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 6, offset: 5 },
  });
});

test("sets tail only for dotted lists", () => {
  const dotted = parse("(a . b)");
  const plain = parse("(a b)");

  if (dotted.kind !== "list" || plain.kind !== "list") {
    assert.fail("expected both inputs to parse as lists");
  }

  assert.notEqual(dotted.tail, undefined);
  assert.equal(plain.tail, undefined);
});

//LLM-written tests
test("parses a function quote as a quote node", () => {
  assert.deepEqual(parse("#'car"), {
    kind: "quote",
    quoteKind: "#'",
    target: {
      kind: "atom",
      atomType: "symbol",
      value: "car",
      start: { line: 1, column: 3, offset: 2 },
    },
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 6, offset: 5 },
  });
});

test("parses a function quote around a lambda", () => {
  const node = parse("#'(lambda (x) x)");

  assert.equal(node.kind, "quote");
  if (node.kind !== "quote") return;

  assert.equal(node.quoteKind, "#'");
  assert.equal(node.target.kind, "list");
  assert.deepEqual(node.start, { line: 1, column: 1, offset: 0 });
  assert.deepEqual(node.end, { line: 1, column: 17, offset: 16 });
});

test("keeps plain quotes distinguishable from function quotes", () => {
  const quoted = parse("'x");
  const functionQuoted = parse("#'x");

  assert.equal(quoted.kind, "quote");
  assert.equal(functionQuoted.kind, "quote");
  if (quoted.kind !== "quote" || functionQuoted.kind !== "quote") return;

  assert.equal(quoted.quoteKind, "'");
  assert.equal(functionQuoted.quoteKind, "#'");
});

test("rejects a function quote with nothing to quote", () => {
  const error = expectReaderError("#'");

  assert.equal(error.code, "unexpected-eof");
  assert.deepEqual(error.position, { line: 1, column: 3, offset: 2 });
});
