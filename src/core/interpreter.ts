import {
  NIL,
  cons,
  intern,
  isNil,
  Env,
  isTruthy,
  type LispValue,
  FunctionValue,
  Place,
  ConsValue,
} from "./values";
import type { AstNode, AtomNode, ListNode, Position } from "./reader";
import {
  applyBuiltIn,
  builtins,
  consForm,
  expectNumber,
  register,
} from "./builtins";
import { LispEvalError } from "./errors";
import { STANDARD_SYMBOLS } from "./standard-symbols";

export class ReturnSignal {
  constructor(readonly value: LispValue) {}
}

export interface EvaluationObserver {
  onEnterForm?(node: AstNode, env: Env): void;
  onLeaveForm?(node: AstNode, env: Env, value: LispValue): void;
  onCallEnter?(fn: FunctionValue, args: LispValue[]): void;
  onCallExit?(fn: FunctionValue, value: LispValue): void;
}

let currentObserver: EvaluationObserver | null = null;

export function withObserver<T>(observer: EvaluationObserver, run: () => T): T {
  const previous = currentObserver;
  currentObserver = observer;
  try {
    return run();
  } finally {
    //I have absolutely no idea what this does
    currentObserver = previous;
  }
}

export function createEnv(parent: Env | null): Env {
  const env = { vars: new Map(), parent };
  if (parent === null) {
    env.vars.set("T", intern("T"));
    env.vars.set("NIL", NIL);
    for (const [name, builtin] of builtins) {
      env.vars.set(name, builtin);
    }
  }
  return env;
}

let steps = 0;
const STEP_LIMIT = 1_000_000;

export function resetEvaluationBudget(): void {
  steps = 0;
}

export function evaluate(node: AstNode, env: Env  ): LispValue {
  const observer = currentObserver;
  if (observer === null) return evaluateInner(node, env);

  observer.onEnterForm?.(node, env);
  const value = evaluateInner(node, env );
  observer.onLeaveForm?.(node, env, value );
  return value;
}

export function applyFunction(fn: FunctionValue, args: LispValue[]): LispValue {
  if (args.length !== fn.params.length) {
    throw new LispEvalError(
      "arity",
      null,
      `${fn.name} expects ${fn.params.length} argument(s), got ${args.length}`,
    );
  }

  const scope = createEnv(fn.env);
  for (let index = 0; index < fn.params.length; index += 1) {
    define(scope, fn.params[index]!, args[index]!);
  }

  currentObserver?.onCallEnter?.(fn, args);
  const value = evaluateBody(fn.body, scope );
  currentObserver?.onCallExit?.(fn, value );
  return value;
}

export function callValue(callable: LispValue, args: LispValue[]): LispValue {
  if (callable.kind === "function") return applyFunction(callable, args);
  if (callable.kind === "builtin") return applyBuiltIn(callable, args);
  throw new LispEvalError(
    "type-error",
    null,
    `not a function: ${callable.kind}`,
  );
}

export function visibleBindings(env: Env  ): Map<string, LispValue> {
  const visible = new Map<string, LispValue>();
  let current: Env | null = env;
  while (current !== null) {
    for (const [name, value] of current.vars) {
      if (!visible.has(name) ) visible.set(name, value  );
    }
    current = current.parent;
  }
  return visible;
}

