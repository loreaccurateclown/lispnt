import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, parseAll, type AstNode } from "../src/core/reader";
import { NIL, cons, intern, isNil, type LispValue } from "../src/core/values";
import { LispEvalError } from "../src/core/errors";
import { printValue } from "../src/core/print";
import {
  astToValue,
  createEnv,
  define,
  evaluate,
  HARD_STEP_CEILING,
  lookup,
  ReturnSignal,
  SPECIAL_FORMS,
  withObserver,
  withStepCeiling,
} from "../src/core/interpreter";
import { builtins } from "../src/core/builtins";
import { STANDARD_SYMBOLS } from "../src/core/standard-symbols";

//LLM-written tests
function num(value: number): LispValue {
  return { kind: "number", value };
}

function printValueOf(source: string): string {
  return printValue(evalIn(source));
}

function expectCons(value: LispValue) {
  if (value.kind !== "cons") {
    assert.fail(`expected a cons, got ${value.kind}`);
  }
  return value;
}

test("evaluates a number literal", () => {
  assert.deepEqual(evaluate(parse("42"), createEnv(null)), num(42));
});

test("evaluates a string literal", () => {
  assert.deepEqual(evaluate(parse('"hi"'), createEnv(null)), {
    kind: "string",
    value: "hi",
  });
});

test("binds T in the root environment, case-insensitively", () => {
  const env = createEnv(null);

  const upper = evaluate(parse("T"), env);
  const lower = evaluate(parse("t"), env);

  assert.equal(upper, intern("T"));
  assert.equal(lower, upper);
});

test("throws on an unbound symbol", () => {
  assert.throws(() => evaluate(parse("x"), createEnv(null)));
});

test("resolves defined names case-insensitively", () => {
  const env = createEnv(null);
  define(env, "x", num(1));

  assert.deepEqual(evaluate(parse("X"), env), num(1));
  assert.deepEqual(evaluate(parse("x"), env), num(1));
});

test("finds parent bindings and lets a child shadow them", () => {
  const parent = createEnv(null);
  define(parent, "y", num(2));
  const child = createEnv(parent);

  assert.deepEqual(lookup(child, "y"), num(2));

  define(child, "y", num(3));

  assert.deepEqual(lookup(child, "y"), num(3));
  assert.deepEqual(lookup(parent, "y"), num(2));
});

test("evaluates a quoted symbol to an interned uppercase symbol", () => {
  assert.deepEqual(evaluate(parse("'foo"), createEnv(null)), {
    kind: "symbol",
    name: "FOO",
  });
});

test("evaluates a quoted list to a cons chain in order", () => {
  const chain = expectCons(evaluate(parse("'(1 2 3)"), createEnv(null)));
  assert.deepEqual(chain.car, num(1));

  const second = expectCons(chain.cdr);
  assert.deepEqual(second.car, num(2));

  const third = expectCons(second.cdr);
  assert.deepEqual(third.car, num(3));
  assert.ok(isNil(third.cdr));
});

test("evaluates the empty list to NIL", () => {
  assert.ok(isNil(evaluate(parse("'()"), createEnv(null))));
});

test("evaluates a doubly quoted symbol to the data (QUOTE X)", () => {
  const chain = expectCons(evaluate(parse("''x"), createEnv(null)));

  assert.equal(chain.car, intern("QUOTE"));
  assert.equal(expectCons(chain.cdr).car, intern("X"));
  assert.ok(isNil(expectCons(chain.cdr).cdr));
});

test("evaluates a quoted vector literal to an array value", () => {
  const value = evaluate(parse("'#(1 2)"), createEnv(null));

  assert.equal(value.kind, "array");
  if (value.kind !== "array") return;

  assert.deepEqual(value.elements, [num(1), num(2)]);
});

test("interns one symbol per name, ignoring case", () => {
  assert.equal(intern("foo"), intern("FOO"));
  assert.deepEqual(cons(num(1), NIL).cdr, NIL);
});

test("converts a bare list node without going through quote", () => {
  const chain = expectCons(astToValue(parse("(a b)")));

  assert.equal(chain.car, intern("A"));
  assert.equal(expectCons(chain.cdr).car, intern("B"));
});

//LLM-written tests
test("evaluates a dotted pair to a cons whose cdr is the tail", () => {
  assert.deepEqual(evaluate(parse("'(a . b)"), createEnv(null)), {
    kind: "cons",
    car: { kind: "symbol", name: "A" },
    cdr: { kind: "symbol", name: "B" },
  });
});

test("evaluates a one-entry alist built from a dotted pair", () => {
  const outer = expectCons(
    evaluate(parse('\'((name . "Ann"))'), createEnv(null)),
  );
  const entry = expectCons(outer.car);

  assert.equal(entry.car, intern("NAME"));
  assert.deepEqual(entry.cdr, { kind: "string", value: "Ann" });
  assert.ok(isNil(outer.cdr));
});

//LLM-written tests
function run(source: string): LispValue {
  return evaluate(parse(source), createEnv(null));
}

test("evaluates if with both branches and without an else", () => {
  assert.deepEqual(run("(if t 1 2)"), num(1));
  assert.deepEqual(run("(if nil 1 2)"), num(2));
  assert.ok(isNil(run("(if nil 1)")));
});

test("treats zero as true in if", () => {
  assert.deepEqual(run("(if 0 1 2)"), num(1));
});

test("evaluates cond up to the first matching clause", () => {
  assert.deepEqual(run("(cond (nil 1) (t 2))"), num(2));
  assert.ok(isNil(run("(cond (nil 1))")));
});

test("evaluates a cond clause with a t test", () => {
  assert.deepEqual(run("(cond (t 5))"), num(5));
});

test("evaluates and, returning the last value or nil", () => {
  assert.deepEqual(run("(and 1 2)"), num(2));
  assert.ok(isNil(run("(and 1 nil 2)")));
  assert.equal(run("(and)"), intern("T"));
});

test("evaluates or, returning the first truthy value", () => {
  assert.deepEqual(run("(or nil 3)"), num(3));
  assert.ok(isNil(run("(or nil nil)")));
  assert.ok(isNil(run("(or)")));
});

test("evaluates when only on a truthy test", () => {
  assert.deepEqual(run("(when t 1 2)"), num(2));
  assert.ok(isNil(run("(when nil 1)")));
});

test("evaluates unless only on a false test", () => {
  assert.deepEqual(run("(unless nil 1 2)"), num(2));
  assert.ok(isNil(run("(unless t 1)")));
});

test("evaluates progn to its last form", () => {
  assert.deepEqual(run("(progn 1 2 3)"), num(3));
  assert.ok(isNil(run("(progn)")));
});

test("evaluates let bindings and body", () => {
  assert.deepEqual(run("(let ((x 2)) x)"), num(2));
});

test("evaluates a bare symbol let binding as nil", () => {
  assert.ok(isNil(run("(let (x) x)")));
});

test("lets an inner let shadow an outer binding", () => {
  assert.deepEqual(run("(let ((x 1)) (let ((x 2)) x))"), num(2));
});

test("initialises let values in the outer environment", () => {
  assert.deepEqual(run("(let ((x 1)) (let ((x 2) (y x)) y))"), num(1));
});

test("initialises let* values sequentially", () => {
  assert.deepEqual(run("(let* ((x 1) (y x)) y)"), num(1));
  assert.throws(() => run("(let ((x 1) (y x)) y)"));
});

test("evaluates defparameter and sees the binding afterwards", () => {
  assert.deepEqual(run("(progn (defparameter *x* 5) *x*)"), num(5));
});

test("evaluates setq against an existing binding", () => {
  assert.deepEqual(run("(let ((x 1)) (progn (setq x 2) x))"), num(2));
});

test("binds a function value for defun", () => {
  const value = run("(progn (defun f (x) x) f)");

  assert.equal(value.kind, "function");
  if (value.kind !== "function") return;

  assert.equal(value.name, "F");
  assert.deepEqual(value.lambdaList.required, ["X"]);
  assert.equal(value.body.length, 1);
});

test("rejects a defun whose argument list is not a list", () => {
  assert.throws(() => run("(defun f 1)"));
});

//LLM-written tests
test("applies a user-defined function to its argument", () => {
  assert.deepEqual(run("(progn (defun f (x) x) (f 42))"), num(42));
});

test("passes several arguments in order", () => {
  assert.deepEqual(run("(progn (defun second (a b) b) (second 1 2))"), num(2));
});

test("rejects a call with too few arguments", () => {
  assert.throws(() => run("(progn (defun f (x) x) (f))"));
});

test("rejects a call with too many arguments", () => {
  assert.throws(() => run("(progn (defun f (x) x) (f 1 2))"));
});

// A lambda list is parsed where the function is written, and its defaults run in
// the call's scope. These use evalIn so the definition and the call are separate
// top-level forms, the way a learner writes them.
function errorCodeOf(source: string): string | undefined {
  try {
    evalIn(source);
    return undefined;
  } catch (error) {
    return error instanceof LispEvalError ? error.code : "not-a-lisp-error";
  }
}

test("binds a &optional parameter from its default when it is omitted", () => {
  assert.deepEqual(evalIn("(defun f (&optional (x 5)) x) (f)"), num(5));
  assert.deepEqual(evalIn("(defun f (&optional (x 5)) x) (f 3)"), num(3));
});

test("binds NIL to an &optional parameter with no default", () => {
  assert.ok(isNil(evalIn("(defun f (&optional x) x) (f)")));
});

test("binds a supplied-p name to T or NIL", () => {
  assert.equal(printValueOf("(defun f (&optional (x 1 sp)) (list x sp)) (f)"), "(1 NIL)");
  assert.equal(printValueOf("(defun f (&optional (x 1 sp)) (list x sp)) (f 9)"), "(9 T)");
});

test("evaluates an &optional default in the scope of the parameters before it", () => {
  assert.equal(printValueOf("(defun f (a &optional (b a)) (list a b)) (f 2)"), "(2 2)");
});

test("collects the remaining arguments into &rest", () => {
  assert.equal(printValueOf("(defun f (a &rest xs) (list a xs)) (f 1 2 3)"), "(1 (2 3))");
  assert.equal(printValueOf("(defun f (a &rest xs) (list a xs)) (f 1)"), "(1 NIL)");
  assert.equal(printValueOf("(defun f (&rest xs) xs) (f 1 2 3 4)"), "(1 2 3 4)");
});

test("treats &body as &rest", () => {
  assert.equal(printValueOf("(defun f (&body xs) xs) (f 1 2)"), "(1 2)");
});

test("binds &key parameters by keyword name", () => {
  assert.deepEqual(evalIn("(defun f (&key a) a) (f :a 1)"), num(1));
  assert.ok(isNil(evalIn("(defun f (&key a) a) (f)")));
});

