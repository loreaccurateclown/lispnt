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

test("counts the closers a nested unclosed form still needs", () => {
  const [diagnostic] = analyze("(defun nested (x)\n  (let ((y 1))\n    (+ x (g y)");

  assert.equal(diagnostic?.code, "unterminated-list");
  assert.equal(
    diagnostic?.message,
    "3 lists are still open, so the file ends 3 `)` short. Add `)))` after the last line; the outermost opened on line 1.",
  );
  // The squiggle covers `(+` at the head, not the opening paren alone.
  assert.deepEqual(diagnostic?.end, { line: 3, column: 7, offset: 39 });
});

test("names the last complete form as where checking stopped", () => {
  const [diagnostic] = analyze("(defun f (x) x)\n(defun g (y)");

  assert.equal(
    diagnostic?.message,
    "This form never closes, so the file ends 1 `)` short. Add `)` after the last line. The last complete form ends on line 1.",
  );
});

// A missing closer swallows the rest of the file, so a name it defines looks
// undefined. The file is read again with the closers supplied, and the warning is
// dropped when that text defines the name.
test("drops a warning that a missing closer manufactured", () => {
  const diagnostics = analyze("(defun main () (helper))\n(defun helper () 1");

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["unterminated-list"],
  );
});

test("keeps a warning the file really has, closers or no closers", () => {
  const diagnostics = analyze(
    "(defun good (x) (+ x missing-var))\n(defun broken (y)\n  (print y)",
  );

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["unterminated-list", "unbound-variable"],
  );
});

test("keeps an arity mistake for a function the file defines", () => {
  const diagnostics = analyze("(defun f (a) a)\n(f 1 2)\n(defun broken (y)");

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["unterminated-list", "arity"],
  );
});

// The bracket-mismatch fixtures: one closer deleted, so the recovered read is
// what says which form swallowed its sibling. The mark and the message both move
// there, and the message names the line and the form.
function bracketFixture(name: string): string {
  return readFileSync(
    join(process.cwd(), "lisp_test_files", "bracket_mismatch", name),
    "utf8",
  );
}

// [start line, start column, end line, end column], so a fixture header change
// that shifts the code does not force every offset in the test to be rewritten.
function spanOf(
  diagnostic: ReturnType<typeof analyze>[number] | undefined,
): number[] {
  return [
    diagnostic?.position.line ?? -1,
    diagnostic?.position.column ?? -1,
    diagnostic?.end?.line ?? -1,
    diagnostic?.end?.column ?? -1,
  ];
}

test("marks the call a missing closer made swallow its sibling", () => {
  const [diagnostic] = analyze(bracketFixture("bracket_mismatch_arity.lisp"));

  assert.equal(diagnostic?.code, "bracket-mismatch");
  assert.equal(
    diagnostic?.message,
    "Bracket mismatch at line 9: COUNT-ZEROS was given 3 arguments; it takes 1 to 2. Check the COUNT-ZEROS form for a missing closing bracket.",
  );
  assert.deepEqual(spanOf(diagnostic), [9, 11, 10, 39]);
});

test("marks an IF given a form too many by a missing closer", () => {
  const [diagnostic] = analyze(
    bracketFixture("bracket_mismatch_if_operands.lisp"),
  );

  assert.equal(diagnostic?.code, "bracket-mismatch");
  assert.equal(
    diagnostic?.message,
    "Bracket mismatch at line 6: IF was given 4 forms; it takes 2 or 3: a test-form, a then-form and an optional else-form. Check the IF form for a missing closing bracket.",
  );
  assert.deepEqual(spanOf(diagnostic), [6, 3, 9, 13]);
});

test("marks a SETQ whose pairs came out odd from a missing closer", () => {
  const [diagnostic] = analyze(
    bracketFixture("bracket_mismatch_setq_operands.lisp"),
  );

  assert.equal(diagnostic?.code, "bracket-mismatch");
  assert.equal(
    diagnostic?.message,
    "Bracket mismatch at line 6: SETQ was given 3 forms; it takes pairs: a variable that is set and a form representing the value to be set. Check the SETQ form for a missing closing bracket.",
  );
  assert.deepEqual(spanOf(diagnostic), [6, 3, 7, 14]);
});

test("marks a LABELS entry a missing closer turned into a definition", () => {
  const [diagnostic] = analyze(
    bracketFixture("bracket_mismatch_labels_entry.lisp"),
  );

  assert.equal(diagnostic?.code, "bracket-mismatch");
  assert.equal(
    diagnostic?.message,
    "Bracket mismatch at line 7: a LABELS entry has no argument list; each local function needs a name and an argument list. Check the LABELS form for a missing closing bracket.",
  );
  assert.deepEqual(spanOf(diagnostic), [7, 5, 7, 15]);
});