function evaluateInner(node: AstNode, env: Env): LispValue {
  steps += 1;
  if (steps > STEP_LIMIT)
    throw new LispEvalError(
      "evaluation-budget",
      null,
      "evaluation took too many steps",
    );
  if (node.kind === "quote" && node.quoteKind === "#'") {
    // #'f is the function value of f; #'(lambda ...) evaluates to a function.
    if (node.target.kind === "atom") return functionByName(node.target, env);
    return evaluate(node.target, env);
  }
  if (node.kind === "quote") return astToValue(node.target);
  // A vector literal evaluates to itself; #(1 2 3) is data, not a call.
  if (node.kind === "list" && node.prefix !== undefined)
    return astToValue(node);
  if (node.kind === "list") {
    const head = node.children[0];
    const name = head === undefined ? undefined : symbolName(head);

    //i wrote this whole thing by hand instead of copy pasting and it probably wasnt worth it
    switch (name) {
      case "IF":
        return evalIf(node, env);
      case "COND":
        return evalCond(node, env);
      case "AND":
        return evalAnd(node, env);
      case "OR":
        return evalOr(node, env);
      case "WHEN":
        return evalWhen(node, env);
      case "UNLESS":
        return evalUnless(node, env);
      case "QUOTE": {
        const target = node.children[1];
        if (target === undefined)
          throw new LispEvalError(
            "malformed-form",
            null,
            "quote needs at least one form",
          );
        return astToValue(target);
      }
      case "FUNCTION": {
        const target = node.children[1];
        if (target === undefined)
          throw new LispEvalError(
            "malformed-form",
            node.start,
            "function needs a name or a lambda",
          );
        // (function f) is #'f, and (function (lambda ...)) evaluates the lambda
        if (target.kind === "atom") return functionByName(target, env);
        return evaluate(target, env);
      }
      case "PROGN":
        return evaluateBody(node.children.slice(1), env); // slice(1): drop "progn", keep the body forms
      case "SETF":
        return evalSetf(node, env);
      case "INCF":
        return evalIncDecf(node, env, 1);
      case "DECF":
        return evalIncDecf(node, env, -1);
      case "LET":
        return evalLet(node, env, false);
      case "LET*":
        return evalLet(node, env, true);
      case "DEFUN":
        return evalDefun(node, env);
      case "LAMBDA":
        return evalLambda(node, env);
      case "LABELS":
        return evalLocalFunctions(node, env, true);
      case "FLET":
        return evalLocalFunctions(node, env, false);
      case "DEFPARAMETER":
      case "DEFVAR":
        return evalDefParameter(node, env);
      case "SETQ":
        return evalSetQ(node, env);
      case "DOLIST":
        return evalDolist(node, env);
      case "DOTIMES":
        return evalDotimes(node, env);
      case "RETURN":
        return evalReturn(node, env);
      case "PUSH":
        return evalPush(node, env);
      case "POP":
        return evalPop(node, env);
      default:
        return evalCall(node, env);
    }
  }
  //node is AtomNode
  const raw = String(node.value);
  if (raw.startsWith(":")) return intern(raw);

  if (node.atomType === "number")
    return { kind: "number", value: Number(node.value) };
  if (node.atomType === "string")
    return { kind: "string", value: String(node.value) };

  const value = lookup(env, String(node.value));
  if (value === undefined) {
    const name = String(node.value).toUpperCase();
    // A standard name Lispnt does not implement, or an earmuffed special
    // variable that may live in another file, is not the learner's mistake.
    if (
      STANDARD_SYMBOLS.has(name) ||
      (name.startsWith("*") && name.endsWith("*"))
    ) {
      throw new LispEvalError(
        "unsupported-standard",
        node.start,
        `Lispnt does not implement ${name}`,
      );
    }
    throw new LispEvalError(
      "unbound-variable",
      node.start,
      `unbound variable: ${name}`,
    );
  }

  return value;
}

export function define(env: Env, name: string, value: LispValue): void {
  env.vars.set(name.toUpperCase(), value);
}

export function lookup(env: Env, name: string): LispValue | undefined {
  const key = name.toUpperCase();
  let current: Env | null = env;

  while (current !== null) {
    const found = current.vars.get(key);
    if (found !== undefined) return found; //lookup succeed
    current = current.parent;
  }
  return undefined; //I guess if the lookup fails
}

export function resolvePlace(node: AstNode, env: Env): Place {
  if (node.kind === "atom" && node.atomType === "symbol") {
    const name = symbolName(node)!;
    return {
      get: () => lookup(env, name) ?? NIL,
      set: (value) => {
        if (!assign(env, name, value)) define(env, name, value);
      },
    };
  }

  if (node.kind !== "list")
    throw new LispEvalError("not-a-place", node.start, "not a place");

  const head = node.children[0];
  const name = head === undefined ? undefined : symbolName(head);

  switch (name) {
    case "CAR": {
      const cell = expectConsPlace(node, env);
      return {
        get: () => cell.cdr,
        set: (value) => {
          cell.car = value;
        },
      };
    }
    case "CDR": {
      const cell = expectConsPlace(node, env);
      return { get: () => cell.cdr, set: (value) => (cell.cdr = value) };
    }
    case "AREF":
    case "ELT": {
      const index = arrayAndIndex(node, env); // {elements, at}
      return {
        get: () => index.elements[index.at] ?? NIL,
        set: (value) => {
          index.elements[index.at] = value;
        },
      };
    }
    default:
      throw new LispEvalError(
        "not-a-place",
        node.start,
        `not a place: ${String(name)}`,
      );
  }
}