test("binds a &key default and supplied-p name", () => {
  assert.equal(printValueOf("(defun f (&key (a 2 ap)) (list a ap)) (f)"), "(2 NIL)");
  assert.equal(printValueOf("(defun f (&key (a 2 ap)) (list a ap)) (f :a 7)"), "(7 T)");
});

test("matches a renamed &key parameter on its keyword, not its variable", () => {
  assert.deepEqual(evalIn("(defun f (&key ((:total sum))) sum) (f :total 4)"), num(4));
});

test("accepts &key arguments in any order", () => {
  assert.equal(printValueOf("(defun f (&key a b) (list a b)) (f :b 2 :a 1)"), "(1 2)");
});

test("gives &rest and &key the same remaining arguments", () => {
  assert.equal(
    printValueOf("(defun f (&rest r &key a) (list a r)) (f :a 1)"),
    "(1 (:A 1))",
  );
});

test("binds &aux in order, after the other parameters", () => {
  assert.deepEqual(evalIn("(defun f (a &aux (b (* a 2))) b) (f 3)"), num(6));
  assert.ok(isNil(evalIn("(defun f (&aux b) b) (f)")));
});

test("counts only required parameters against the minimum", () => {
  assert.equal(errorCodeOf("(defun f (a &optional b) b) (f)"), "arity");
  assert.equal(errorCodeOf("(defun f (&optional a) a) (f 1 2)"), "arity");
  assert.equal(errorCodeOf("(defun f (&rest xs) xs) (f 1 2 3)"), undefined);
});

test("rejects keyword arguments that do not fit the lambda list", () => {
  assert.equal(errorCodeOf("(defun f (&key a) a) (f :a)"), "malformed-form");
  assert.equal(errorCodeOf("(defun f (&key a) a) (f :b 1)"), "type-error");
  assert.equal(errorCodeOf("(defun f (&key a) a) (f 1 2)"), "type-error");
});

test("reports lambda list features it does not model as our gap", () => {
  assert.equal(errorCodeOf("(defun f (&rest r &allow-other-keys) r)"), "unsupported-standard");
});

test("rejects a lambda list whose markers are out of order or repeated", () => {
  assert.equal(errorCodeOf("(defun f (&key a &optional b) b)"), "malformed-form");
  assert.equal(errorCodeOf("(defun f (a a) a)"), "malformed-form");
});

test("rejects a &rest with no parameter name", () => {
  assert.equal(errorCodeOf("(defun f (&rest) 1)"), "malformed-form");
  assert.equal(errorCodeOf("(defun f (&rest &key a) a)"), "malformed-form");
  // &optional and &key may end the list with nothing after them.
  assert.deepEqual(evalIn("(defun f (&optional) 1) (f)"), num(1));
});

test("accepts a lambda list on a lambda and a local function", () => {
  assert.deepEqual(evalIn("(funcall (lambda (&optional (x 2)) x))"), num(2));
  assert.deepEqual(evalIn("(labels ((g (&key a) a)) (g :a 3))"), num(3));
});

test("lets a body read a binding from its defining environment", () => {
  assert.deepEqual(run("(let ((x 5)) (progn (defun get () x) (get)))"), num(5));
});

test("supports a self-recursive function with a base case", () => {
  assert.deepEqual(run("(progn (defun stop (x) (if x 1 (stop t))) (stop nil))"), num(1));
});

test("lets a call assign a binding captured from its defining environment", () => {
  assert.deepEqual(
    run("(let ((x 1)) (progn (defun bump (v) (progn (setq x v) v)) (bump 2) x))"),
    num(2),
  );
});

test("resolves a #' designator to the function value", () => {
  const value = run("(progn (defun f (x) x) #'f)");

  assert.equal(value.kind, "function");
  if (value.kind !== "function") return;

  assert.equal(value.name, "F");
});

test("rejects calling a value that is not a function", () => {
  assert.throws(() => run("(let ((x 5)) (x 1))"));
});

test("evaluates the empty list to NIL", () => {
  assert.ok(isNil(run("()")));
});

test("evaluates a nested call", () => {
  assert.deepEqual(run("(progn (defun f (x) x) (f (f 3)))"), num(3));
});

//LLM-written tests
test("adds numbers with +", () => {
  assert.deepEqual(run("(+ 1 2)"), num(3));
  assert.deepEqual(run("(+)"), num(0));
});

test("subtracts numbers with -", () => {
  assert.deepEqual(run("(- 5)"), num(-5));
  assert.deepEqual(run("(- 5 2)"), num(3));
});

test("multiplies numbers with *", () => {
  assert.deepEqual(run("(* 2 3 4)"), num(24));
});

test("divides numbers and rejects division by zero", () => {
  assert.deepEqual(run("(/ 10 2)"), num(5));
  assert.throws(() => run("(/ 1 0)"));
});

test("compares numbers with =", () => {
  assert.equal(run("(= 1 1)"), intern("T"));
  assert.ok(isNil(run("(= 1 2)")));
});

test("compares a chain with <", () => {
  assert.equal(run("(< 1 2 3)"), intern("T"));
  assert.ok(isNil(run("(< 1 3 2)")));
});

test("compares symbols with eq", () => {
  assert.equal(run("(eq 'a 'a)"), intern("T"));
  assert.ok(isNil(run("(eq 'a 'b)")));
});

test("distinguishes equal from eq on lists", () => {
  assert.equal(run("(equal '(1 2) '(1 2))"), intern("T"));
  assert.ok(isNil(run("(eq '(1 2) '(1 2))")));
});

// EQUALP descends where EQUAL does not. Verified against SBCL: strings and
// characters compare case-insensitively, lists and arrays elementwise,
// structures of the same type slot by slot, and hash tables by identity.
test("equalp ignores case in strings and characters", () => {
  assert.deepEqual(evalIn("(equalp \"abc\" \"ABC\")"), intern("T"));
  assert.deepEqual(evalIn("(equalp #\\a #\\A)"), intern("T"));
  assert.ok(isNil(evalIn("(equalp #\\a #\\b)")));
  assert.ok(isNil(evalIn("(equal \"abc\" \"ABC\")")));
});

test("equalp descends into lists and arrays", () => {
  assert.deepEqual(
    evalIn("(equalp '(1 2 (3 \"x\")) '(1 2 (3 \"X\")))"),
    intern("T"),
  );
  assert.ok(isNil(evalIn("(equalp '(1 2) '(1 2 3))")));
  assert.deepEqual(evalIn("(equalp #(1 2) #(1 2))"), intern("T"));
  assert.ok(isNil(evalIn("(equalp #(1 2) #(1 3))")));
  assert.deepEqual(evalIn("(equalp 1 1.0)"), intern("T"));
});

test("equalp compares structures of one type slot by slot", () => {
  assert.deepEqual(
    evalIn("(defstruct p x y) (equalp (make-p :x 1 :y 2) (make-p :x 1 :y 2))"),
    intern("T"),
  );
  assert.ok(
    isNil(evalIn("(defstruct p x y) (equalp (make-p :x 1 :y 2) (make-p :x 1 :y 3))")),
  );
  assert.ok(
    isNil(evalIn("(defstruct p x) (defstruct q x) (equalp (make-p :x 1) (make-q :x 1))")),
  );
});

test("equalp keeps hash tables by identity", () => {
  assert.deepEqual(
    evalIn("(let ((table (make-hash-table))) (equalp table table))"),
    intern("T"),
  );
  assert.ok(isNil(evalIn("(equalp (make-hash-table) (make-hash-table))")));
});

test("takes the head and tail of a list", () => {
  assert.deepEqual(run("(car '(1 2))"), num(1));
  assert.deepEqual(run("(cdr '(1 2))"), cons(num(2), NIL));
});

test("builds pairs and lists", () => {
  assert.deepEqual(run("(cons 1 2)"), cons(num(1), num(2)));
  assert.deepEqual(
    run("(list 1 2 3)"),
    cons(num(1), cons(num(2), cons(num(3), NIL))),
  );
});

test("measures list length", () => {
  assert.deepEqual(run("(length '(1 2 3))"), num(3));
  assert.deepEqual(run("(length '())"), num(0));
});

test("appends lists and returns NIL with no arguments", () => {
  assert.deepEqual(
    run("(append '(1 2) '(3 4))"),
    cons(num(1), cons(num(2), cons(num(3), cons(num(4), NIL)))),
  );
  assert.ok(isNil(run("(append)")));
});

test("tests null and atom", () => {
  assert.equal(run("(null nil)"), intern("T"));
  assert.equal(run("(atom 1)"), intern("T"));
  assert.ok(isNil(run("(atom '(1))")));
});

test("treats zero as truthy for not", () => {
  assert.equal(run("(not nil)"), intern("T"));
  assert.ok(isNil(run("(not 0)")));
});

test("has numeric predicates", () => {
  assert.equal(run("(evenp 4)"), intern("T"));
  assert.equal(run("(zerop 0)"), intern("T"));
  assert.ok(isNil(run("(numberp 'a)")));
});

test("calls a designator with funcall", () => {
  assert.deepEqual(run("(funcall #'car '(1 2))"), num(1));
});

test("spreads a list with apply", () => {
  assert.deepEqual(run("(apply #'+ '(1 2 3))"), num(6));
});

test("rejects type errors inside builtins", () => {
  assert.throws(() => run("(car 5)"));
  assert.throws(() => run('(+ 1 "a")'));
});

test("lets a user function call builtins", () => {
  assert.deepEqual(run("(progn (defun sq (x) (* x x)) (sq 4))"), num(16));
});

test("lets a user defun shadow a builtin name", () => {
  assert.deepEqual(run("(progn (defun length (x) 99) (length '(1)))"), num(99));
});

//LLM-written tests
test("makes an array of a given size filled with NIL", () => {
  assert.deepEqual(run("(make-array 3)"), {
    kind: "array",
    elements: [NIL, NIL, NIL],
  });
});

test("makes an array with an initial element", () => {
  assert.deepEqual(run("(make-array 3 :initial-element 0)"), {
    kind: "array",
    elements: [num(0), num(0), num(0)],
  });
});

test("builds an array with vector", () => {
  assert.deepEqual(run("(vector 1 2 3)"), {
    kind: "array",
    elements: [num(1), num(2), num(3)],
  });
});

test("builds an empty array with vector and no arguments", () => {
  assert.equal(printValueOf("(vector)"), "#()");
  assert.deepEqual(evalIn("(length (vector))"), num(0));
});

test("reads an array element with aref", () => {
  assert.deepEqual(run("(aref (vector 1 2 3) 1)"), num(2));
});

test("rejects an out of range aref index", () => {
  assert.throws(() => run("(aref (vector 1) 5)"));
});

test("reads a list element with elt", () => {
  assert.equal(run("(elt '(a b) 1)"), intern("B"));
});