test("keeps the unclosed form as the mark when the recovered read is clean", () => {
  const [diagnostic] = analyze(
    bracketFixture("bracket_mismatch_last_closer.lisp"),
  );

  assert.equal(diagnostic?.code, "unterminated-list");
  assert.equal(
    diagnostic?.message,
    "This form never closes, so the file ends 1 `)` short. Add `)` after the last line.",
  );
  assert.deepEqual(spanOf(diagnostic), [5, 1, 5, 7]);
});

// The repair, not the verdict: the learner wrote (x 0) where ((x 0)) was meant,
// and the whole form is marked because the brackets are what is wrong.
test("says how to repair a binding list written without its inner brackets", () => {
  const [diagnostic] = analyze("(let (x 0))");

  assert.equal(diagnostic?.code, "let-binding");
  assert.equal(
    diagnostic?.message,
    "LET bindings need a pair of brackets each: write `((x 0))` so `X` is bound to `0`. As written, LET reads `X`, then takes `0` as a second binding, which fails.",
  );
  assert.deepEqual(diagnostic?.position, { line: 1, column: 1, offset: 0 });
  assert.deepEqual(diagnostic?.end, { line: 1, column: 12, offset: 11 });
});

test("names LET* in its own words", () => {
  const [diagnostic] = analyze("(let* (x 0) x)");

  assert.equal(diagnostic?.code, "let-binding");
  assert.match(
    diagnostic?.message ?? "",
    /^LET\* bindings need a pair of brackets each/,
  );
});

test("reports a binding entry that is neither a name nor a pair", () => {
  const [diagnostic] = analyze("(let (0) 1)");

  assert.equal(
    diagnostic?.message,
    "Each LET binding is a name or a `(name value)` pair, as in `((x 0))`. As written, `0` is not a binding.",
  );
});

test("leaves legal binding lists alone", () => {
  assert.deepEqual(analyze("(let (x) 0)"), []);
  assert.deepEqual(analyze("(let ((x 0)))"), []);
  assert.deepEqual(analyze("(let ((x 0) (y)) x)"), []);
});

// The same principle for the other shapes: name the repair, not the verdict.
test("shows where a defun's name belongs", () => {
  const [diagnostic] = analyze("(defun 5 (x) x)");

  assert.equal(
    diagnostic?.message,
    "A DEFUN needs its name before the argument list: write `(defun name (x) …)`.",
  );
  assert.deepEqual(diagnostic?.end, { line: 1, column: 16, offset: 15 });
});

test("puts the learner's own name in the defun argument-list repair", () => {
  const [diagnostic] = analyze("(defun f)");

  assert.equal(
    diagnostic?.message,
    "A DEFUN needs an argument list after the name: write `(defun f (x) …)`.",
  );
});

test("shows where a lambda's argument list belongs", () => {
  const [diagnostic] = analyze("(lambda 1 2)");

  assert.equal(
    diagnostic?.message,
    "A LAMBDA needs its argument list first: write `(lambda (x) …)`.",
  );
});

test("shows the shape a labels definition list needs", () => {
  const [diagnostic] = analyze("(labels 1 2)");

  assert.equal(
    diagnostic?.message,
    "FLET and LABELS need a list of local definitions: write `(labels ((name (x) …)) …)`.",
  );
});

test("marks the local definition that has no argument list", () => {
  const [diagnostic] = analyze("(labels ((f)) 2)");

  assert.equal(diagnostic?.code, "local-definition");
  assert.equal(
    diagnostic?.message,
    "Each local function is a name and an argument list: write `((name (x) …))`.",
  );
  assert.deepEqual(diagnostic?.position, { line: 1, column: 10, offset: 9 });
  assert.deepEqual(diagnostic?.end, { line: 1, column: 13, offset: 12 });
});

// A special form with the wrong number of parts. The message is the repair, and
// a name warning inside the marked form is suppressed so the learner sees one
// thing to fix rather than four echoes of it.
test("says what IF needs", () => {
  const [diagnostic] = analyze("(if x)");

  assert.equal(diagnostic?.code, "operand-count");
  assert.equal(
    diagnostic?.message,
    "IF takes a test, a then-branch and an optional else-branch: write `(if test then else)`.",
  );
  assert.deepEqual(diagnostic?.end, { line: 1, column: 7, offset: 6 });
});

test("marks IF once even with extra branches", () => {
  assert.deepEqual(
    analyze("(if x y z w)").map((diagnostic) => diagnostic.code),
    ["operand-count"],
  );
});

test("says what SETQ needs", () => {
  const [diagnostic] = analyze("(setq a)");

  assert.equal(diagnostic?.code, "operand-count");
  assert.match(diagnostic?.message ?? "", /SETQ takes pairs/);
});