function evalSetf(form: ListNode, env: Env): LispValue {
  let result: LispValue = NIL;
  let index = 1;
  while (index + 1 < form.children.length) {
    const place = resolvePlace(form.children[index]!, env);
    result = evaluate(form.children[index + 1]!, env);
    place.set(result);
    index += 2; //since we look at two positions
  }
  return result;
}

function evalReturn(form: ListNode, env: Env): LispValue {
  const valueNode = form.children[1];
  throw new ReturnSignal(
    valueNode === undefined ? NIL : evaluate(valueNode, env),
  );
}

function evalDolist(form: ListNode, env: Env): LispValue {
  const spec = form.children[1];
  if (spec === undefined || spec.kind !== "list")
    throw new LispEvalError(
      "malformed-form",
      null,
      "dolist needs to be in the form (var list result), var = item in list (iterates), the list you iterate and an optional result returned when the loop finishes.",
    );

  const variable = spec.children[0];
  const varListNode = spec.children[1]; //different name purely so that my editor suggestions don't mess up
  const resultNode = spec.children[2];

  const name = variable === undefined ? undefined : symbolName(variable);

  if (name === undefined || varListNode == undefined)
    throw new LispEvalError(
      "malformed-form",
      null,
      "dolist needs an iterating variable and a list to iterate through",
    );

  const items = consForm(evaluate(varListNode, env));
  const result = resultNode === undefined ? undefined : resultNode;

  try {
    for (const item of items) {
      const scope = createEnv(env);
      define(scope, name, item);
      evaluateBody(form.children.slice(2), scope);
    }
  } catch (error) {
    if (error instanceof ReturnSignal) return error.value;
    throw error;
  }

  return resultNode === undefined ? NIL : evaluate(resultNode, env);
}

function evalDotimes(form: ListNode, env: Env): LispValue {
  const spec = form.children[1];
  if (spec === undefined || spec.kind !== "list")
    throw new LispEvalError(
      "malformed-form",
      null,
      "dotimes needs (var count [result])",
    );

  const variable = spec.children[0];
  const countNode = spec.children[1];
  const resultNode = spec.children[2];
  const name = variable === undefined ? undefined : symbolName(variable);
  if (name === undefined || countNode === undefined)
    throw new LispEvalError(
      "malformed-form",
      null,
      "dotimes needs a variable and a count",
    );

  const count = expectNumber(evaluate(countNode, env));

  try {
    for (let index = 0; index < count; index += 1) {
      const scope = createEnv(env);
      define(scope, name, { kind: "number", value: index });
      evaluateBody(form.children.slice(2), scope);
    }
  } catch (error) {
    if (error instanceof ReturnSignal) return error.value;
    throw error;
  }

  // CL leaves the variable bound to COUNT after the loop, outside the body
  const scope = createEnv(env);
  define(scope, name, { kind: "number", value: count });
  return resultNode === undefined ? NIL : evaluate(resultNode, scope);
}

function evalPush(form: ListNode, env: Env): LispValue {
  // CL's push is binary: (push item place). Extra arguments are a caller error,
  // not a multi-push.
  if (form.children.length !== 3) {
    throw new LispEvalError(
      "malformed-form",
      null,
      "push takes an item and a place",
    );
  }

  const place = resolvePlace(form.children[2]!, env);
  const next = cons(evaluate(form.children[1]!, env), place.get());
  place.set(next);
  return next;
}

function evalPop(form: ListNode, env: Env): LispValue {
  const place = resolvePlace(form.children[1]!, env);
  const cell = place.get();
  if (cell.kind !== "cons")
    throw new LispEvalError("type-error", null, "pop: place is not a list");
  place.set(cell.cdr);
  return cell.car;
}

function evalIncDecf(form: ListNode, env: Env, sign: number): LispValue {
  //sign is either 1 or -1 and multiplies amount to inc or dec
  const place = resolvePlace(form.children[1]!, env);
  const amount =
    form.children[2] === undefined
      ? 1
      : expectNumber(evaluate(form.children[2]!, env));
  const next: LispValue = {
    kind: "number",
    value: expectNumber(place.get()) + amount * sign,
  };
  place.set(next);
  return next;
}

function attachPosition(
  error: LispEvalError,
  position: Position,
): LispEvalError {
  return error.position === null
    ? new LispEvalError(error.code, position, error.message)
    : error;
}