test("measures array length", () => {
  assert.deepEqual(run("(length (vector 1 2 3))"), num(3));
});

test("builds an array from :initial-contents", () => {
  assert.equal(printValueOf("(make-array 3 :initial-contents '(1 2 3))"), "#(1 2 3)");
  assert.equal(printValueOf("(make-array 2 :initial-contents #(4 5))"), "#(4 5)");
});

test("rejects :initial-contents of the wrong length", () => {
  assert.equal(errorCodeOf("(make-array 3 :initial-contents '(1 2))"), "type-error");
});

test("reports an array keyword it does not model as our gap", () => {
  assert.equal(
    errorCodeOf("(make-array 3 :element-type 'fixnum)"),
    "unsupported-standard",
  );
});

test("rejects a bad keyword argument list", () => {
  assert.equal(errorCodeOf("(make-array 3 1 2)"), "type-error");
  assert.equal(errorCodeOf("(make-array 3 :initial-element)"), "malformed-form");
});

test("counts a vector only up to its fill pointer", () => {
  assert.equal(
    printValueOf("(setf v (make-array 3 :fill-pointer 0)) (vector-push 7 v) v"),
    "#(7)",
  );
  assert.deepEqual(
    evalIn("(setf v (make-array 3 :fill-pointer 0)) (vector-push 7 v) (length v)"),
    num(1),
  );
});

test("pushes onto a full vector only through vector-push-extend", () => {
  assert.ok(isNil(evalIn("(setf v (make-array 1 :fill-pointer 1)) (vector-push 9 v)")));
  assert.deepEqual(
    evalIn("(setf v (make-array 1 :fill-pointer 1)) (vector-push-extend 9 v)"),
    num(1),
  );
  assert.equal(
    printValueOf("(setf v (make-array 1 :fill-pointer 1)) (vector-push-extend 9 v) v"),
    "#(NIL 9)",
  );
});

test("needs a fill pointer to push", () => {
  assert.equal(errorCodeOf("(vector-push 1 (make-array 2))"), "type-error");
  assert.equal(errorCodeOf("(vector-push-extend 1 (make-array 2))"), "type-error");
});

test("keeps aref bounded by capacity, not by the fill pointer", () => {
  assert.ok(isNil(evalIn("(setf v (make-array 5 :fill-pointer 0)) (aref v 4)")));
  assert.equal(
    errorCodeOf("(setf v (make-array 2 :fill-pointer 0)) (aref v 2)"),
    "index-error",
  );
});

test("makes a string of spaces or of one repeated character", () => {
  assert.equal(printValueOf("(make-string 3)"), '"   "');
  assert.equal(printValueOf("(make-string 3 :initial-element #\\a)"), '"aaa"');
});

test("writes an array element through an aref place", () => {
  assert.deepEqual(
    run("(let ((a (make-array 2))) (progn (setf (aref a 0) 5) (aref a 0)))"),
    num(5),
  );
});

test("leaves other array elements untouched by setf", () => {
  assert.deepEqual(run("(let ((a (vector 1 2))) (progn (setf (aref a 1) 9) a))"), {
    kind: "array",
    elements: [num(1), num(9)],
  });
});

test("assigns a variable through setf", () => {
  assert.deepEqual(run("(let ((x 1)) (progn (setf x 2) x))"), num(2));
});

test("assigns the car of a cons through setf", () => {
  assert.deepEqual(
    run("(let ((l (list 1 2))) (progn (setf (car l) 9) l))"),
    cons(num(9), cons(num(2), NIL)),
  );
});

test("assigns the cdr of a cons through setf", () => {
  assert.deepEqual(
    run("(let ((l (list 1 2))) (progn (setf (cdr l) nil) l))"),
    cons(num(1), NIL),
  );
});

test("assigns several places in one setf", () => {
  assert.deepEqual(
    run("(let ((x 1) (y 2)) (progn (setf x 10 y 20) (+ x y)))"),
    num(30),
  );
});

test("increments a variable with incf", () => {
  assert.deepEqual(run("(let ((x 1)) (progn (incf x) x))"), num(2));
});

test("increments an array element through a place", () => {
  assert.deepEqual(
    run("(let ((a (vector 1 2))) (progn (incf (aref a 0) 10) (aref a 0)))"),
    num(11),
  );
});

test("rejects setf on something that is not a place", () => {
  assert.throws(() => run("(setf (unknown-place) 1)"));
});

//LLM-written tests
test("iterates a list with dolist", () => {
  assert.deepEqual(
    run("(let ((acc 0)) (progn (dolist (x '(1 2 3)) (setf acc (+ acc x))) acc))"),
    num(6),
  );
});

test("returns the dolist result form", () => {
  assert.equal(run("(dolist (x '(1 2) 'done))"), intern("DONE"));
});

test("returns NIL from a dolist over an empty list", () => {
  assert.ok(isNil(run("(dolist (x '()))")));
});

test("counts with dotimes", () => {
  assert.deepEqual(
    run("(let ((n 0)) (progn (dotimes (i 5) (setf n (+ n i))) n))"),
    num(10),
  );
});

test("binds the dotimes variable to the count in the result form", () => {
  assert.deepEqual(run("(dotimes (i 3 i))"), num(3));
});

test("leaves a dotimes loop early with return", () => {
  assert.deepEqual(run("(dotimes (i 10) (if (= i 3) (return i)))"), num(3));
});

test("leaves a dolist loop early with return", () => {
  assert.deepEqual(
    run("(dolist (x '(1 2 3) 'end) (if (= x 2) (return x)))"),
    num(2),
  );
});

test("pushes onto a list place", () => {
  assert.deepEqual(
    run("(let ((l nil)) (progn (push 1 l) (push 2 l) l))"),
    cons(num(2), cons(num(1), NIL)),
  );
});

test("rejects push with more than an item and a place", () => {
  assert.throws(() => run("(push 1 2 l)"));
});

test("pops the first element and returns it", () => {
  assert.deepEqual(run("(let ((l '(1 2))) (pop l))"), num(1));
});

test("pops the first element off the place", () => {
  assert.deepEqual(
    run("(let ((l '(1 2))) (progn (pop l) l))"),
    cons(num(2), NIL),
  );
});

test("pushes into an array element place", () => {
  assert.deepEqual(
    run("(let ((a (make-array 1))) (progn (push 5 (aref a 0)) (aref a 0)))"),
    cons(num(5), NIL),
  );
});

test("rejects pop on something that is not a place", () => {
  assert.throws(() => run("(pop 5)"));
});

//LLM-written tests
test("reports enter and leave events for nested forms", () => {
  const events: string[] = [];
  const observer = {
    onEnterForm: (node: AstNode) => events.push(`in:${node.kind}`),
    onLeaveForm: (node: AstNode) => events.push(`out:${node.kind}`),
  };

  withObserver(observer, () => evaluate(parse("(+ 1 2)"), createEnv(null)));

  assert.ok(events.includes("in:list"));
  assert.ok(events.includes("in:atom"));
  assert.equal(
    events.filter((event) => event.startsWith("in:")).length,
    events.filter((event) => event.startsWith("out:")).length,
  );
});

test("records a balanced call frame for every recursive call", () => {
  let calls = 0;
  let returns = 0;
  const observer = {
    onCallEnter: () => {
      calls += 1;
    },
    onCallExit: () => {
      returns += 1;
    },
  };

  withObserver(observer, () =>
    evaluate(
      parse(
        "(progn (defun fact (n) (if (= n 0) 1 (* n (fact (- n 1))))) (fact 3))",
      ),
      createEnv(null),
    ),
  );

  assert.equal(calls, returns);
  assert.ok(calls > 3);
});

test("reports the value each user function returns", () => {
  let last: LispValue | undefined;
  const observer = {
    onCallExit: (_fn: unknown, value: LispValue) => {
      last = value;
    },
  };

  withObserver(observer, () =>
    evaluate(
      parse(
        "(progn (defun fact (n) (if (= n 0) 1 (* n (fact (- n 1))))) (fact 3))",
      ),
      createEnv(null),
    ),
  );

  assert.deepEqual(last, num(6));
});

test("restores the previous observer after a nested scope", () => {
  const outer: string[] = [];
  const inner: string[] = [];
  const recorder = (log: string[]) => ({
    onEnterForm: (node: AstNode) => log.push(node.kind),
  });

  withObserver(recorder(outer), () => {
    evaluate(parse("1"), createEnv(null));
    withObserver(recorder(inner), () => evaluate(parse("2"), createEnv(null)));
    evaluate(parse("3"), createEnv(null));
  });

  assert.equal(inner.length, 1);
  assert.equal(outer.length, 2);
});

test("does not leak an observer that throws", () => {
  const observer = {
    onEnterForm: () => {
      throw new Error("observer failure");
    },
  };

  assert.throws(() =>
    withObserver(observer, () => evaluate(parse("1"), createEnv(null))),
  );

  // If the observer had leaked, this call would throw as well.
  assert.deepEqual(evaluate(parse("2"), createEnv(null)), num(2));
});

//LLM-written tests
test("applies a lambda to its argument", () => {
  assert.deepEqual(run("((lambda (x) x) 5)"), num(5));
});

test("calls a lambda through funcall with several arguments", () => {
  assert.deepEqual(run("(funcall (lambda (a b) (+ a b)) 2 3)"), num(5));
});

test("evaluates a lambda with no parameters", () => {
  assert.deepEqual(run("((lambda () 7))"), num(7));
});

test("lets a lambda close over an outer binding", () => {
  assert.deepEqual(run("(let ((n 10)) ((lambda (x) (+ x n)) 5))"), num(15));
});

test("rejects a lambda without an argument list", () => {
  assert.throws(() => run("(lambda 1)"));
});

test("calls a function by name through a function quote", () => {
  assert.deepEqual(run("(progn (defun f (x) x) (funcall #'f 3))"), num(3));
});

test("calls a lambda through a function quote", () => {
  assert.deepEqual(run("(funcall #'(lambda (x) (* x 2)) 4)"), num(8));
});

test("converts a function quote to the data (FUNCTION F)", () => {
  assert.deepEqual(
    astToValue(parse("#'f")),
    cons(intern("FUNCTION"), cons(intern("F"), NIL)),
  );
});

test("calls a labels definition", () => {
  assert.deepEqual(run("(labels ((f (x) (+ x 1))) (f 2))"), num(3));
});

test("lets labels definitions call each other", () => {
  assert.deepEqual(
    run(
      "(labels ((ev (n) (if (= n 0) t (od (- n 1)))) (od (n) (if (= n 0) nil (ev (- n 1))))) (ev 4))",
    ),
    intern("T"),
  );
});

test("lets a labels definition close over an outer binding", () => {
  assert.deepEqual(run("(let ((k 2)) (labels ((f (x) (* x k))) (f 3)))"), num(6));
});

