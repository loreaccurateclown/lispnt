import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, type AstNode } from "../src/core/reader";
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

//LLM-written tests
function num(value: number): LispValue {
  return { kind: "number", value };
}

function printValueOf(source: string): string {
  return printValue(evaluate(parse(source), createEnv(null)));
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
  assert.deepEqual(value.params, ["X"]);
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
      evaluate(parse(`(${name})`), createEnv(null));
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
  return evaluate(parse(source), createEnv(null));
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
  assert.deepEqual(evalIn("(count '(1) (list '(1) '(2)))"), num(1));
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
  assert.throws(() => evalIn("(typep 3 '(integer 0 10))"), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "unsupported-standard";
  });
  assert.throws(() => evalIn("(typep 3 'tree-node)"), (error: unknown) => {
    return error instanceof LispEvalError && error.code === "unsupported-standard";
  });
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

test("runs a do body with no end test until a budget stops it", () => {
  assert.throws(
    () => withStepCeiling(1000, () => evalIn("(do ((i 0 (+ i 1))) ())")),
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