//This goes here instead of builtins to avoid a catastrophic import cycle between builtins and interpreter.
//I thought modern languages wouldn't need weird workarounds like this... alas
register("FUNCALL", 1, null, (args) => callValue(args[0]!, args.slice(1)));
register("APPLY", 2, null, (args) => {
  const callable = args[0]!;
  const tail = consForm(args[args.length - 1]!); //last arg must be list
  return callValue(callable, args.slice(1, -1).concat(tail));
});

//helper for resolve place along with arrayAndIndex
function expectConsPlace(form: ListNode, env: Env): ConsValue {
  const target = form.children[1];
  if (target === undefined)
    throw new LispEvalError(
      "malformed-form",
      null,
      "CAR/CDR place needs one argument",
    );

  const value = evaluate(target, env);
  if (value.kind !== "cons")
    throw new LispEvalError(
      "type-error",
      null,
      `expected a cons, got ${value.kind}`,
    );

  return value;
}

function arrayAndIndex(
  form: ListNode,
  env: Env,
): { elements: LispValue[]; at: number } {
  const sequenceNode = form.children[1];
  const indexNode = form.children[2];
  if (sequenceNode === undefined || indexNode === undefined) {
    throw new LispEvalError(
      "malformed-form",
      null,
      `${symbolName(form.children[0]!)} place needs a sequence and an index`,
    );
  }

  const sequence = evaluate(sequenceNode, env);
  if (sequence.kind !== "array")
    throw new LispEvalError(
      "type-error",
      null,
      `expected an array, got ${sequence.kind}`,
    );

  const indexValue = evaluate(indexNode, env);
  if (indexValue.kind !== "number" || !Number.isInteger(indexValue.value))
    throw new LispEvalError("type-error", null, "index must be an integer");

  const at = indexValue.value;
  if (at < 0 || at >= sequence.elements.length)
    throw new LispEvalError("index-error", null, `index ${at} out of range`);

  return { elements: sequence.elements, at };
}
function evalCall(form: ListNode, env: Env): LispValue {
  const head = form.children[0];
  if (head === undefined) return NIL;

  const callable = resolveCallable(head, env);
  const args = form.children
    .slice(1)
    .map((argument) => evaluate(argument, env)); // slice(1): drop the head symbol, keep the argument forms

  try {
    return callValue(callable, args);
  } catch (error) {
    if (error instanceof LispEvalError) throw attachPosition(error, form.start);
    throw error;
  }
}

// In call position an unknown name is Lispnt's gap when it is standard CL, and
// the learner's mistake when it is not.
function resolveCallable(head: AstNode, env: Env): LispValue {
  try {
    return evaluate(head, env);
  } catch (error) {
    if (error instanceof LispEvalError && error.code === "unbound-variable") {
      const name = symbolName(head);
      if (name !== undefined) {
        if (STANDARD_SYMBOLS.has(name)) {
          throw new LispEvalError(
            "unsupported-standard",
            head.start,
            `Lispnt does not implement ${name}`,
          );
        }
        throw new LispEvalError(
          "undefined-function",
          head.start,
          `undefined function: ${name}`,
        );
      }
    }
    throw error;
  }
}

function functionByName(node: AstNode, env: Env): LispValue {
  const name = symbolName(node);

  if (name === undefined)
    throw new LispEvalError("type-error", null, "not a function designator");

  const target = lookup(env, name);
  if (target === undefined) {
    if (STANDARD_SYMBOLS.has(name)) {
      throw new LispEvalError(
        "unsupported-standard",
        node.start,
        `Lispnt does not implement ${name}`,
      );
    }
    throw new LispEvalError(
      "undefined-function",
      node.start,
      `undefined function: ${name}`,
    );
  }

  return target;
}

function parameterNames(paramsNode: ListNode, form: ListNode): string[] {
  const params: string[] = [];

  for (const paramNode of paramsNode.children) {
    const param = symbolName(paramNode);
    if (param === undefined)
      throw new LispEvalError(
        "malformed-form",
        form.start,
        "parameter must be a symbol",
      );
    params.push(param);
  }

  return params;
}

function symbolName(node: AstNode): string | undefined {
  if (node.kind !== "atom") return undefined; //computer
  if (node.atomType !== "symbol") return undefined; //computer science

  return String(node.value).toUpperCase(); //computingly
}

function evaluateBody(forms: AstNode[], env: Env): LispValue {
  let result: LispValue = NIL;
  for (const form of forms) result = evaluate(form, env);
  return result;
}