test("does not leak labels definitions", () => {
  assert.throws(() => run("(progn (labels ((f (x) x)) (f 1)) (f 1))"));
});

test("lets a labels definition shadow a builtin", () => {
  assert.deepEqual(run("(labels ((length (x) 0)) (length (list 1 2)))"), num(0));
});

test("rejects a malformed labels form", () => {
  assert.throws(() => run("(labels 1 2)"));
});

test("calls an flet definition", () => {
  assert.deepEqual(run("(flet ((f (x) (+ x 1))) (f 2))"), num(3));
});

test("lets an flet definition close over an outer binding", () => {
  assert.deepEqual(run("(let ((k 3)) (flet ((f (x) (* x k))) (f 2)))"), num(6));
});

test("does not let an flet definition call itself", () => {
  assert.throws(() => run("(flet ((g (n) (if (= n 0) 0 (g (- n 1))))) (g 2))"));
});

test("does not leak flet definitions", () => {
  assert.throws(() => run("(progn (flet ((f (x) x)) (f 1)) (f 1))"));
});

test("calls a function through the function special form", () => {
  assert.deepEqual(run("(progn (defun f (x) x) (funcall (function f) 3))"), num(3));
});

test("evaluates a lambda inside the function special form", () => {
  assert.deepEqual(
    run("(funcall (function (lambda (x) (* x 2))) 5)"),
    num(10),
  );
});

test("rejects a function form with nothing in it", () => {
  assert.throws(() => run("(function)"));
});

function budgetCode(run: () => void): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (error instanceof LispEvalError) return error.code;
    throw error;
  }
}

test("stops evaluation at a ceiling set for the pass", () => {
  assert.equal(
    budgetCode(() =>
      withStepCeiling(3, () =>
        evaluate(parse("(+ 1 (+ 2 3))"), createEnv(null)),
      ),
    ),
    "evaluation-budget",
  );
});

test("starts counting from zero for each pass", () => {
  const first = budgetCode(() =>
    withStepCeiling(3, () => evaluate(parse("(+ 1 (+ 2 3))"), createEnv(null))),
  );
  const second = budgetCode(() =>
    withStepCeiling(3, () => evaluate(parse("(+ 1 (+ 2 3))"), createEnv(null))),
  );

  assert.equal(first, "evaluation-budget");
  assert.equal(second, "evaluation-budget");
});

test("restores the backstop after a pass finishes", () => {
  withStepCeiling(3, () => evaluate(parse("1"), createEnv(null)));

  assert.equal(
    budgetCode(() => evaluate(parse("(+ 1 (+ 2 3))"), createEnv(null))),
    undefined,
  );
});

test("restores the backstop after a pass throws", () => {
  budgetCode(() =>
    withStepCeiling(3, () => evaluate(parse("(+ 1 (+ 2 3))"), createEnv(null))),
  );

  assert.equal(
    budgetCode(() => evaluate(parse("(+ 1 (+ 2 3))"), createEnv(null))),
    undefined,
  );
});

test("refuses a second ceiling while one is open", () => {
  assert.throws(
    () => withStepCeiling(5, () => withStepCeiling(5, () => undefined)),
    /already open/,
  );
});

test("rejects a ceiling outside one to the backstop", () => {
  assert.throws(() => withStepCeiling(0, () => undefined), RangeError);
  assert.throws(() => withStepCeiling(-1, () => undefined), RangeError);
  assert.throws(() => withStepCeiling(1.5, () => undefined), RangeError);
  assert.throws(() => withStepCeiling(Number.NaN, () => undefined), RangeError);
  assert.throws(
    () => withStepCeiling(HARD_STEP_CEILING + 1, () => undefined),
    RangeError,
  );
});

test("dispatches every name it lists as a special form", () => {
  for (const name of SPECIAL_FORMS) {
    let code: string | undefined;

    try {
      // (LOOP) does not terminate, and the point here is dispatch, not
      // termination — so every name runs under a small ceiling.
      withStepCeiling(1_000, () =>
        evaluate(parse(`(${name})`), createEnv(null)),
      );
    } catch (error) {
      if (error instanceof ReturnSignal) continue;
      if (error instanceof LispEvalError) code = error.code;
      else if (error instanceof RangeError) code = "stack";
      else throw error;
    }

    assert.notEqual(code, "undefined-function", `${name} must be special`);
  }
});

test("reports a place form with no place as malformed", () => {
  assert.equal(budgetCode(() => run("(incf)")), "malformed-form");
  assert.equal(budgetCode(() => run("(decf)")), "malformed-form");
  assert.equal(budgetCode(() => run("(pop)")), "malformed-form");
});

test("divides before flooring when floor takes two arguments", () => {
  assert.deepEqual(run("(floor 14 5)"), num(2));
});

test("takes the second element of a list", () => {
  assert.deepEqual(run("(second '(1 2 3))"), num(2));
});

test("leaves a dotimes counter bound for the result form", () => {
  assert.deepEqual(run("(dotimes (i 3 i))"), num(3));
});

test("binds a dolist variable to NIL for the result form", () => {
  assert.deepEqual(run("(dolist (x (list 1 2) (list x)) nil)"), cons(NIL, NIL));
  assert.deepEqual(run("(dolist (x (list 1 2) x) nil)"), NIL);
});

//LLM-written tests for the character type and the evaluator-gap slice
function char(value: string): LispValue {
  return { kind: "char", value };
}

function evalIn(source: string): LispValue {
  const env = createEnv(null);
  let result: LispValue = NIL;
  for (const form of parseAll(source)) result = evaluate(form, env);
  return result;
}

test("evaluates a character literal", () => {
  assert.deepEqual(evalIn("#\\a"), char("a"));
});

test("quotes a character literal as itself", () => {
  assert.deepEqual(evalIn("'#\\a"), char("a"));
});

test("compares characters by value and by case", () => {
  assert.deepEqual(evalIn("(equal #\\a #\\a)"), intern("T"));
  assert.deepEqual(evalIn("(equal #\\a #\\A)"), NIL);
});

test("does not confuse a character with a string", () => {
  assert.deepEqual(evalIn('(equal #\\a "a")'), NIL);
  assert.deepEqual(evalIn('(eq #\\a "a")'), NIL);
});

test("treats a character as an atom", () => {
  assert.deepEqual(evalIn("(atom #\\a)"), intern("T"));
  assert.deepEqual(evalIn("(typep #\\a 'character)"), intern("T"));
  assert.deepEqual(evalIn("(typep #\\a 'string)"), NIL);
});

test("compares characters with and without case", () => {
  assert.deepEqual(evalIn("(char-equal #\\a #\\A)"), intern("T"));
  assert.ok(isNil(evalIn("(char-equal #\\a #\\b)")));
  assert.deepEqual(evalIn("(char-lessp #\\a #\\B)"), intern("T"));
  assert.deepEqual(evalIn("(char-greaterp #\\b #\\A)"), intern("T"));
  assert.deepEqual(evalIn("(char< #\\a #\\b)"), intern("T"));
  assert.deepEqual(evalIn("(char> #\\b #\\a)"), intern("T"));
  // Uppercase sorts before lowercase, so CHAR< is case-sensitive where the
  // ...-LESSP family is not.
  assert.deepEqual(evalIn("(char< #\\A #\\a)"), intern("T"));
  assert.ok(isNil(evalIn("(char-lessp #\\A #\\a)")));
  // CL's character comparisons are variadic and answer T for fewer than two.
  assert.deepEqual(evalIn("(char= #\\a)"), intern("T"));
  assert.deepEqual(evalIn("(char= #\\a #\\a #\\a)"), intern("T"));
  assert.ok(isNil(evalIn("(char= #\\a #\\a #\\b)")));
  assert.deepEqual(evalIn("(char< #\\a #\\b #\\c)"), intern("T"));
  assert.ok(isNil(evalIn("(char< #\\a #\\c #\\b)")));
  assert.deepEqual(evalIn("(char-lessp #\\a #\\B #\\c)"), intern("T"));
  assert.deepEqual(evalIn("(char=)"), intern("T"));
});

test("recognises a real and a string", () => {
  assert.deepEqual(evalIn("(realp 1)"), intern("T"));
  assert.deepEqual(evalIn("(realp 1.5)"), intern("T"));
  assert.ok(isNil(evalIn('(realp "x")')));
  assert.deepEqual(evalIn('(stringp "x")'), intern("T"));
  assert.ok(isNil(evalIn("(stringp 1)")));
});

test("counts a proper list and refuses a dotted one", () => {
  assert.deepEqual(evalIn("(list-length '(1 2 3))"), num(3));
  assert.deepEqual(evalIn("(list-length '())"), num(0));
  assert.throws(() => evalIn("(list-length '(1 2 . 3))"), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "type-error";
  });
});

test("answers NIL for a circular list's length", () => {
  assert.deepEqual(
    evalIn("(let ((x (list 1 2))) (setf (cdr (cdr x)) x) (list-length x))"),
    NIL,
  );
});

test("answers the hash table's test", () => {
  assert.deepEqual(evalIn("(hash-table-test (make-hash-table))"), intern("EQL"));
  assert.deepEqual(
    evalIn("(hash-table-test (make-hash-table :test #'equal))"),
    intern("EQUAL"),
  );
});

test("adds and subtracts one", () => {
  assert.deepEqual(evalIn("(1+ 41)"), num(42));
  assert.deepEqual(evalIn("(1- 41)"), num(40));
});

test("takes the largest and smallest", () => {
  assert.deepEqual(evalIn("(max 3 9 5)"), num(9));
  assert.deepEqual(evalIn("(min 3 9 5)"), num(3));
  assert.deepEqual(evalIn("(max 7)"), num(7));
});

test("counts matches in a list and in a vector", () => {
  assert.deepEqual(evalIn("(count 3 '(1 3 2 3))"), num(2));
  assert.deepEqual(evalIn("(count 3 #(3 3))"), num(2));
  // COUNT defaults to EQL, as CL does: two equal but distinct lists do not match.
  assert.deepEqual(evalIn("(count '(1) (list '(1) '(2)))"), num(0));
});

test("counts with :test and :key", () => {
  assert.deepEqual(evalIn("(count '(1) (list '(1) '(2)) :test #'equal)"), num(1));
  assert.deepEqual(evalIn("(count 2 '((1) (2) (2)) :key #'car)"), num(2));
  assert.deepEqual(evalIn('(count #\\a "banana")'), num(3));
});

test("sorts with :key", () => {
  assert.equal(
    printValueOf("(sort '((3 c) (1 a) (2 b)) #'< :key #'car)"),
    "((1 A) (2 B) (3 C))",
  );
});

