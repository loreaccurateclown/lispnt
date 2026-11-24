import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyze } from "../src/core/analyze";

//LLM-written tests
test("returns no diagnostics for a file with multiple valid forms", () => {
  assert.deepEqual(analyze("(list 1) (list 2)"), []);
});

test("returns no diagnostics for empty input", () => {
  // note: parse("") throws empty-input; parseAll("") is simply no forms
  assert.deepEqual(analyze(""), []);
});

test("returns no diagnostics for comments only", () => {
  assert.deepEqual(analyze("; only"), []);
});

test("reports a stray closer with a learner-facing message", () => {
  const diagnostics = analyze(")");

  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0], {
    code: "stray-closer",
    severity: "error",
    message: "Unexpected ')': nothing is open here",
    position: { line: 1, column: 1, offset: 0 },
  });
});

test("reports an unterminated list at the paren on its own line", () => {
  const diagnostics = analyze("(list 1)\n(list 2");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "unterminated-list");
  assert.deepEqual(diagnostics[0]?.position, { line: 2, column: 1, offset: 9 });
});

test("reports an error that occurs after a valid first form", () => {
  const diagnostics = analyze("(list 1))");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "stray-closer");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 9, offset: 8 });
});

// An unclosed block comment used to escape reader.next() as a throw, which meant
// analyze crashed and the learner saw a clean file.
test("reports an unclosed block comment instead of crashing", () => {
  const diagnostics = analyze("#| this comment never ends");

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["unterminated-block-comment"],
  );
});

test("reports one diagnostic per stray closer", () => {
  const diagnostics = analyze(") ) )");

  assert.equal(diagnostics.length, 3);
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["stray-closer", "stray-closer", "stray-closer"],
  );
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.position.offset),
    [0, 2, 4],
  );
});

test("keeps recovering after a valid form", () => {
  const diagnostics = analyze("()))))");

  assert.equal(diagnostics.length, 4);
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.position.offset),
    [2, 3, 4, 5],
  );
});

//LLM-written tests
test("reports a defun whose name is not a symbol", () => {
  const diagnostics = analyze("(defun 1 (x) x)");

  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0], {
    code: "defun-name",
    severity: "error",
    message: "A defun needs a name symbol here.",
    position: { line: 1, column: 8, offset: 7 },
  });
});

test("reports a defun without an argument list", () => {
  const diagnostics = analyze("(defun foo x)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "defun-arglist");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 12, offset: 11 });
});

test("reports a lambda without an argument list", () => {
  const diagnostics = analyze("(lambda 1)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "lambda-arglist");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 9, offset: 8 });
});

test("reports a let without a bindings list", () => {
  const diagnostics = analyze("(let 1 2)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "let-bindings");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 6, offset: 5 });
});

test("reports a let* without a bindings list", () => {
  const diagnostics = analyze("(let* 1 2)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "let-bindings");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 7, offset: 6 });
});

test("ignores a malformed form inside a quote", () => {
  assert.deepEqual(analyze("'(defun 1 (x) x)"), []);
});

test("ignores a malformed form inside a vector literal", () => {
  assert.deepEqual(analyze("#(defun 1 (x) x)"), []);
});

test("accepts a defun with no body", () => {
  assert.deepEqual(analyze("(defun f ())"), []);
});

test("accepts a let with a bare symbol binding", () => {
  assert.deepEqual(analyze("(let (x) x)"), []);
});

test("finds a malformed form nested inside a valid one", () => {
  const diagnostics = analyze("(defun foo (x) (let 1 2))");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "let-bindings");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 21, offset: 20 });
});

//LLM-written tests
test("recognises an uppercase form head", () => {
  const diagnostics = analyze("(DEFUN 1 (x) x)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "defun-name");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 8, offset: 7 });
});

test("walks the tail of a dotted form once", () => {
  const diagnostics = analyze("(defun foo (x) . (lambda 1))");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "lambda-arglist");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 26, offset: 25 });
});

//LLM-written tests
test("reports a type error from a builtin", () => {
  const diagnostics = analyze("(car 5)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "type-error");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 1, offset: 0 });
});

test("reports a type error in an arithmetic argument", () => {
  const diagnostics = analyze('(+ 1 "a")');

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "type-error");
});

test("reports division by zero", () => {
  const diagnostics = analyze("(/ 1 0)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "division-by-zero");
});

test("reports an out of range array index", () => {
  const diagnostics = analyze("(aref (vector 1) 5)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "index-error");
});

test("reports setf on a form that is not a place", () => {
  const diagnostics = analyze("(setf (unknown-place) 1)");

  // The place form calls a function that does not exist, and it is not a
  // place either: two true statements about the same line.
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["not-a-place", "undefined-function"],
  );
});

test("reports a call with the wrong argument count", () => {
  const diagnostics = analyze("(progn (defun f (x) x) (f))");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "arity");
});

