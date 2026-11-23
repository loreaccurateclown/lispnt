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

test("downgrades arity when the function is defined twice", () => {
  const found = diagnose("(defun f (x) x) (defun f (x y) x) (f 1)");

  assert.deepEqual(
    found.map((diagnostic) => diagnostic.code),
    ["arity"],
  );
  assert.equal(found[0]?.severity, "warning");
});

test("points at loading another file in the undefined function message", () => {
  const found = diagnose("(defun g () (missing-fn))");

  assert.match(found[0]?.message ?? "", /load that file first/);
});

test("does not report an opaque standard form", () => {
  assert.deepEqual(codes("(with-hash-table-iterator (next table) (next))"), []);
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