test("drops the last element, or the last n", () => {
  assert.deepEqual(printValueOf("(butlast '(1 2 3 4))"), "(1 2 3)");
  assert.deepEqual(printValueOf("(butlast '(1 2 3 4) 2)"), "(1 2)");
  assert.deepEqual(printValueOf("(butlast '(1))"), "NIL");
  assert.deepEqual(printValueOf("(butlast '(1) 5)"), "NIL");
});

test("reads a character out of a string", () => {
  assert.deepEqual(evalIn('(schar "banana" 0)'), char("b"));
  assert.deepEqual(evalIn('(char "banana" 5)'), char("a"));
});

test("rejects an index outside the string", () => {
  assert.throws(() => evalIn('(schar "banana" 6)'), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "index-error";
  });
  assert.throws(() => evalIn('(char "banana" -1)'), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "index-error";
  });
});

test("rejects a non-character where one is needed", () => {
  assert.throws(() => evalIn('(char= "a" #\\a)'), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "type-error";
  });
});

test("compares and upcases characters", () => {
  assert.deepEqual(evalIn("(char= #\\a #\\a)"), intern("T"));
  assert.deepEqual(evalIn("(char= #\\a #\\A)"), NIL);
  assert.deepEqual(evalIn("(char-upcase #\\a)"), char("A"));
  assert.deepEqual(evalIn("(char-upcase #\\A)"), char("A"));
});

test("signals the learner's own error with its message", () => {
  assert.throws(
    () => evalIn('(error "Backing array is full.")'),
    (error: unknown) => {
      return (
        error instanceof LispEvalError &&
        error.code === "signalled-error" &&
        error.message === "Backing array is full."
      );
    },
  );
});

test("appends extra error arguments to the message", () => {
  assert.throws(
    () => evalIn('(error "Tried to remove" (quote x))'),
    (error: unknown) => {
      return error instanceof LispEvalError && error.message === "Tried to remove X";
    },
  );
});

test("answers a plain type specifier", () => {
  assert.deepEqual(evalIn("(typep 3 'integer)"), intern("T"));
  assert.deepEqual(evalIn("(typep 3.5 'integer)"), NIL);
  assert.deepEqual(evalIn('(typep "s" \'string)'), intern("T"));
  assert.deepEqual(evalIn("(typep nil 'null)"), intern("T"));
  assert.deepEqual(evalIn("(typep nil 'symbol)"), intern("T"));
  assert.deepEqual(evalIn("(typep nil 'list)"), intern("T"));
  assert.deepEqual(evalIn("(typep nil 'cons)"), NIL);
  assert.deepEqual(evalIn("(typep '(1) 'cons)"), intern("T"));
  assert.deepEqual(evalIn("(typep 5 'atom)"), intern("T"));
  assert.deepEqual(evalIn("(typep 5 't)"), intern("T"));
});

test("refuses a type specifier it does not model", () => {
  assert.throws(() => evalIn("(typep 3 '(satisfies evenp))"), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "unsupported-standard";
  });
  assert.throws(() => evalIn("(typep 3 'tree-node)"), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "unsupported-standard";
  });
});

test("answers a compound type specifier", () => {
  assert.deepEqual(evalIn("(typep 1 '(or integer string))"), intern("T"));
  assert.deepEqual(evalIn("(typep \"s\" '(or integer string))"), intern("T"));
  assert.ok(isNil(evalIn("(typep #\\a '(or integer string))")));
  assert.deepEqual(evalIn("(typep 5 '(and integer (integer 0 10)))"), intern("T"));
  assert.ok(isNil(evalIn("(typep 50 '(and integer (integer 0 10)))")));
  assert.deepEqual(evalIn("(typep 5 '(not string))"), intern("T"));
  assert.deepEqual(evalIn("(typep 2 '(member 1 2 3))"), intern("T"));
  assert.ok(isNil(evalIn("(typep 9 '(member 1 2 3))")));
  assert.deepEqual(evalIn("(typep 2 '(eql 2))"), intern("T"));
  assert.deepEqual(evalIn("(typep 3 '(mod 10))"), intern("T"));
  assert.ok(isNil(evalIn("(typep 13 '(mod 10))")));
  assert.deepEqual(evalIn("(typep 3 '(integer * 10))"), intern("T"));
  assert.ok(isNil(evalIn("(typep 30 '(integer * 10))")));
});

test("checks the elements a cons and a vector specifier name", () => {
  assert.deepEqual(evalIn("(typep '(1 2) '(cons integer))"), intern("T"));
  assert.deepEqual(evalIn("(typep '(1 . 2) '(cons integer integer))"), intern("T"));
  // (cons integer) constrains only the car; the cdr is any type.
  assert.ok(isNil(evalIn("(typep '(\"a\" 1) '(cons integer))")));
  assert.deepEqual(evalIn("(typep #(1 2) '(vector integer))"), intern("T"));
  assert.ok(isNil(evalIn("(typep #(1 \"a\") '(vector integer))")));
});

test("runs do to its end test", () => {
  assert.deepEqual(evalIn("(do ((i 0 (+ i 1))) ((= i 3) i))"), num(3));
});

test("evaluates do steps against the old bindings", () => {
  assert.equal(
    printValueOf("(do ((i 0 (+ i 1)) (acc nil (cons i acc))) ((= i 3) acc))"),
    "(2 1 0)",
  );
});

test("binds do* as it goes", () => {
  // DO* lets a later initial form see an earlier binding; DO evaluates every
  // initial form in the enclosing environment, where i has no value at all.
  assert.deepEqual(evalIn("(do* ((i 5) (j i)) ((= i 5) j))"), num(5));
  assert.throws(() => evalIn("(do ((i 5) (j i)) ((= i 5) j))"), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "unbound-variable";
  });
});

test("leaves do when the body returns", () => {
  assert.deepEqual(
    evalIn("(do ((i 0 (+ i 1))) ((= i 5) i) (when (= i 2) (return 42)))"),
    num(42),
  );
});

// A DO with no end-test clause used to spin forever: nothing was evaluated per
// pass, so the step budget never advanced and could not stop it. Every probe
// here runs under a small ceiling, so a regression fails fast (as an
// evaluation-budget error the assertion rejects) instead of hanging the suite.
test("rejects a do with no end-test clause", () => {
  assert.throws(
    () => withStepCeiling(1000, () => evalIn("(do ((i 0)))")),
    (error: unknown) => {
      return error instanceof LispEvalError && error.code === "malformed-form";
    },
  );
});

test("rejects a do whose end-test clause is empty", () => {
  assert.throws(
    () => withStepCeiling(1000, () => evalIn("(do ((i 0 (+ i 1))) ())")),
    (error: unknown) => {
      return error instanceof LispEvalError && error.code === "malformed-form";
    },
  );
});

test("rejects a do whose end-test clause is not a list", () => {
  assert.throws(() => evalIn("(do ((i 0)) i)"), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "malformed-form";
  });
});

test("stops a do whose end test never holds", () => {
  assert.throws(
    () => withStepCeiling(1000, () => evalIn("(do ((i 0 (+ i 1))) ((= i -1) i))")),
    (error: unknown) => {
      return error instanceof LispEvalError && error.code === "evaluation-budget";
    },
  );
});

test("charges the budget for a dotimes pass with no body", () => {
  assert.throws(
    () => withStepCeiling(100, () => evalIn("(dotimes (i 1000000))")),
    (error: unknown) => {
      return error instanceof LispEvalError && error.code === "evaluation-budget";
    },
  );
});

test("charges the budget for a dolist pass with no body", () => {
  assert.throws(
    () =>
      withStepCeiling(10, () =>
        evalIn("(dolist (x (list 1 2 3 4 5 6 7 8 9 10 11 12)))"),
      ),
    (error: unknown) => {
      return error instanceof LispEvalError && error.code === "evaluation-budget";
    },
  );
});

test("rejects a malformed do", () => {
  assert.throws(() => evalIn("(do)"), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "malformed-form";
  });
  assert.throws(() => evalIn("(do 5 ((= 1 1)) 1)"), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "malformed-form";
  });
});

test("matches a case clause, the default, and a key list", () => {
  assert.deepEqual(evalIn("(case 2 (1 'one) (2 'two) (otherwise 'other))"), intern("TWO"));
  assert.deepEqual(evalIn("(case 9 (1 'one) (otherwise 'other))"), intern("OTHER"));
  assert.deepEqual(evalIn("(case 'b ((a b) 'hit) (t 'miss))"), intern("HIT"));
  assert.deepEqual(evalIn("(case 9 (1 'one))"), NIL);
});

test("signals from ecase and ccase when nothing matches", () => {
  assert.throws(() => evalIn("(ecase 9 (1 'one))"), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "signalled-error";
  });
  assert.throws(() => evalIn("(ccase 9 (1 'one))"), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "signalled-error";
  });
  assert.deepEqual(evalIn("(ccase 1 (1 'one))"), intern("ONE"));
});

test("lists do and the case family as special forms", () => {
  for (const name of ["DO", "DO*", "CASE", "ECASE", "CCASE"]) {
    assert.ok(SPECIAL_FORMS.has(name), `${name} should be a special form`);
  }
});

// A name Lispnt knows but does not implement must stay silent. Calling one used
// to answer "undefined function" for names the sweep found missing from the
// list, which blames the learner for our gap; these two tests keep that from
// creeping back in either direction.
test("answers every unimplemented standard name with unsupported-standard", () => {
  for (const name of STANDARD_SYMBOLS) {
    assert.throws(
      () => run(`(${name})`),
      (error: unknown) =>
        error instanceof LispEvalError && error.code === "unsupported-standard",
      `${name} should be a silent unsupported-standard gap`,
    );
  }
});

test("keeps implemented names off the silent list", () => {
  for (const name of builtins.keys()) {
    assert.equal(
      STANDARD_SYMBOLS.has(name),
      false,
      `${name} is implemented and must not be on the silent list`,
    );
  }
  for (const name of SPECIAL_FORMS) {
    assert.equal(
      STANDARD_SYMBOLS.has(name),
      false,
      `${name} is a special form and must not be on the silent list`,
    );
  }
});

//LLM-written tests for defstruct

test("defines a structure with defaults and a keyword constructor", () => {
  assert.equal(
    printValueOf("(defstruct point x (y 5)) (make-point :x 1)"),
    "#S(POINT :X 1 :Y 5)",
  );
  assert.equal(printValueOf("(defstruct point x (y 5)) (make-point)"), "#S(POINT :X NIL :Y 5)");
});

test("returns the structure name from defstruct", () => {
  assert.deepEqual(evalIn("(defstruct point x)"), intern("POINT"));
});

test("reads a slot through its accessor", () => {
  assert.deepEqual(
    evalIn("(defstruct point x y) (point-x (make-point :x 1 :y 2))"),
    num(1),
  );
});