test("skips evaluation of a form already flagged by a shape check", () => {
  const diagnostics = analyze("(defun f 1)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "defun-arglist");
});

test("reports nothing for valid evaluable code", () => {
  assert.deepEqual(analyze("(progn (defun sq (x) (* x x)) (sq 4))"), []);
});

test("stays silent on a keyword argument Lispnt does not model", () => {
  // :element-type is real CL we have not built, so the whole call is our gap.
  assert.deepEqual(analyze("(make-array 3 :element-type 'fixnum)"), []);
});

test("reports a keyword argument list the learner got wrong", () => {
  const diagnostics = analyze("(make-array 3 :initial-element)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "malformed-form");
});

test("stops a long running loop with an evaluation budget", () => {
  const diagnostics = analyze("(dotimes (i 100000000) (setq x 1))");

  // Plus the name check's warning: the loop body assigns X, which is never
  // bound anywhere in the file.
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["evaluation-budget", "unbound-variable"],
  );
});

test("stops runaway recursion with an evaluation budget", () => {
  const diagnostics = analyze("(progn (defun boom () (boom)) (boom))");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "evaluation-budget");
});

test("reports a call to a function that is not defined", () => {
  const diagnostics = analyze("(foo 1)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "undefined-function");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 2, offset: 1 });
});

test("stays quiet about standard functions Lispnt does not implement", () => {
  assert.deepEqual(analyze('(format t "hi")'), []);
});

test("stays quiet about a standard higher order call", () => {
  assert.deepEqual(analyze("(mapcar #'car (list (list 1)))"), []);
});

test("stays quiet about a special variable defined elsewhere", () => {
  assert.deepEqual(analyze("*standard-output*"), []);
});

test("reports an unbound variable that is not a special", () => {
  const diagnostics = analyze("(progn (defparameter *x* 5) y)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "unbound-variable");
});

test("evaluates a defparameter and sees it afterwards", () => {
  assert.deepEqual(analyze("(progn (defparameter *x* 5) *x*)"), []);
});

test("stays quiet about undefined functions when the file loads another", () => {
  assert.deepEqual(analyze('(load "other.lisp")\n(foo 1)'), []);
});

test("still reports undefined functions when nothing is loaded", () => {
  const diagnostics = analyze("(foo 1)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "undefined-function");
});

//LLM-written tests
test("reports a labels form without a definitions list", () => {
  const diagnostics = analyze("(labels 1 2)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "local-definitions");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 9, offset: 8 });
});

test("reports a labels definition whose name is not a symbol", () => {
  const diagnostics = analyze("(labels ((1 (x) x)) 2)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "local-definition");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 10, offset: 9 });
});

test("reports a labels definition without an argument list", () => {
  const diagnostics = analyze("(labels ((f x) 2))");

  assert.equal(diagnostics.length, 2);
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["local-definition", "local-definition"],
  );
});

test("accepts a well formed labels form", () => {
  assert.deepEqual(analyze("(labels ((f (x) x)) (f 1))"), []);
});

test("reports an undefined function in a body nothing calls", () => {
  const diagnostics = analyze("(defun g () (missing-fn))");

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["undefined-function"],
  );
  assert.equal(diagnostics[0]?.severity, "warning");
  assert.match(diagnostics[0]?.message ?? "", /load that file first/);
});

test("reports a variable called as a function in a body nothing calls", () => {
  const diagnostics = analyze("(defun f (x) (x * 2))");

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["variable-as-function", "unbound-variable"],
  );
  assert.equal(diagnostics[0]?.severity, "error");
});

test("reports a wrong arity in a body nothing calls", () => {
  const diagnostics = analyze("(defun g (a) (g a b))");

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["arity", "unbound-variable"],
  );
});

test("reports an unbound variable in a let body nothing evaluates", () => {
  const diagnostics = analyze("(defun g () (let ((y 1)) z))");

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["unbound-variable"],
  );
});

test("reports a name mistake once, in the checker's wording", () => {
  const diagnostics = analyze("(foo 1)");

  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]?.message ?? "", /load that file first/);
});

test("keeps a runtime type error next to a name check", () => {
  const diagnostics = analyze("(car 1) (missing-fn)");

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["type-error", "undefined-function"],
  );
});

// The showcase files are what a learner opens to see each mark in the editor, so
// a change in what they report means the demonstration has drifted.
test("the diagnostic showcase still demonstrates what it claims", () => {
  const directory = join(process.cwd(), "examples", "diagnostics");
  const expected: Record<string, readonly string[]> = {
    "reader-stray-closer.lisp": ["stray-closer"],
    "reader-unterminated-list.lisp": ["unterminated-list"],
    "reader-unterminated-string.lisp": ["unterminated-string"],
    "reader-unterminated-block-comment.lisp": ["unterminated-block-comment"],
    "reader-unexpected-eof.lisp": ["unexpected-eof"],
    "reader-dotted-tail.lisp": ["dotted-tail-extra-form", "stray-closer"],
    "shapes.lisp": [
      "defun-name",
      "defun-arglist",
      "lambda-arglist",
      "local-definitions",
      "local-definition",
      "let-bindings",
      "unbound-variable",
    ],
    "runtime.lisp": [
      "type-error",
      "index-error",
      "division-by-zero",
      "not-a-place",
      "malformed-form",
      "signalled-error",
      "arity",
    ],
    "names.lisp": ["unbound-variable", "undefined-function", "variable-as-function"],
    "quiet.lisp": [],
  };

  for (const [file, codes] of Object.entries(expected)) {
    const source = readFileSync(join(directory, file), "utf8");
    const found = analyze(source).map((diagnostic) => diagnostic.code);
    assert.deepEqual(found.sort(), [...codes].sort(), file);
  }
});
