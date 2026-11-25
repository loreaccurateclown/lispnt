import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNames } from "../src/core/name-checks";
import { parseAll } from "../src/core/reader";
import type { Diagnostic } from "../src/core/diagnostics";

//LLM-written tests
function diagnose(source: string): Diagnostic[] {
  return checkNames(parseAll(source));
}

function codes(source: string): string[] {
  return diagnose(source).map((diagnostic) => diagnostic.code);
}

test("reports an undefined function in an uncalled body", () => {
  const found = diagnose("(defun g () (missing-fn))");

  assert.deepEqual(
    found.map((diagnostic) => diagnostic.code),
    ["undefined-function"],
  );
  assert.equal(found[0]?.severity, "warning");
});

test("stays quiet about undefined functions when the file loads another", () => {
  assert.deepEqual(codes('(load "other.lisp") (defun g () (missing-fn))'), []);
});

test("only a top-level load silences undefined functions", () => {
  assert.deepEqual(
    codes('(defun g () (load "other.lisp") (missing-fn))'),
    ["undefined-function"],
  );
  assert.deepEqual(
    codes("'(load \"other.lisp\") (defun g () (missing-fn))"),
    ["undefined-function"],
  );
});

test("says Lispnt reads one file at a time in the unbound variable message", () => {
  const found = diagnose("(defun g () (missing-var))");

  assert.match(found[0]?.message ?? "", /one file at a time/);
});

test("does not report a standard name we do not implement", () => {
  assert.deepEqual(
    codes("(defun g () (loop for x in xs do (print x)))"),
    [],
  );
});

test("does not report a global called as a function", () => {
  assert.deepEqual(codes("(defparameter g 1) (g)"), []);
});

test("reports a parameter called as a function", () => {
  const found = diagnose("(defun f (x) (x * 2))");
  const mistake = found.find(
    (diagnostic) => diagnostic.code === "variable-as-function",
  );

  assert.ok(mistake !== undefined);
  assert.equal(mistake.severity, "error");
  assert.match(mistake.message, /X is a variable/);
});

test("reports a let local called as a function", () => {
  assert.deepEqual(codes("(defun f () (let ((g 1)) (g 2)))"), [
    "variable-as-function",
  ]);
});

test("reports an unbound variable in a body", () => {
  const found = diagnose("(defun g () y)");

  assert.deepEqual(
    found.map((diagnostic) => diagnostic.code),
    ["unbound-variable"],
  );
  assert.equal(found[0]?.severity, "warning");
});

test("does not report a bound parameter", () => {
  assert.deepEqual(codes("(defun g (y) y)"), []);
});

test("does not report a let binding in its body", () => {
  assert.deepEqual(codes("(defun g () (let ((y 1)) y))"), []);
});

test("does not report a keyword", () => {
  assert.deepEqual(codes("(list :key)"), []);
});

test("does not report T or NIL", () => {
  assert.deepEqual(codes("(list t nil)"), []);
});

test("does not report quoted data", () => {
  assert.deepEqual(codes("(list 'foo)"), []);
});

test("reports too many arguments for a file function", () => {
  const found = diagnose("(defun f (x) x) (f 1 2)");

  assert.deepEqual(
    found.map((diagnostic) => diagnostic.code),
    ["arity"],
  );
  assert.equal(found[0]?.severity, "error");
  assert.match(found[0]?.message ?? "", /F takes exactly 1 argument, but is called with 2/);
});

test("reports too few arguments for a file function", () => {
  assert.deepEqual(codes("(defun f (x y) x) (f 1)"), ["arity"]);
});

test("does not report a correct call", () => {
  assert.deepEqual(codes("(defun f (x) x) (f 1)"), []);
});

test("checks arity through a forward reference", () => {
  assert.deepEqual(codes("(defun a () (b 1)) (defun b (x y) x)"), ["arity"]);
});