test("applies :conc-name nil so accessors are the bare slot names", () => {
  const source = [
    "(defstruct (tree-node (:conc-name nil)) key (lc nil) (rc nil))",
    "(key (make-tree-node :key 10))",
  ].join(" ");
  assert.deepEqual(evalIn(source), num(10));
});

test("keeps the conc-name prefix by default", () => {
  assert.deepEqual(
    evalIn('(defstruct book title) (book-title (make-book :title "Dune"))'),
    { kind: "string", value: "Dune" },
  );
});

test("assigns to a slot through the accessor place", () => {
  const source = "(defstruct point x) (setf p (make-point :x 1)) (setf (point-x p) 9) (point-x p)";
  assert.deepEqual(evalIn(source), num(9));
});

test("assigns to a slot under a conc-name", () => {
  const source = "(defstruct node v) (setf n (make-node :v 1)) (setf (node-v n) 2) (node-v n)";
  assert.deepEqual(evalIn(source), num(2));
});

test("rejects an accessor place on the wrong structure type", () => {
  const source = "(defstruct a x) (defstruct b y) (setf (a-x (make-b :y 1)) 5)";
  assert.throws(() => evalIn(source), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "type-error";
  });
});

test("answers the predicate for its own type only", () => {
  const source = "(defstruct a x) (defstruct b y) (list (a-p (make-a)) (b-p (make-a)))";
  assert.equal(printValueOf(source), "(T NIL)");
});

test("copies a structure shallowly", () => {
  const source = [
    "(defstruct point x)",
    "(setf p (make-point :x 1))",
    "(setf q (copy-point p))",
    "(setf (point-x q) 2)",
    "(list (eq p q) (point-x p) (point-x q))",
  ].join(" ");
  assert.equal(printValueOf(source), "(NIL 1 2)");
});

test("compares structures by identity", () => {
  assert.deepEqual(
    evalIn("(defstruct point x) (equal (make-point :x 1) (make-point :x 1))"),
    NIL,
  );
});

test("answers typep for a defined structure type", () => {
  const source = "(defstruct point x) (typep (make-point) 'point)";
  assert.deepEqual(evalIn(source), intern("T"));
  const other = "(defstruct point x) (defstruct other y) (typep (make-other) 'point)";
  assert.deepEqual(evalIn(other), NIL);
  const no = "(defstruct point x) (typep 5 'point)";
  assert.deepEqual(evalIn(no), NIL);
});

test("still refuses a type name nothing defines", () => {
  assert.throws(() => evalIn("(typep 5 'nothing-defined)"), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "unsupported-standard";
  });
});

test("rejects a keyword that names no slot", () => {
  assert.throws(
    () => evalIn("(defstruct point x) (make-point :z 1)"),
    (error: unknown) => {
      return error instanceof LispEvalError && error.code === "type-error";
    },
  );
});

test("rejects an odd number of constructor arguments", () => {
  assert.throws(
    () => evalIn("(defstruct point x) (make-point :x)"),
    (error: unknown) => {
      return error instanceof LispEvalError && error.code === "malformed-form";
    },
  );
});

test("refuses defstruct options it does not model", () => {
  const cases = [
    "(defstruct (a (:include b)) x)",
    "(defstruct a (x 1 :type integer))",
  ];
  for (const source of cases) {
    assert.throws(() => evalIn(source), (error: unknown) => {
      return error instanceof LispEvalError && error.code === "unsupported-standard";
    }, source);
  }
});

test("prints a structure with no slots", () => {
  assert.equal(printValueOf("(defstruct empty) (make-empty)"), "#S(EMPTY)");
});

test("prints a structure nested in a list", () => {
  const source = "(defstruct point x) (list (make-point :x 1))";
  assert.equal(printValueOf(source), "(#S(POINT :X 1))");
});

test("prints a structure that points at itself without looping", () => {
  const source = [
    "(defstruct node next)",
    "(setf n (make-node))",
    "(setf (node-next n) n)",
    "n",
  ].join(" ");
  assert.equal(printValueOf(source), "#S(NODE :NEXT ...)");
});

test("traces a recursive function over structures", () => {
  const source = [
    "(defstruct (tree-node (:conc-name nil)) key (lc nil) (rc nil))",
    "(defun height (n) (if (null n) 0 (+ 1 (max (height (lc n)) (height (rc n))))))",
    "(height (make-tree-node :key 1 :lc (make-tree-node :key 2)))",
  ].join(" ");
  assert.deepEqual(evalIn(source), num(2));
});

test("lists defstruct as a special form", () => {
  assert.ok(SPECIAL_FORMS.has("DEFSTRUCT"));
});





//LLM-written tests for LOOP
test("collects over a list", () => {
  assert.equal(printValueOf("(loop for x in '(1 2 3) collect x)"), "(1 2 3)");
});

test("sums, counts, maximizes and minimizes", () => {
  assert.deepEqual(evalIn("(loop for x in '(1 2 3) sum x)"), num(6));
  assert.deepEqual(evalIn("(loop for x in '(1 2 3) count x)"), num(3));
  assert.deepEqual(evalIn("(loop for x in '(1 5 3) maximize x)"), num(5));
  assert.deepEqual(evalIn("(loop for x in '(1 5 3) minimize x)"), num(1));
});

test("returns NIL from maximize over nothing", () => {
  assert.deepEqual(evalIn("(loop for x in '() maximize x)"), NIL);
});

test("appends lists in order", () => {
  assert.equal(
    printValueOf("(loop for x in '(1 2 3) append (list x x))"),
    "(1 1 2 2 3 3)",
  );
});

test("counts ranges with from, to, below, above and by", () => {
  assert.equal(printValueOf("(loop for i from 0 below 3 collect i)"), "(0 1 2)");
  assert.equal(printValueOf("(loop for i from 10 to 12 collect i)"), "(10 11 12)");
  assert.equal(printValueOf("(loop for i from 0 below 10 by 3 collect i)"), "(0 3 6 9)");
  assert.equal(printValueOf("(loop for i from 3 above 0 by -1 collect i)"), "(3 2 1 0)");
  assert.equal(printValueOf("(loop for i below 3 collect i)"), "(0 1 2)");
});

test("walks tails with on", () => {
  assert.equal(printValueOf("(loop for x on '(1 2) collect x)"), "((1 2) (2))");
});

test("walks a vector and a string with across", () => {
  assert.equal(printValueOf("(loop for x across #(4 5) collect x)"), "(4 5)");
  assert.equal(printValueOf('(loop for c across "ab" collect c)'), "(#\\a #\\b)");
});

test("steps a driver with a function supplied to by", () => {
  assert.equal(
    printValueOf("(loop for x in '(1 2 3) by (lambda (l) nil) collect x)"),
    "(1)",
  );
});

test("stops on while and until", () => {
  assert.equal(
    printValueOf("(loop for i from 0 below 5 while (< i 3) collect i)"),
    "(0 1 2)",
  );
  assert.equal(
    printValueOf("(loop for x in '(1 2 3) until (= x 2) collect x)"),
    "(1)",
  );
});

test("runs a body a fixed number of times with repeat", () => {
  assert.deepEqual(evalIn("(loop repeat 3 sum 2)"), num(6));
});

test("runs do forms and returns the loop's NIL", () => {
  assert.deepEqual(
    evalIn("(let ((n 0)) (loop for i from 0 below 3 do (setf n (+ n i)) finally (return n)))"),
    num(3),
  );
});

test("runs initially once and finally at the end", () => {
  assert.equal(
    printValueOf(
      "(let ((seen '())) (loop repeat 2 initially (push 'start seen) do (push 'body seen) finally (return (reverse seen))))",
    ),
    "(START BODY BODY)",
  );
});

test("leaves the loop on return and skips finally", () => {
  assert.deepEqual(
    evalIn("(loop for i from 0 below 3 do (if (= i 1) (return i)) finally (return 'no))"),
    num(1),
  );
});

test("keeps an into accumulator for finally", () => {
  assert.deepEqual(
    evalIn("(loop for i from 0 below 3 sum i into total finally (return (* total 2)))"),
    num(6),
  );
  assert.deepEqual(
    evalIn("(loop for i from 0 below 3 count t into n finally (return n))"),
    num(3),
  );
});

test("filters with when and unless", () => {
  assert.equal(
    printValueOf("(loop for x in '(1 2 3 4) when (evenp x) collect x)"),
    "(2 4)",
  );
  assert.equal(
    printValueOf("(loop for x in '(1 2 3 4) unless (evenp x) collect x)"),
    "(1 3)",
  );
});

test("pairs then and else around end", () => {
  assert.equal(
    printValueOf(
      "(loop for x in '(1 2 3) if (oddp x) collect x else collect (* x 10) end collect 'tail)",
    ),
    "(1 TAIL 20 TAIL 3 TAIL)",
  );
});

test("shares one implicit list between two collect clauses", () => {
  assert.equal(printValueOf("(loop for x in '(1 2) collect x collect x)"), "(1 1 2 2)");
});

test("refuses two different implicit accumulation kinds", () => {
  assert.throws(
    () => evalIn("(loop for x in '(1 2) if (oddp x) collect x else sum x)"),
    (error: unknown) => {
      return error instanceof LispEvalError && error.code === "malformed-form";
    },
  );
});

test("runs the simple form until a return", () => {
  assert.deepEqual(evalIn("(loop (+ 1 2) (return 5))"), num(5));
});

test("stops a simple loop that never returns at the budget", () => {
  assert.throws(
    () => withStepCeiling(1000, () => evalIn("(loop (+ 1 2))")),
    (error: unknown) => {
      return error instanceof LispEvalError && error.code === "evaluation-budget";
    },
  );
});

test("fails loudly on a clause it does not model", () => {
  for (const source of [
    "(loop named out for x in '(1) collect x)",
    "(loop for x in '(1) with y = 1 collect y)",
    "(loop for x in '(1) thereis x)",
    "(loop for x in '(1) nconc (list x))",
    "(loop for x in '(1) always x)",
  ]) {
    assert.throws(() => evalIn(source), (error: unknown) => {
      return error instanceof LispEvalError && error.code === "unsupported-standard";
    }, source);
  }
});

test("rejects a malformed driver", () => {
  for (const source of ["(loop for)", "(loop for 5 in '(1) collect 5)"]) {
    assert.throws(() => evalIn(source), (error: unknown) => {
      return error instanceof LispEvalError && error.code === "malformed-form";
    }, source);
  }
});

test("lists loop as a special form", () => {
  assert.ok(SPECIAL_FORMS.has("LOOP"));
});



test("stops a bare simple loop at the budget", () => {
  assert.throws(
    () => withStepCeiling(1000, () => evalIn("(loop)")),
    (error: unknown) => {
      return error instanceof LispEvalError && error.code === "evaluation-budget";
    },
  );
});