function evalIf(form: ListNode, env: Env): LispValue {
  const test = form.children[1];
  const then = form.children[2];
  const otherwise = form.children[3];

  if (test === undefined)
    throw new LispEvalError("malformed-form", null, "if needs test");
  if (!isTruthy(evaluate(test, env)))
    return otherwise === undefined ? NIL : evaluate(otherwise, env);
  //this feels very strange
  return then === undefined ? NIL : evaluate(then, env);
}

function evalCond(form: ListNode, env: Env): LispValue {
  for (const clauseNode of form.children.slice(1)) {
    // slice(1): drop "cond", keep the clause forms
    if (clauseNode.kind !== "list")
      throw new LispEvalError(
        "malformed-form",
        null,
        "cond clause must be a list",
      );
    const testNode = clauseNode.children[0];
    if (testNode === undefined) continue;
    const name = symbolName(testNode);
    const matched =
      name === "T" || name === "OTHERWISE"
        ? true
        : isTruthy(evaluate(testNode, env));
    if (matched) return evaluateBody(clauseNode.children.slice(1), env); // slice(1): drop the clause's test, keep its body
  }
  return NIL;
}

function evalLet(form: ListNode, env: Env, sequential: boolean): LispValue {
  const bindingsNode = form.children[1];
  if (bindingsNode === undefined || bindingsNode.kind !== "list")
    throw new LispEvalError(
      "malformed-form",
      null,
      "let needs a bindings list",
    );

  const scope = createEnv(env);
  for (const bindingNode of bindingsNode.children) {
    if (bindingNode.kind === "atom") {
      const name = symbolName(bindingNode);
      if (name === undefined)
        throw new LispEvalError(
          "malformed-form",
          null,
          "evalLet: bindingNode has no name",
        );
      define(scope, name, NIL);
      continue;
    } //to be real i have no idea what any of this is doing. I have several guesses, but nothing concrete.
    if (bindingNode.kind !== "list")
      throw new LispEvalError("malformed-form", null, "binding must be a list");
    const nameNode = bindingNode.children[0];
    const valueNode = bindingNode.children[1];
    const name = nameNode === undefined ? undefined : symbolName(nameNode);

    if (name === undefined)
      throw new LispEvalError(
        "malformed-form",
        null,
        "binding needs a symbol name",
      );

    const value =
      valueNode === undefined
        ? NIL
        : evaluate(valueNode, sequential ? scope : env);
    define(scope, name, value);
  }
  return evaluateBody(form.children.slice(2), scope); // slice(2): drop "let"/"let*" and the bindings list, keep the body
}

function evalDefun(form: ListNode, env: Env): LispValue {
  const nameNode = form.children[1];
  const paramsNode = form.children[2];

  const name = nameNode === undefined ? undefined : symbolName(nameNode);
  if (
    name === undefined ||
    paramsNode === undefined ||
    paramsNode.kind !== "list"
  )
    throw new LispEvalError(
      "malformed-form",
      null,
      "defun needs a name and an argument list",
    );

  const params = parameterNames(paramsNode, form);

  define(env, name, {
    kind: "function",
    name,
    params,
    body: form.children.slice(3), // slice(3): drop "defun", the name and the parameter list, keep the body
    env,
  });

  return intern(name);
}

function evalLambda(form: ListNode, env: Env): FunctionValue {
  const paramsNode = form.children[1];
  if (paramsNode === undefined || paramsNode.kind !== "list")
    throw new LispEvalError(
      "malformed-form",
      form.start,
      "lambda needs an argument list",
    );

  return {
    kind: "function",
    name: "LAMBDA",
    params: parameterNames(paramsNode, form),
    body: form.children.slice(2), // slice(2): drop "lambda" and the parameter list
    env,
  };
}