test("reports too many arguments for a builtin", () => {
  const found = diagnose("(car 1 2)");

  assert.deepEqual(
    found.map((diagnostic) => diagnostic.code),
    ["arity"],
  );
  assert.equal(found[0]?.severity, "error");
});

test("reports too few arguments for a builtin", () => {
  assert.deepEqual(codes("(car)"), ["arity"]);
});

test("does not report a variadic builtin", () => {
  assert.deepEqual(codes("(+ 1 2 3)"), []);
});

test("checks a cond clause test as a variable", () => {
  const found = codes("(cond (x 1))");

  assert.deepEqual(found, ["unbound-variable"]);
});

test("does not report the name in a function form", () => {
  assert.deepEqual(codes("(defun f () 1) (function f)"), []);
});

test("does not report loop clause keywords or loop names", () => {
  assert.deepEqual(codes("(loop with y = 1 do (print y))"), []);
});

test("does not report a lambda in head position", () => {
  assert.deepEqual(codes("((lambda (x) (+ x 1)) 2)"), []);
});

test("accepts a recursive call that matches its arity", () => {
  assert.deepEqual(
    codes("(defun fact (n) (if (= n 0) 1 (* n (fact (- n 1)))))"),
    [],
  );
});

test("accepts a small realistic file", () => {
  assert.deepEqual(
    codes(
      "(defun classify (n) (let ((rest (mod n 2))) (if (= rest 0) 'even 'odd)))",
    ),
    [],
  );
});

test("treats &optional parameters as optional", () => {
  assert.deepEqual(codes("(defun f (a &optional b) (list a b)) (f 1)"), []);
  assert.deepEqual(codes("(defun f (a &optional b) (list a b)) (f 1 2 3)"), [
    "arity",
  ]);
});

test("accepts any number of arguments after &rest", () => {
  assert.deepEqual(codes("(defun f (a &rest xs) (list a xs)) (f 1 2 3)"), []);
});

test("accepts keyword arguments after &key", () => {
  assert.deepEqual(codes("(defun f (&key a) a) (f :a 1)"), []);
});

test("checks the arity of a keyword builtin that lives in the interpreter", () => {
  // COUNT and SORT are registered beside FUNCALL because they call functions;
  // the checker still has to see them.
  assert.deepEqual(codes("(count 1)"), ["arity"]);
  assert.deepEqual(codes("(sort '(2 1))"), ["arity"]);
  assert.deepEqual(codes("(count 1 '(1) :test #'=)"), []);
});

test("checks the default value forms in a lambda list", () => {
  assert.deepEqual(codes("(defun f (&optional (a missing)) a)"), [
    "unbound-variable",
  ]);
});

test("does not report supplied-p or &aux names", () => {
  assert.deepEqual(codes("(defun f (&optional (a 1 sp) &aux (b a)) (list a sp b))"), []);
});

test("reports a default that names a parameter to its right", () => {
  // Parameters bind left to right, so B is not in scope in A's default.
  assert.deepEqual(codes("(defun f (&optional (a b) b) a)"), ["unbound-variable"]);
});

test("downgrades arity when the function is defined twice", () => {
  const found = diagnose("(defun f (x) x) (defun f (x y) x) (f 1)");

  assert.deepEqual(
    found.map((diagnostic) => diagnostic.code),
    ["arity"],
  );
  assert.equal(found[0]?.severity, "warning");
});

test("says Lispnt reads one file at a time in the undefined function message", () => {
  const found = diagnose("(defun g () (missing-fn))");

  assert.match(found[0]?.message ?? "", /one file at a time/);
});

test("binds the function a hash table iterator introduces", () => {
  assert.deepEqual(
    codes("(defun f (table) (with-hash-table-iterator (next table) (next)))"),
    [],
  );
});

test("binds the stream variable of with-output-to-string", () => {
  assert.deepEqual(
    codes("(defun f () (with-output-to-string (s) (princ 1 s)))"),
    [],
  );
});