test("stops an unbounded driver with no body at the budget", () => {
  assert.throws(
    () => withStepCeiling(1000, () => evalIn("(loop for i from 0)")),
    (error: unknown) => {
      return error instanceof LispEvalError && error.code === "evaluation-budget";
    },
  );
});

test("rejects a driver inside a conditional clause", () => {
  // SBCL: "FOR does not introduce a LOOP clause that can follow WHEN".
  assert.throws(
    () => evalIn("(loop for x in '(1 2) when t for y in '(3 4) collect y)"),
    (error: unknown) => {
      return error instanceof LispEvalError && error.code === "malformed-form";
    },
  );
});

test("steps two top-level drivers in parallel", () => {
  assert.equal(
    printValueOf("(loop for x in '(1 2) for y in '(3 4) collect (list x y))"),
    "((1 3) (2 4))",
  );
});

test("a budget error outside a pass does not disable later evaluation", () => {
  // The counter is module-level. Before it was scoped to the outermost
  // evaluation, this throw left it above the ceiling and every later
  // evaluate() in the process failed.
  assert.throws(
    () => evalIn("(dotimes (i 100000000) 1)"),
    (error: unknown) => {
      return error instanceof LispEvalError && error.code === "evaluation-budget";
    },
  );

  assert.deepEqual(evalIn("(+ 1 2)"), num(3));
});

test("returns NIL from car and cdr of NIL", () => {
  assert.deepEqual(evalIn("(car nil)"), NIL);
  assert.deepEqual(evalIn("(cdr nil)"), NIL);
  assert.deepEqual(evalIn("(first nil)"), NIL);
  assert.deepEqual(evalIn("(rest nil)"), NIL);
  assert.deepEqual(evalIn("(second '(1))"), NIL);
  assert.deepEqual(evalIn("(cadr '(1))"), NIL);
  assert.deepEqual(evalIn("(caddr '(1 2))"), NIL);
});

test("still rejects car of something that is not a list", () => {
  assert.throws(() => evalIn("(car 1)"), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "type-error";
  });
});

test("requires compound forms after do and initially", () => {
  for (const source of ["(loop do 1)", "(loop initially 1)", "(loop finally 1)"]) {
    assert.throws(() => evalIn(source), (error: unknown) => {
      return error instanceof LispEvalError && error.code === "malformed-form";
    }, source);
  }
});

test("requires a driver before the loop body", () => {
  assert.throws(
    () => evalIn("(loop do (return 1) for x in '(1 2) collect x)"),
    (error: unknown) => {
      return error instanceof LispEvalError && error.code === "malformed-form";
    },
  );
});

test("allows a driver after initially", () => {
  assert.equal(
    printValueOf("(loop initially (setf z 1) for x in '(1 2) collect x)"),
    "(1 2)",
  );
});

//LLM-written tests for hash tables
test("stores and reads a hash entry", () => {
  assert.deepEqual(
    evalIn("(setf h (make-hash-table)) (setf (gethash 'a h) 1) (gethash 'a h)"),
    num(1),
  );
});

test("returns NIL or a supplied default for an absent key", () => {
  assert.deepEqual(evalIn("(setf h (make-hash-table)) (gethash 'a h)"), NIL);
  assert.deepEqual(
    evalIn("(setf h (make-hash-table)) (gethash 'a h 'missing)"),
    intern("MISSING"),
  );
});

test("counts, removes and clears entries", () => {
  assert.deepEqual(
    evalIn("(setf h (make-hash-table)) (setf (gethash 'a h) 1) (setf (gethash 'b h) 2) (hash-table-count h)"),
    num(2),
  );
  assert.deepEqual(
    evalIn("(setf h (make-hash-table)) (setf (gethash 'a h) 1) (remhash 'a h) (hash-table-count h)"),
    num(0),
  );
  assert.deepEqual(
    evalIn("(setf h (make-hash-table)) (setf (gethash 'a h) 1) (clrhash h) (hash-table-count h)"),
    num(0),
  );
});

test("answers hash-table-p and typep", () => {
  assert.deepEqual(evalIn("(hash-table-p (make-hash-table))"), intern("T"));
  assert.deepEqual(evalIn("(hash-table-p 1)"), NIL);
  assert.deepEqual(evalIn("(typep (make-hash-table) 'hash-table)"), intern("T"));
  assert.deepEqual(evalIn("(typep 1 'hash-table)"), NIL);
});

test("compares keys structurally under equal and by identity under eq", () => {
  const equal = [
    "(setf h (make-hash-table :test #'equal))",
    "(setf (gethash '(1 2) h) 'found)",
    "(gethash (list 1 2) h)",
  ].join(" ");
  assert.deepEqual(evalIn(equal), intern("FOUND"));

  const identity = [
    "(setf h (make-hash-table :test #'eq))",
    "(setf (gethash (list 1 2) h) 'found)",
    "(gethash (list 1 2) h)",
  ].join(" ");
  assert.deepEqual(evalIn(identity), NIL);
});

test("matches string keys by value", () => {
  assert.deepEqual(
    evalIn('(setf h (make-hash-table)) (setf (gethash "k" h) 1) (gethash "k" h)'),
    num(1),
  );
  // A default (eql) table is case-sensitive...
  assert.deepEqual(
    evalIn('(setf h (make-hash-table)) (setf (gethash "k" h) 1) (gethash "K" h)'),
    NIL,
  );
  // ...and an equalp table folds case, in atoms and inside lists and vectors.
  assert.deepEqual(
    evalIn(
      '(setf h (make-hash-table :test (quote equalp))) (setf (gethash "abc" h) 1) (gethash "ABC" h)',
    ),
    num(1),
  );
  assert.deepEqual(
    evalIn(
      '(setf h (make-hash-table :test (quote equalp))) (setf (gethash (list 1 "abc") h) 1) (gethash (list 1 "ABC") h)',
    ),
    num(1),
  );
  assert.deepEqual(
    evalIn(
      '(setf h (make-hash-table :test (quote equalp))) (setf (gethash (vector 1 2) h) 1) (gethash (vector 1 2) h)',
    ),
    num(1),
  );
});

test("canonicalises a cyclic equalp key by identity instead of looping", () => {
  const source = [
    "(let ((key (list 1)))",
    "  (setf (cdr key) key)",
    "  (let ((h (make-hash-table :test (quote equalp))))",
    "    (setf (gethash key h) 'found)",
    "    (gethash key h)))",
  ].join(" ");
  assert.deepEqual(evalIn(source), intern("FOUND"));
});

test("accepts :size and the rehash hints as layout hints", () => {
  assert.deepEqual(
    evalIn(
      "(setf h (make-hash-table :size 10 :rehash-size 2 :rehash-threshold 0.5)) (setf (gethash 'a h) 1) (hash-table-count h)",
    ),
    num(1),
  );
});

test("takes a :test as a function or as a symbol naming one", () => {
  assert.deepEqual(
    evalIn("(setf h (make-hash-table :test 'eq)) (setf (gethash 'a h) 1) (gethash 'a h)"),
    num(1),
  );
});

test("refuses a hash test function it does not model", () => {
  assert.throws(
    () => evalIn("(make-hash-table :test #'string=)"),
    (error: unknown) => {
      return error instanceof LispEvalError && error.code === "unsupported-standard";
    },
  );
});

test("walks hash keys and values with LOOP", () => {
  const keys = [
    "(setf h (make-hash-table))",
    "(setf (gethash 'a h) 1)",
    "(setf (gethash 'b h) 2)",
    "(loop for k being the hash-keys of h collect k)",
  ].join(" ");
  assert.equal(printValueOf(keys), "(A B)");

  const values = [
    "(setf h (make-hash-table))",
    "(setf (gethash 'a h) 1)",
    "(setf (gethash 'b h) 2)",
    "(loop for v being the hash-values of h collect v)",
  ].join(" ");
  assert.equal(printValueOf(values), "(1 2)");
});

test("walks both sides of a hash entry with using", () => {
  const source = [
    "(setf h (make-hash-table))",
    "(setf (gethash 'a h) 1)",
    "(loop for k being the hash-keys of h using (hash-value v) collect (list k v))",
  ].join(" ");
  assert.equal(printValueOf(source), "((A 1))");
});

test("calls a function per entry with maphash", () => {
  const source = [
    "(setf h (make-hash-table))",
    "(setf (gethash 'a h) 1)",
    "(setf (gethash 'b h) 2)",
    "(let ((total 0)) (maphash (lambda (k v) (setf total (+ total v))) h) total)",
  ].join(" ");
  assert.deepEqual(evalIn(source), num(3));
});

test("walks a hash table with with-hash-table-iterator", () => {
  const read = [
    "(setf h (make-hash-table))",
    "(setf (gethash 'a h) 1)",
    "(with-hash-table-iterator (next h) (multiple-value-bind (more k v) (next) (list more k v)))",
  ].join(" ");
  assert.equal(printValueOf(read), "(T A 1)");

  // Once the entries run out the function answers NIL, and only NIL.
  const exhausted = [
    "(setf h (make-hash-table))",
    "(setf (gethash 'a h) 1)",
    "(with-hash-table-iterator (next h) (list (next) (next)))",
  ].join(" ");
  assert.equal(printValueOf(exhausted), "(T NIL)");
});

test("drains a hash table with a LOOP over with-hash-table-iterator", () => {
  const source = [
    "(setf h (make-hash-table))",
    "(setf (gethash 'a h) 1)",
    "(setf (gethash 'b h) 2)",
    "(setf out nil)",
    "(with-hash-table-iterator (next h)",
    "  (loop (multiple-value-bind (more k v) (next)",
    "          (if more (push (list k v) out) (return out)))))",
  ].join(" ");
  assert.equal(printValueOf(source), "((B 2) (A 1))");
});

//LLM-written tests for FORMAT
test("returns the formatted string for a NIL destination", () => {
  assert.equal(
    printValueOf('(format nil "~a = ~d" (quote x) 42)'),
    '"X = 42"',
  );
});

test("discards output for a T destination and returns NIL", () => {
  assert.deepEqual(evalIn('(format t "hello ~a" 1)'), NIL);
});

test("renders ~a princ-style and ~s readably", () => {
  assert.equal(printValueOf('(format nil "~a" "x")'), '"x"');
  assert.equal(printValueOf('(format nil "~s" "x")'), '"\\"x\\""');
  assert.equal(printValueOf('(format nil "~a" #\\a)'), '"a"');
  assert.equal(printValueOf('(format nil "~s" #\\a)'), '"#\\\\a"');
});

test("keeps princ-style inside a list", () => {
  assert.equal(printValueOf('(format nil "~a" (list 1 "x"))'), '"(1 x)"');
});