function evalLocalFunctions(
  form: ListNode,
  env: Env,
  recursive: boolean,
): LispValue {
  const definitions = form.children[1];
  if (definitions === undefined || definitions.kind !== "list")
    throw new LispEvalError(
      "malformed-form",
      form.start,
      "a local function form needs a list of definitions",
    );

  const scope = createEnv(env);
  const pending: Array<[string, FunctionValue]> = [];

  for (const definitionNode of definitions.children) {
    if (definitionNode.kind !== "list")
      throw new LispEvalError(
        "malformed-form",
        definitionNode.start,
        "each definition must be a list",
      );

    const nameNode = definitionNode.children[0];
    const paramsNode = definitionNode.children[1];
    const name = nameNode === undefined ? undefined : symbolName(nameNode);

    if (
      name === undefined ||
      paramsNode === undefined ||
      paramsNode.kind !== "list"
    )
      throw new LispEvalError(
        "malformed-form",
        definitionNode.start,
        "a definition needs a name and an argument list",
      );

    pending.push([
      name,
      {
        kind: "function",
        name,
        params: parameterNames(paramsNode, definitionNode),
        body: definitionNode.children.slice(2), // slice(2): drop the name and parameter list
        // labels definitions see each other, so they close over the new scope;
        // flet definitions close over the outer env and cannot recurse by name.
        env: recursive ? scope : env,
      },
    ]);
  }

  for (const [name, fn] of pending) define(scope, name, fn);

  return evaluateBody(form.children.slice(2), scope); // slice(2): drop the form head and the definitions
}

function evalDefParameter(form: ListNode, env: Env): LispValue {
  const nameNode = form.children[1];

  const name = nameNode === undefined ? undefined : symbolName(nameNode);
  if (name === undefined)
    throw new LispEvalError(
      "malformed-form",
      null,
      "evalDefParameter: name not defined",
    );

  const valueNode = form.children[2];
  define(env, name, valueNode === undefined ? NIL : evaluate(valueNode, env));

  return intern(name);
}

function assign(env: Env, name: string, value: LispValue): boolean {
  const key = name.toUpperCase();
  let current: Env | null = env;

  while (current !== null) {
    if (current.vars.has(key)) {
      current.vars.set(key, value);
      return true;
    }
    current = current.parent;
  }
  return false;
}

function evalSetQ(form: ListNode, env: Env): LispValue {
  let result: LispValue = NIL;
  let index = 1;
  while (index + 1 < form.children.length) {
    const name = symbolName(form.children[index]!);
    if (name === undefined)
      throw new LispEvalError(
        "malformed-form",
        null,
        "evalDefParameter: name not defined",
      );
    result = evaluate(form.children[index + 1]!, env); //! before in js, ! after in ts. #wow
    if (!assign(env, name, result)) define(env, name, result);
    index += 2;
  }
  return result;
}

function evalAnd(form: ListNode, env: Env): LispValue {
  let result: LispValue = intern("T");
  for (const operand of form.children.slice(1)) {
    // slice(1): drop "and", keep the operands
    result = evaluate(operand, env);
    if (!isTruthy(result)) return NIL;
  }
  return result;
}

function evalOr(form: ListNode, env: Env): LispValue {
  let result: LispValue = NIL;
  for (const operand of form.children.slice(1)) {
    // slice(1): drop "or", keep the operands
    result = evaluate(operand, env);
    if (isTruthy(result)) return result;
  }
  return result;
}

function evalWhen(form: ListNode, env: Env): LispValue {
  const testNode = form.children[1];
  if (testNode === undefined)
    throw new LispEvalError("malformed-form", null, "when needs a test");
  if (!isTruthy(evaluate(testNode, env))) return NIL;
  return evaluateBody(form.children.slice(2), env); // slice(2): drop "when" and the test, keep the body
}

function evalUnless(form: ListNode, env: Env): LispValue {
  const testNode = form.children[1];
  if (testNode === undefined)
    throw new LispEvalError("malformed-form", null, "unless needs a test");
  if (isTruthy(evaluate(testNode, env))) return NIL;
  return evaluateBody(form.children.slice(2), env); // slice(2): drop "unless" and the test, keep the body
}

export function astToValue(node: AstNode): LispValue {
  if (node.kind === "quote") {
    //''x is the data (quote x); #'x is the data (function x)
    const head = intern(node.quoteKind === "#'" ? "FUNCTION" : "QUOTE");
    return cons(head, cons(astToValue(node.target), NIL));
  }

  if (node.kind === "atom") {
    if (node.atomType === "number")
      return { kind: "number", value: Number(node.value) };
    if (node.atomType === "string")
      return { kind: "string", value: String(node.value) };

    return intern(String(node.value));
  }

  if (node.prefix !== undefined)
    return { kind: "array", elements: node.children.map(astToValue) };

  const seed = node.tail === undefined ? NIL : astToValue(node.tail);
  return node.children.reduceRight<LispValue>(
    (cdr, child) => cons(astToValue(child), cdr),
    seed,
  );
}