test("walks the string form of with-input-from-string", () => {
  assert.deepEqual(
    codes("(defun f (text) (with-input-from-string (s text) (read s)))"),
    [],
  );
});

test("binds the stream variable of with-open-file", () => {
  assert.deepEqual(
    codes(
      '(defun f () (with-open-file (s "x.txt" :direction :output) (write-line "hi" s)))',
    ),
    [],
  );
});

test("binds the variables of multiple-value-bind", () => {
  assert.deepEqual(
    codes("(defun f () (multiple-value-bind (a b) (floor 7 2) (+ a b)))"),
    [],
  );
});

test("binds a nested destructuring pattern", () => {
  assert.deepEqual(
    codes(
      "(defun f () (destructuring-bind (a (b c)) (list 1 (list 2 3)) (+ a b c)))",
    ),
    [],
  );
});

test("binds the condition variable of a handler-case clause", () => {
  assert.deepEqual(
    codes("(defun f () (handler-case (list 1) (error (e) (princ e))))"),
    [],
  );
});

test("reports an undefined function inside a decoded form", () => {
  assert.deepEqual(
    codes("(defun f () (with-output-to-string (s) (missing s)))"),
    ["undefined-function"],
  );
});

test("does not report the second of a list", () => {
  assert.deepEqual(codes("(second (list 1 2))"), []);
});

test("does not report a dotimes result form that uses the counter", () => {
  assert.deepEqual(codes("(defun f (n) (dotimes (i n (list i)) i))"), []);
});

test("stays quiet about names when the file defines a structure", () => {
  assert.deepEqual(codes("(defstruct point x) (make-point :x 1)"), []);
});

test("does not report an accessor a structure generates", () => {
  assert.deepEqual(
    codes("(defstruct point x) (defun get-x (p) (point-x p))"),
    [],
  );
});

test("still reports an undefined function in a file with a structure", () => {
  assert.deepEqual(codes("(defstruct point x) (mystery-fn 1)"), [
    "undefined-function",
  ]);
});

test("stays quiet about undefined names when a structure is not modelled", () => {
  assert.deepEqual(
    codes("(defstruct (child (:include parent)) z) (mystery-fn 1)"),
    [],
  );
});

test("accepts correct do code", () => {
  assert.deepEqual(
    codes("(defun f (n) (do ((i 0 (+ i 1))) ((= i n) i) (print i)))"),
    [],
  );
});

test("reports an unbound variable in a do body", () => {
  assert.deepEqual(
    codes("(do ((i 0 (+ i 1))) ((= i 3) i) (print missing))"),
    ["unbound-variable"],
  );
});

test("reports a wrong arity inside a case clause body", () => {
  assert.deepEqual(codes("(defun f (x) (case x (1 (car 1 2))))"), ["arity"]);
});

test("does not read case keys as calls", () => {
  assert.deepEqual(codes("(defun f (x) (case x ((foo) 1)))"), []);
});

test("walks an otherwise clause body", () => {
  assert.deepEqual(
    codes("(defun f (x) (case x (otherwise (missing))))"),
    ["undefined-function"],
  );
});

test("does not read do or the case family as function calls", () => {
  assert.deepEqual(
    codes("(defun f (n) (do ((i 0 (+ i 1))) ((= i n) i)) (case n (1 'one) (otherwise 'other)))"),
    [],
  );
});

test("checks the argument count of a builtin it now implements", () => {
  assert.deepEqual(codes("(defun f () (1+ 1 2))"), ["arity"]);
  assert.deepEqual(codes("(defun f (x) (schar x))"), ["arity"]);
  assert.deepEqual(codes("(defun f () (1+ 1))"), []);
});

test("checks a defstruct slot default", () => {
  assert.deepEqual(codes("(defstruct s (x (nope)))"), ["undefined-function"]);
});

test("checks the value form of multiple-value-setq", () => {
  const found = codes("(multiple-value-setq (a b) (missing-fn))");

  assert.ok(found.includes("undefined-function"));
});