test("rejects a non-integer for ~d", () => {
  assert.throws(() => evalIn('(format nil "~d" 4.5)'), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "type-error";
  });
});

test("writes newlines with ~% and a fresh line with ~&", () => {
  // A quoted string keeps a raw newline, as SBCL prints it.
  assert.equal(printValueOf('(format nil "a~%b")'), '"a\nb"');
  assert.equal(printValueOf('(format nil "a~&b")'), '"a\nb"');
  assert.equal(printValueOf('(format nil "~&x")'), '"x"');
});

test("writes a literal tilde", () => {
  assert.equal(printValueOf('(format nil "100~~")'), '"100~"');
});

test("reports a character that is not a directive", () => {
  assert.throws(() => evalIn('(format nil "~q" 1)'), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "malformed-form";
  });
});

test("reports a standard directive it has not built", () => {
  for (const source of ['(format nil "~b" 5)', '(format nil "~x" 255)', '(format nil "~c" 65)']) {
    assert.throws(() => evalIn(source), (error: unknown) => {
      return error instanceof LispEvalError && error.code === "unsupported-standard";
    }, source);
  }
});

test("reports directive parameters and modifiers", () => {
  for (const source of ['(format nil "~5d" 1)', '(format nil "~:@a" 1)']) {
    assert.throws(() => evalIn(source), (error: unknown) => {
      return error instanceof LispEvalError && error.code === "unsupported-standard";
    }, source);
  }
});

test("reports a missing argument and a trailing tilde", () => {
  for (const source of ['(format nil "~a/~a" 1)', '(format nil "abc~")']) {
    assert.throws(() => evalIn(source), (error: unknown) => {
      return error instanceof LispEvalError && error.code === "malformed-form";
    }, source);
  }
});

test("refuses a destination that is not NIL or T", () => {
  assert.throws(() => evalIn('(format #(1) "x")'), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "unsupported-standard";
  });
});

//LLM-written tests for output streams
test("collects write-string output", () => {
  assert.deepEqual(
    evalIn('(with-output-to-string (out) (write-string "abc" out))'),
    { kind: "string", value: "abc" },
  );
});

test("collects write-char output", () => {
  assert.equal(
    printValueOf("(with-output-to-string (out) (write-char #\\x out) (write-char #\\y out))"),
    '"xy"',
  );
});

test("returns an empty string for an empty body", () => {
  assert.deepEqual(evalIn("(with-output-to-string (out))"), { kind: "string", value: "" });
});

test("keeps the stream variable out of the enclosing scope", () => {
  assert.throws(
    () => evalIn('(with-output-to-string (out) (write-string "a" out)) out'),
    (error: unknown) => {
      return error instanceof LispEvalError && error.code === "unbound-variable";
    },
  );
});

test("writes princ and prin1 forms and their to-string variants", () => {
  assert.equal(printValueOf('(with-output-to-string (out) (princ "s" out))'), '"s"');
  assert.equal(printValueOf('(with-output-to-string (out) (prin1 "s" out))'), '"\\"s\\""');
  assert.equal(printValueOf('(princ-to-string "s")'), '"s"');
  assert.equal(printValueOf('(prin1-to-string "s")'), '"\\"s\\""');
  assert.equal(printValueOf("(princ-to-string #\\a)"), '"a"');
  assert.equal(printValueOf("(prin1-to-string #\\a)"), '"#\\\\a"');
  // SBCL prints a space as #\ followed by the space itself, and princ leaves it
  // bare. Both read back as the character they came from.
  assert.equal(printValueOf("(prin1-to-string #\\Space)"), '"#\\\\ "');
  assert.equal(printValueOf("(princ-to-string #\\Space)"), '" "');
});

test("returns the written object from princ, prin1 and write", () => {
  assert.deepEqual(evalIn('(princ "s")'), { kind: "string", value: "s" });
  assert.deepEqual(evalIn("(write-char #\\a)"), { kind: "char", value: "a" });
  assert.deepEqual(evalIn('(write-string "s")'), { kind: "string", value: "s" });
});

test("formats into a stream", () => {
  assert.equal(
    printValueOf('(with-output-to-string (out) (format out "~a=~d" (quote k) 2))'),
    '"K=2"',
  );
});

test("answers typep for a stream", () => {
  assert.equal(
    printValueOf('(with-output-to-string (out) (write-string (if (typep out (quote stream)) "y" "n") out))'),
    '"y"',
  );
});

test("rejects a wrong argument type for the write functions", () => {
  for (const source of [
    "(with-output-to-string (out) (write-char 5 out))",
    "(with-output-to-string (out) (write-string 5 out))",
    '(with-output-to-string (out) (write-string "x" 5))',
  ]) {
    assert.throws(() => evalIn(source), (error: unknown) => {
      return error instanceof LispEvalError && error.code === "type-error";
    }, source);
  }
});

test("builds the corpus upper-string", () => {
  const source = [
    "(defun upper (s)",
    "(with-output-to-string (out)",
    "(dotimes (i (length s))",
    "(write-char (char-upcase (schar s i)) out))))",
    '(upper "abc")',
  ].join(" ");
  assert.equal(printValueOf(source), '"ABC"');
});

test("measures a string and reads its elements", () => {
  assert.deepEqual(evalIn('(length "abc")'), num(3));
  assert.deepEqual(evalIn('(elt "abc" 1)'), { kind: "char", value: "b" });
  assert.deepEqual(evalIn('(elt "abc" 9)'), NIL);
});

//LLM-written tests for GETF, SORT and STRING<
test("reads a property list and honours a default", () => {
  assert.deepEqual(evalIn("(getf (list :a 1 :b 2) :b)"), num(2));
  assert.deepEqual(evalIn("(getf (list :a 1) :z)"), NIL);
  assert.deepEqual(evalIn("(getf (list :a 1) :z 'fallback)"), intern("FALLBACK"));
  assert.deepEqual(evalIn("(getf nil :a)"), NIL);
});

test("assigns through the getf place, replacing or prepending", () => {
  const replace = "(setf pl (list :a 1)) (setf (getf pl :a) 9) (getf pl :a)";
  assert.deepEqual(evalIn(replace), num(9));

  const prepend = "(setf pl (list :a 1)) (setf (getf pl :b) 2) (list pl (getf pl :b))";
  assert.equal(printValueOf(prepend), "((:B 2 :A 1) 2)");
});

test("rejects a plist that is not a list", () => {
  assert.throws(() => evalIn("(getf 5 :a)"), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "type-error";
  });
});

test("starts an incf on a gethash place from its default", () => {
  const source = [
    "(setf h (make-hash-table))",
    "(incf (gethash 'a h 0))",
    "(incf (gethash 'a h 0))",
    "(gethash 'a h)",
  ].join(" ");
  assert.deepEqual(evalIn(source), num(2));
});

test("sorts a list and a vector, leaving the input alone", () => {
  const predicate = "(lambda (a b) (< a b))";
  assert.equal(printValueOf(`(sort (list 3 1 2) ${predicate})`), "(1 2 3)");
  assert.equal(printValueOf(`(sort #(3 1 2) ${predicate})`), "#(1 2 3)");
  assert.equal(
    printValueOf(`(let ((l (list 3 1 2))) (sort l ${predicate}) l)`),
    "(3 1 2)",
  );
});

test("sorts strings and symbol keys through a designator comparison", () => {
  assert.equal(printValueOf('(sort (list "b" "a") (function string<))'), '("a" "b")');
  assert.equal(printValueOf("(sort (list 'b 'a) (function string<))"), "(A B)");
});

test("rejects sorting something that is not a sequence", () => {
  assert.throws(
    () => evalIn("(sort 5 (lambda (a b) (< a b)))"),
    (error: unknown) => {
      return error instanceof LispEvalError && error.code === "type-error";
    },
  );
});

// CL's string< answers the index of the first difference, not T. Verified
// against SBCL: ("a" "b") is 0, ("a" "ab") is 1 because "a" is a proper prefix.
test("compares strings and string designators by mismatch index", () => {
  assert.deepEqual(evalIn('(string< "a" "b")'), num(0));
  assert.deepEqual(evalIn('(string< "abc" "abd")'), num(2));
  assert.deepEqual(evalIn('(string< "a" "ab")'), num(1));
  assert.deepEqual(evalIn('(string< "" "a")'), num(0));
  assert.deepEqual(evalIn('(string< "b" "a")'), NIL);
  assert.deepEqual(evalIn('(string< "a" "a")'), NIL);
  assert.deepEqual(evalIn("(string< 'a 'b)"), num(0));
  assert.deepEqual(evalIn("(string< #\\a #\\b)"), num(0));
});

test("builds the corpus word-counts table by incf", () => {
  const source = [
    "(defun word-counts (words)",
    "(let ((table (make-hash-table :test (function equal))))",
    "(dolist (w words table) (incf (gethash w table 0))))",
    ")",
    "(gethash 'a (word-counts '(a b a)))",
  ].join(" ");
  assert.deepEqual(evalIn(source), num(2));
});

//LLM-written tests for multiple values
test("takes the primary value in a single-value context", () => {
  assert.deepEqual(evalIn("(values 1 2)"), num(1));
  assert.deepEqual(evalIn("(+ 1 (values 2 3))"), num(3));
});

test("collects every value into a list", () => {
  assert.equal(printValueOf("(multiple-value-list (values 1 2))"), "(1 2)");
  assert.equal(printValueOf("(multiple-value-list 5)"), "(5)");
});

test("binds every value and pads with NIL", () => {
  assert.equal(
    printValueOf("(multiple-value-bind (a b) (values 1 2) (list a b))"),
    "(1 2)",
  );
  assert.equal(
    printValueOf("(multiple-value-bind (a b) 5 (list a b))"),
    "(5 NIL)",
  );
  assert.deepEqual(evalIn("(multiple-value-bind (a) (values 1 2) a)"), num(1));
});

test("assigns with multiple-value-setq", () => {
  assert.equal(
    printValueOf("(let ((a 1) (b 2)) (multiple-value-setq (a b) (values 10 20)) (list a b))"),
    "(10 20)",
  );
});

test("reads gethash value and present-p together", () => {
  assert.equal(
    printValueOf("(multiple-value-list (gethash 'a (make-hash-table)))"),
    "(NIL NIL)",
  );
  assert.equal(
    printValueOf("(setf h (make-hash-table)) (setf (gethash 'a h) 1) (multiple-value-list (gethash 'a h))"),
    "(1 T)",
  );
});

test("reads floor's quotient and remainder", () => {
  assert.equal(printValueOf("(multiple-value-bind (q r) (floor 7 2) (list q r))"), "(3 1)");
  assert.deepEqual(evalIn("(floor 7 2)"), num(3));
  assert.deepEqual(evalIn("(multiple-value-bind (q r) (floor 7 2) r)"), num(1));
});