test("marks a COND clause that is not a list", () => {
  const [diagnostic] = analyze("(cond 1)");

  assert.equal(diagnostic?.code, "clause-shape");
  assert.deepEqual(diagnostic?.position, { line: 1, column: 7, offset: 6 });
});

test("marks an empty COND clause", () => {
  assert.deepEqual(
    analyze("(cond ())").map((diagnostic) => diagnostic.code),
    ["clause-shape"],
  );
});

test("marks a CASE clause that is not a list", () => {
  assert.deepEqual(
    analyze("(case 1 foo)").map((diagnostic) => diagnostic.code),
    ["clause-shape"],
  );
});

test("asks DO for its end-test clause", () => {
  const [diagnostic] = analyze("(do ((i 0)))");

  assert.equal(diagnostic?.code, "do-end-test");
  assert.match(diagnostic?.message ?? "", /DO needs an end-test clause/);
});

test("marks a DO binding that is not a name", () => {
  assert.deepEqual(
    analyze("(do (9) (t 1))").map((diagnostic) => diagnostic.code),
    ["do-binding"],
  );
});

test("asks DOTIMES for a variable and a count", () => {
  const [diagnostic] = analyze("(dotimes (i))");

  assert.equal(diagnostic?.code, "iteration-spec");
  assert.match(diagnostic?.message ?? "", /DOTIMES takes/);
});

test("asks MULTIPLE-VALUE-SETQ for a list of names", () => {
  assert.deepEqual(
    analyze("(multiple-value-setq a (values 1))").map(
      (diagnostic) => diagnostic.code,
    ),
    ["operand-count"],
  );
});

test("bounds RETURN", () => {
  assert.deepEqual(
    analyze("(return 1 2)").map((diagnostic) => diagnostic.code),
    ["operand-count"],
  );
});

test("leaves well-formed special forms alone", () => {
  assert.deepEqual(analyze("(if t 1)"), []);
  assert.deepEqual(analyze("(cond (t 1))"), []);
  assert.deepEqual(analyze("(do ((i 0 (+ i 1))) ((> i 2) i))"), []);
  assert.deepEqual(analyze("(dotimes (i 3) i)"), []);
  assert.deepEqual(analyze("(dolist (x '(1)) x)"), []);
  assert.deepEqual(analyze("(multiple-value-bind (a) (values 1) a)"), []);
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
    message:
      "A DEFUN needs its name before the argument list: write `(defun name (x) …)`.",
    position: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 16, offset: 15 },
  });
});

test("reports a defun without an argument list", () => {
  const diagnostics = analyze("(defun foo x)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "defun-arglist");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 1, offset: 0 });
  assert.deepEqual(diagnostics[0]?.end, { line: 1, column: 14, offset: 13 });
});

test("reports a lambda without an argument list", () => {
  const diagnostics = analyze("(lambda 1)");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "lambda-arglist");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 1, offset: 0 });
  assert.deepEqual(diagnostics[0]?.end, { line: 1, column: 11, offset: 10 });
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
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 1, offset: 0 });
});

test("walks the tail of a dotted form once", () => {
  const diagnostics = analyze("(defun foo (x) . (lambda 1))");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "lambda-arglist");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 18, offset: 17 });
  assert.deepEqual(diagnostics[0]?.end, { line: 1, column: 28, offset: 27 });
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
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 1, offset: 0 });
  assert.deepEqual(diagnostics[0]?.end, { line: 1, column: 13, offset: 12 });
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
    "let-binding.lisp": ["let-binding"],
    "operands.lisp": ["operand-count", "operand-count"],
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
    "trace-marker-empty.lisp": ["trace-marker"],
    "quiet.lisp": [],
  };

  for (const [file, codes] of Object.entries(expected)) {
    const source = readFileSync(join(directory, file), "utf8");
    const found = analyze(source).map((diagnostic) => diagnostic.code);
    assert.deepEqual(found.sort(), [...codes].sort(), file);
  }
});

test("warns about a trace marker that names no call", () => {
  const diagnostics = analyze(";;[trace]\n(defun f () 1)\n");

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "trace-marker");
  assert.equal(diagnostics[0]?.severity, "warning");
  assert.deepEqual(diagnostics[0]?.position, { line: 1, column: 1, offset: 0 });
  assert.match(diagnostics[0]?.message ?? "", /no test case for the function/);
});

test("does not warn about a trace marker that names a call", () => {
  assert.deepEqual(analyze(";;[trace] (+ 1 2)"), []);
});

// The warning is emitted after evaluation so that a marker sitting inside a
// definition cannot make the analyzer skip that definition.
test("a marker inside a definition does not hide that definition's mistakes", () => {
  const source = ["(defun f ()", "  ;;[trace]", "  (car 1))", "(f)"].join("\n");

  assert.deepEqual(
    analyze(source).map((diagnostic) => diagnostic.code),
    ["type-error", "trace-marker"],
  );
});