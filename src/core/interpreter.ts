import {
  NIL,
  arrayLength,
  cons,
  intern,
  isNil,
  Env,
  isTruthy,
  type KeywordParameter,
  type LambdaList,
  type LispValue,
  FunctionValue,
  Place,
  ConsValue,
  BuiltInValue,
  StructValue,
  StreamValue,
} from "./values";
import type { AstNode, AtomNode, ListNode, Position } from "./reader";
import {
  applyBuiltIn,
  builtins,
  consForm,
  expectCons,
  expectHashTable,
  findProperty,
  setProperty,
  expectNumber,
  hashTableKey,
  isEq,
  listFrom,
  parseKeywords,
  register,
  structTypeNames,
} from "./builtins";
import { LispEvalError } from "./errors";
import {
  parseLoop,
  type LoopClause,
  type LoopDriver,
} from "./loop";
import { printValue } from "./print";
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

export const HARD_STEP_CEILING = 2_000_000;

let steps = 0;

let stepCeiling = HARD_STEP_CEILING;

let stepCeilingOpen = false;

export function withStepCeiling<T>(requested: number, run: () => T): T {
  if (
    !Number.isInteger(requested) ||
    requested < 1 ||
    requested > HARD_STEP_CEILING
  )
    throw new RangeError(
      `a step ceiling must be a whole number from 1 to ${HARD_STEP_CEILING}`,
    );

  if (stepCeilingOpen) throw new Error("a step ceiling is already open");

  stepCeilingOpen = true;
  steps = 0;
  stepCeiling = requested;

  try {
    return run();
  } finally {
    stepCeilingOpen = false;
    steps = 0;
    stepCeiling = HARD_STEP_CEILING;
  }
}

// Heads the evaluator dispatches itself instead of looking up as functions.
// This list mirrors the switch in evaluateInner: a name here is special, not a
// callable name, so a name checker must not read it as a function call.
export const SPECIAL_FORMS: ReadonlySet<string> = new Set([
  "IF",
  "COND",
  "WHEN",
  "UNLESS",
  "PROGN",
  "AND",
  "OR",
  "SETQ",
  "SETF",
  "INCF",
  "DECF",
  "PUSH",
  "POP",
  "RETURN",
  "DEFUN",
  "LAMBDA",
  "LET",
  "LET*",
  "FLET",
  "LABELS",
  "DOLIST",
  "DOTIMES",
  "DO",
  "DO*",
  "CASE",
  "ECASE",
  "CCASE",
  "LOOP",
  "WITH-OUTPUT-TO-STRING",
  "WITH-HASH-TABLE-ITERATOR",
  "MULTIPLE-VALUE-BIND",
  "MULTIPLE-VALUE-SETQ",
  "MULTIPLE-VALUE-LIST",
  "DEFPARAMETER",
  "DEFVAR",
  "DEFSTRUCT",
  "FUNCTION",
  "QUOTE",
]);

// How deeply the evaluator is nested in this thread of execution. A budget
// error thrown outside a pass used to leave the shared counter above the
// ceiling, which disabled every later evaluation in the process; the counter is
// now scoped to the outermost evaluation when no pass is open.
let evaluationDepth = 0;

export function evaluate(node: AstNode, env: Env  ): LispValue {
  return unwrapValues(evaluateRaw(node, env));
}

// The primary value of a values bundle, which is what every single-value
// context sees.
export function unwrapValues(value: LispValue): LispValue {
  if (value.kind !== "values") return value;
  return value.values[0] ?? NIL;
}

// Evaluate a form without taking the primary value, so a caller can ask for all
// of them: MULTIPLE-VALUE-BIND and the trace observer do.
export function evaluateRaw(node: AstNode, env: Env): LispValue {
  const outermost = evaluationDepth === 0;
  if (outermost && !stepCeilingOpen) steps = 0;
  evaluationDepth += 1;

  try {
    const observer = currentObserver;
    if (observer === null) return evaluateInner(node, env);

    observer.onEnterForm?.(node, env);
    const value = evaluateInner(node, env );
    observer.onLeaveForm?.(node, env, value );
    return value;
  } finally {
    evaluationDepth -= 1;
  }
}

// Every value a form produced, and at least one — a single value counts as one.
function evaluateValues(node: AstNode, env: Env): LispValue[] {
  const value = evaluateRaw(node, env);
  return value.kind === "values" ? value.values : [value];
}

export function applyFunction(fn: FunctionValue, args: LispValue[]): LispValue {
  const scope = createEnv(fn.env);
  bindLambdaList(fn.lambdaList, args, scope, fn.name);

  currentObserver?.onCallEnter?.(fn, args);
  // The observer sees every value the body returned, so a trace can show "1 2";
  // the call itself hands its caller the primary value.
  const raw = evaluateBodyRaw(fn.body, scope);
  currentObserver?.onCallExit?.(fn, raw);
  return unwrapValues(raw);
}

// CL's own reading of a wrong argument count, used here rather than built there
// because the name checker owns the whole-file report; this one only reaches a
// call that the checker let through.
function arityMessage(name: string, given: number, min: number, max: number | null): string {
  if (max === null)
    return `${name} takes at least ${min} argument(s), but is called with ${given}`;
  if (min === max)
    return `${name} takes exactly ${max} argument(s), but is called with ${given}`;
  return `${name} takes ${min} to ${max} argument(s), but is called with ${given}`;
}

function bindLambdaList(
  lambdaList: LambdaList,
  args: readonly LispValue[],
  scope: Env,
  name: string,
): void {
  const min = lambdaList.required.length;
  const max =
    lambdaList.rest !== undefined || lambdaList.keys.length > 0
      ? null
      : min + lambdaList.optional.length;

  if (args.length < min || (max !== null && args.length > max))
    throw new LispEvalError("arity", null, arityMessage(name, args.length, min, max));

  let index = 0;
  for (const parameter of lambdaList.required) {
    define(scope, parameter, args[index]!);
    index += 1;
  }

  for (const parameter of lambdaList.optional) {
    // A default is evaluated in the call's scope, so it can name the parameters
    // bound before it, as CL allows.
    const given = index < args.length ? args[index] : undefined;
    index += 1;
    define(
      scope,
      parameter.name,
      given ?? (parameter.default === undefined ? NIL : evaluate(parameter.default, scope)),
    );
    if (parameter.suppliedP !== undefined)
      define(scope, parameter.suppliedP, given === undefined ? NIL : intern("T"));
  }

  // The rest argument keeps the keywords it holds: CL gives &rest and &key the
  // same remaining arguments.
  const remaining = args.slice(index);
  if (lambdaList.rest !== undefined) define(scope, lambdaList.rest, listFrom(remaining));
  if (lambdaList.keys.length > 0)
    bindKeywordArguments(lambdaList.keys, remaining, scope, name);

  for (const parameter of lambdaList.aux) {
    define(
      scope,
      parameter.name,
      parameter.init === undefined ? NIL : evaluate(parameter.init, scope),
    );
  }
}

function bindKeywordArguments(
  keys: readonly KeywordParameter[],
  args: readonly LispValue[],
  scope: Env,
  name: string,
): void {
  if (args.length % 2 !== 0)
    throw new LispEvalError(
      "malformed-form",
      null,
      `${name}: keyword arguments come in name value pairs`,
    );

  const given = new Map<string, LispValue>();
  for (let index = 0; index < args.length; index += 2) {
    const keyword = args[index]!;
    const key =
      keyword.kind === "symbol" && keyword.name.startsWith(":")
        ? keyword.name.toUpperCase()
        : undefined;
    if (key === undefined)
      throw new LispEvalError(
        "type-error",
        null,
        `${name}: expected a keyword argument name, got ${keyword.kind}`,
      );
    if (!keys.some((parameter) => parameter.keyword === key))
      throw new LispEvalError("type-error", null, `${name} does not accept the keyword ${key}`);
    given.set(key, args[index + 1]!);
  }

  for (const parameter of keys) {
    const supplied = given.get(parameter.keyword);
    define(
      scope,
      parameter.name,
      supplied ??
        (parameter.default === undefined ? NIL : evaluate(parameter.default, scope)),
    );
    if (parameter.suppliedP !== undefined)
      define(scope, parameter.suppliedP, supplied === undefined ? NIL : intern("T"));
  }
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

// One unit of the evaluation budget. LOOP calls this once per iteration as
// well, so a loop whose body evaluates nothing — (loop), or a driver with no
// body — still stops at the ceiling instead of running forever.
function spendStep(): void {
  steps += 1;
  if (steps > stepCeiling)
    throw new LispEvalError(
      "evaluation-budget",
      null,
      "evaluation took too many steps",
    );
}

function evaluateInner(node: AstNode, env: Env): LispValue {
  spendStep();
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
      case "DEFSTRUCT":
        return evalDefstruct(node, env);
      case "SETQ":
        return evalSetQ(node, env);
      case "DOLIST":
        return evalDolist(node, env);
      case "DOTIMES":
        return evalDotimes(node, env);
      case "DO":
        return evalDo(node, env, false);
      case "DO*":
        return evalDo(node, env, true);
      case "CASE":
        return evalCase(node, env, false);
      case "ECASE":
        return evalCase(node, env, true);
      case "CCASE":
        return evalCase(node, env, true);
      case "LOOP":
        return evalLoop(node, env);
      case "WITH-OUTPUT-TO-STRING":
        return evalWithOutputStream(node, env);
      case "WITH-HASH-TABLE-ITERATOR":
        return evalWithHashTableIterator(node, env);
      case "MULTIPLE-VALUE-BIND":
        return evalMultipleValueBind(node, env);
      case "MULTIPLE-VALUE-SETQ":
        return evalMultipleValueSetq(node, env);
      case "MULTIPLE-VALUE-LIST":
        return evalMultipleValueList(node, env);
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
  if (node.atomType === "char")
    return { kind: "char", value: String(node.value) };

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
    case "GETF": {
      const plistNode = node.children[1];
      const indicatorNode = node.children[2];
      const defaultNode = node.children[3];
      if (plistNode === undefined || indicatorNode === undefined)
        throw new LispEvalError(
          "malformed-form",
          node.start,
          "GETF place needs a plist and an indicator",
        );
      const plistPlace = resolvePlace(plistNode, env);
      const indicator = evaluate(indicatorNode, env);
      const fallback = defaultNode === undefined ? NIL : evaluate(defaultNode, env);
      return {
        get: () => findProperty(plistPlace.get(), indicator)?.value ?? fallback,
        set: (value: LispValue) => {
          plistPlace.set(setProperty(plistPlace.get(), indicator, value));
        },
      };
    }
    case "GETHASH": {
      const keyNode = node.children[1];
      const tableNode = node.children[2];
      if (keyNode === undefined || tableNode === undefined)
        throw new LispEvalError(
          "malformed-form",
          node.start,
          "GETHASH place needs a key and a table",
        );
      const key = evaluate(keyNode, env);
      const table = expectHashTable(evaluate(tableNode, env));
      const defaultNode = node.children[3];
      // The default belongs to the place's read, which is what lets
      // (incf (gethash key table 0)) start counting from zero.
      const fallback = defaultNode === undefined ? NIL : evaluate(defaultNode, env);
      const canonical = hashTableKey(key, table.test);
      return {
        get: () => table.entries.get(canonical)?.value ?? fallback,
        set: (value: LispValue) => {
          table.entries.set(canonical, { key, value });
        },
      };
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
    default: {
      const accessorPlace = resolveAccessorPlace(node, env);
      if (accessorPlace !== undefined) return accessorPlace;
      throw new LispEvalError(
        "not-a-place",
        node.start,
        `not a place: ${String(name)}`,
      );
    }
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

  // CL binds the variable to NIL for the result form after the loop.
  const scope = createEnv(env);
  define(scope, name, NIL);
  return resultNode === undefined ? NIL : evaluate(resultNode, scope);
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

// DO and DO* — bindings (var [init [step]]), an end clause (test result…), then a
// body. DO evaluates every init in the enclosing environment before binding any
// of them; DO* binds each as it goes. The end test runs before every iteration
// and RETURN from the body leaves the loop, as it does in DOLIST.
function evalDo(form: ListNode, env: Env, sequential: boolean): LispValue {
  const bindingsNode = form.children[1];
  const endNode = form.children[2];
  const head = sequential ? "do*" : "do";

  if (
    bindingsNode === undefined ||
    bindingsNode.kind !== "list" ||
    bindingsNode.prefix !== undefined
  )
    throw new LispEvalError("malformed-form", null, `${head} needs a binding list`);

  const scope = createEnv(env);
  const names: string[] = [];
  const inits: Array<AstNode | undefined> = [];
  const steps: Array<AstNode | undefined> = [];

  for (const binding of bindingsNode.children) {
    const spec =
      binding.kind === "list" && binding.prefix === undefined ? binding : undefined;
    const nameNode = spec === undefined ? binding : spec.children[0];
    const name = nameNode === undefined ? undefined : symbolName(nameNode);
    if (name === undefined)
      throw new LispEvalError(
        "malformed-form",
        null,
        `${head} bindings need a variable name`,
      );
    names.push(name);
    inits.push(spec?.children[1]);
    steps.push(spec?.children[2]);
  }

  for (let index = 0; index < names.length; index += 1) {
    const initNode = inits[index];
    define(
      scope,
      names[index]!,
      initNode === undefined ? NIL : evaluate(initNode, sequential ? scope : env),
    );
  }

  const endClause =
    endNode !== undefined && endNode.kind === "list" && endNode.prefix === undefined
      ? endNode
      : undefined;
  const testNode = endClause?.children[0];
  const resultNodes = endClause === undefined ? [] : endClause.children.slice(1);

  for (;;) {
    if (testNode !== undefined && isTruthy(evaluate(testNode, scope))) {
      let result: LispValue = NIL;
      for (const resultNode of resultNodes) result = evaluate(resultNode, scope);
      return result;
    }

    try {
      evaluateBody(form.children.slice(3), scope);
    } catch (error) {
      if (error instanceof ReturnSignal) return error.value;
      throw error;
    }

    // DO computes every step against the same old bindings, then assigns them
    // together; DO* assigns each before the next step is computed.
    const stepped: Array<{ name: string; value: LispValue }> = [];
    for (let index = 0; index < names.length; index += 1) {
      const stepNode = steps[index];
      if (stepNode === undefined) continue;
      const value = evaluate(stepNode, scope);
      if (sequential) define(scope, names[index]!, value);
      else stepped.push({ name: names[index]!, value });
    }
    for (const entry of stepped) define(scope, entry.name, entry.value);
  }
}

// CASE — the key form is evaluated once, then the clauses (keys body…) are tried
// in order, with OTHERWISE and T as the default. ECASE and CCASE signal when
// nothing matches; CL's CCASE would instead offer a restart to correct the key,
// which Lispnt has no mechanism for, so it behaves as ECASE.
function evalCase(form: ListNode, env: Env, signalOnMiss: boolean): LispValue {
  const keyNode = form.children[1];
  if (keyNode === undefined)
    throw new LispEvalError("malformed-form", null, "case needs a key form");

  const key = evaluate(keyNode, env);

  for (const clause of form.children.slice(2)) {
    if (clause.kind !== "list" || clause.prefix !== undefined)
      throw new LispEvalError(
        "malformed-form",
        null,
        "case clauses need to be lists",
      );

    const keysNode = clause.children[0];
    if (keysNode === undefined)
      throw new LispEvalError("malformed-form", null, "case clauses need keys");

    if (caseClauseMatches(keysNode, key))
      return evaluateBody(clause.children.slice(1), env);
  }

  if (signalOnMiss)
    throw new LispEvalError(
      "signalled-error",
      null,
      `case: no clause matches ${printValue(key)}`,
    );
  return NIL;
}

function caseClauseMatches(keysNode: AstNode, key: LispValue): boolean {
  if (keysNode.kind === "atom" && keysNode.atomType === "symbol") {
    const name = String(keysNode.value).toUpperCase();
    if (name === "OTHERWISE" || name === "T") return true;
    return isEq(astToValue(keysNode), key);
  }

  if (keysNode.kind === "list" && keysNode.prefix === undefined)
    return keysNode.children.some((child) => isEq(astToValue(child), key));

  return isEq(astToValue(keysNode), key);
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
  const placeNode = form.children[1];
  if (placeNode === undefined)
    throw new LispEvalError("malformed-form", form.start, "pop needs a place");

  const place = resolvePlace(placeNode, env);
  const cell = place.get();
  if (cell.kind !== "cons")
    throw new LispEvalError("type-error", null, "pop: place is not a list");
  place.set(cell.cdr);
  return cell.car;
}

function evalIncDecf(form: ListNode, env: Env, sign: number): LispValue {
  //sign is either 1 or -1 and multiplies amount to inc or dec
  const placeNode = form.children[1];
  if (placeNode === undefined)
    throw new LispEvalError(
      "malformed-form",
      form.start,
      "incf and decf need a place",
    );

  const place = resolvePlace(placeNode, env);
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

// MAPHASH calls a function per entry, so it lives here with FUNCALL and APPLY
// rather than in builtins.ts, which must not import this module.
register("MAPHASH", 2, 2, (args) => {
  const table = expectHashTable(args[1]!);
  for (const entry of [...table.entries.values()]) {
    callValue(args[0]!, [entry.key, entry.value]);
  }
  return NIL;
});


// SORT calls a comparator, so it lives here with FUNCALL and APPLY. CL's sort is
// destructive; this one copies, so a recorded snapshot cannot change under a
// hint, and JS's stable sort makes it stable where CL promises nothing. A :key
// is applied per comparison, which is what SBCL does — CL leaves the number of
// calls unspecified, and a key with side effects is a mistake either way.
const SORT_KEYS: ReadonlySet<string> = new Set([":KEY"]);

register("SORT", 2, null, (args) => {
  const sequence = args[0]!;
  const predicate = args[1]!;
  const keywords = parseKeywords(args.slice(2), "SORT", SORT_KEYS);
  const key = keywords.get(":KEY");

  const comparable = (value: LispValue): LispValue =>
    key === undefined ? value : callValue(key, [value]);

  const compare = (left: LispValue, right: LispValue): number => {
    const leftKey = comparable(left);
    const rightKey = comparable(right);
    if (isTruthy(callValue(predicate, [leftKey, rightKey]))) return -1;
    if (isTruthy(callValue(predicate, [rightKey, leftKey]))) return 1;
    return 0;
  };

  if (sequence.kind === "cons" || isNil(sequence)) {
    const items = consForm(sequence).slice().sort(compare);
    let result: LispValue = NIL;
    for (let index = items.length - 1; index >= 0; index -= 1)
      result = cons(items[index]!, result);
    return result;
  }

  if (sequence.kind === "array")
    return { kind: "array", elements: sequence.elements.slice().sort(compare) };

  if (sequence.kind === "string") {
    const characters = [...sequence.value].map<LispValue>((character) => ({
      kind: "char",
      value: character,
    }));
    characters.sort(compare);
    return {
      kind: "string",
      value: characters.map((character) => (character as { value: string }).value).join(""),
    };
  }

  throw new LispEvalError(
    "type-error",
    null,
    `SORT: expected a sequence, got ${sequence.kind}`,
  );
});

// COUNT defaults to EQL, as CL does, and takes :test and :key — so it can call a
// user function and lives here beside SORT rather than in builtins.
const COUNT_KEYS: ReadonlySet<string> = new Set([":TEST", ":KEY"]);

register("COUNT", 2, null, (args) => {
  const item = args[0]!;
  const sequence = args[1]!;
  const keywords = parseKeywords(args.slice(2), "COUNT", COUNT_KEYS);
  const test = keywords.get(":TEST");
  const key = keywords.get(":KEY");

  const elements = (): LispValue[] => {
    if (sequence.kind === "array")
      return sequence.elements.slice(0, arrayLength(sequence));
    if (sequence.kind === "string")
      return [...sequence.value].map<LispValue>((character) => ({
        kind: "char",
        value: character,
      }));
    if (sequence.kind === "cons" || isNil(sequence)) return consForm(sequence);
    throw new LispEvalError(
      "type-error",
      null,
      `COUNT: expected a sequence, got ${sequence.kind}`,
    );
  };

  let total = 0;
  for (const candidate of elements()) {
    const subject = key === undefined ? candidate : callValue(key, [candidate]);
    const matches =
      test === undefined
        ? isEq(item, subject)
        : isTruthy(callValue(test, [item, subject]));
    if (matches) total += 1;
  }

  return { kind: "number", value: total };
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

// CL allows these markers in this order. &allow-other-keys is deliberately
// absent: it is a marker Lispnt does not model, so meeting it is our gap and is
// reported as such rather than quietly ignored.
const LAMBDA_MARKERS: ReadonlyMap<string, { rank: number; mode: LambdaMode }> = new Map([
  ["&OPTIONAL", { rank: 1, mode: "optional" }],
  ["&REST", { rank: 2, mode: "rest" }],
  ["&BODY", { rank: 2, mode: "rest" }],
  ["&KEY", { rank: 3, mode: "key" }],
  ["&AUX", { rank: 4, mode: "aux" }],
]);

type LambdaMode = "required" | "optional" | "rest" | "key" | "aux";

type Claim = (name: string, at: AstNode) => void;

type ParameterEntry = {
  name: string;
  keyword?: string;
  default?: AstNode;
  suppliedP?: string;
};

// Parsed at definition time, so a broken lambda list points at the line the
// learner wrote instead of at a call somewhere else.
function parseLambdaList(paramsNode: ListNode): LambdaList {
  const lambdaList: LambdaList = { required: [], optional: [], keys: [], aux: [] };
  const seen = new Set<string>();
  let mode: LambdaMode = "required";
  let rank = 0;
  // &rest is the one marker that must be followed by a name; SBCL reports
  // "expecting variable after &REST" at compile time.
  let restMarker: string | undefined;

  const claim: Claim = (name, at) => {
    if (seen.has(name))
      throw new LispEvalError(
        "malformed-form",
        at.start,
        `${name} appears twice in this lambda list`,
      );
    seen.add(name);
  };

  for (const parameter of paramsNode.children) {
    const word = symbolName(parameter);

    if (word !== undefined && word.startsWith("&")) {
      if (restMarker !== undefined)
        throw new LispEvalError(
          "malformed-form",
          parameter.start,
          `${restMarker} needs a parameter name`,
        );
      const marker = LAMBDA_MARKERS.get(word);
      if (marker === undefined)
        throw new LispEvalError(
          "unsupported-standard",
          parameter.start,
          `lambda list marker ${word} is not implemented`,
        );
      if (marker.rank <= rank)
        throw new LispEvalError(
          "malformed-form",
          parameter.start,
          `${word} is out of order in this lambda list`,
        );
      mode = marker.mode;
      rank = marker.rank;
      if (mode === "rest") restMarker = word;
      continue;
    }

    if (mode === "required") {
      if (word === undefined)
        throw new LispEvalError(
          "malformed-form",
          parameter.start,
          "a required parameter must be a symbol",
        );
      claim(word, parameter);
      lambdaList.required.push(word);
      continue;
    }

    if (mode === "rest") {
      if (word === undefined)
        throw new LispEvalError(
          "malformed-form",
          parameter.start,
          "&rest takes a single parameter name",
        );
      claim(word, parameter);
      lambdaList.rest = word;
      restMarker = undefined;
      continue;
    }

    if (mode === "aux") {
      lambdaList.aux.push(parseAuxEntry(parameter, claim));
      continue;
    }

    const entry = parseParameterEntry(parameter, mode, claim);
    if (mode === "optional") lambdaList.optional.push(entry);
    else lambdaList.keys.push({ ...entry, keyword: entry.keyword ?? `:${entry.name}` });
  }

  if (restMarker !== undefined)
    throw new LispEvalError(
      "malformed-form",
      paramsNode.start,
      `${restMarker} needs a parameter name`,
    );

  return lambdaList;
}

function parameterShape(mode: "optional" | "key"): string {
  return mode === "key"
    ? "a &key parameter is a name, (name default supplied-p) or ((:keyword name) …)"
    : "a parameter is a name or (name default supplied-p)";
}

function parseParameterEntry(
  node: AstNode,
  mode: "optional" | "key",
  claim: Claim,
): ParameterEntry {
  const symbol = symbolName(node);
  if (symbol !== undefined) {
    claim(symbol, node);
    const entry: ParameterEntry = { name: symbol };
    if (mode === "key") entry.keyword = `:${symbol}`;
    return entry;
  }

  if (node.kind !== "list")
    throw new LispEvalError("malformed-form", node.start, parameterShape(mode));

  const head = node.children[0];
  if (head === undefined)
    throw new LispEvalError("malformed-form", node.start, parameterShape(mode));

  // Only &key can rename the keyword its variable answers to.
  let keyword: string | undefined;
  let nameNode: AstNode | undefined = head;
  if (head.kind === "list") {
    const keywordNode = head.children[0];
    const renamed = head.children[1];
    const keywordName = keywordNode === undefined ? undefined : symbolName(keywordNode);
    if (
      mode !== "key" ||
      keywordName === undefined ||
      !keywordName.startsWith(":") ||
      renamed === undefined ||
      head.children.length !== 2
    )
      throw new LispEvalError("malformed-form", head.start, parameterShape(mode));
    keyword = keywordName;
    nameNode = renamed;
  }

  const name = nameNode === undefined ? undefined : symbolName(nameNode);
  if (name === undefined)
    throw new LispEvalError("malformed-form", node.start, parameterShape(mode));

  const tail = node.children.slice(1);
  if (tail.length > 2)
    throw new LispEvalError(
      "malformed-form",
      tail[2]!.start,
      "a parameter takes a name, a default and a supplied-p name",
    );

  claim(name, node);
  const entry: ParameterEntry = { name };
  if (mode === "key") entry.keyword = keyword ?? `:${name}`;

  const defaultNode = tail[0];
  if (defaultNode !== undefined) entry.default = defaultNode;

  const suppliedNode = tail[1];
  if (suppliedNode !== undefined) {
    const supplied = symbolName(suppliedNode);
    if (supplied === undefined)
      throw new LispEvalError(
        "malformed-form",
        suppliedNode.start,
        "a supplied-p name must be a symbol",
      );
    claim(supplied, suppliedNode);
    entry.suppliedP = supplied;
  }

  return entry;
}

function parseAuxEntry(node: AstNode, claim: Claim): { name: string; init?: AstNode } {
  const symbol = symbolName(node);
  if (symbol !== undefined) {
    claim(symbol, node);
    return { name: symbol };
  }

  if (node.kind !== "list")
    throw new LispEvalError(
      "malformed-form",
      node.start,
      "an &aux parameter is a name or a (name initial-value) list",
    );

  const head = node.children[0];
  const name = head === undefined ? undefined : symbolName(head);
  if (name === undefined)
    throw new LispEvalError(
      "malformed-form",
      node.start,
      "an &aux parameter is a name or a (name initial-value) list",
    );

  if (node.children.length > 2)
    throw new LispEvalError(
      "malformed-form",
      node.children[2]!.start,
      "an &aux parameter takes a name and an initial value",
    );

  claim(name, node);
  const init = node.children[1];
  return init === undefined ? { name } : { name, init };
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

  const lambdaList = parseLambdaList(paramsNode);

  define(env, name, {
    kind: "function",
    name,
    lambdaList,
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
    lambdaList: parseLambdaList(paramsNode),
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
        lambdaList: parseLambdaList(paramsNode),
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

// LOOP — the clauses are parsed in loop.ts, which owns the grammar and reports
// any clause word it does not model as unsupported-standard. Execution lives
// here because it needs the evaluator and the call path.
//
// The subset is deliberate: drivers in/on/across and numeric from/to/below/by,
// while/until/repeat, do/collect/append/sum/count/maximize/minimize with into,
// initially/finally/return, and if/when/unless with else and end.
export function evalLoop(form: ListNode, env: Env): LispValue {
  const clauses = parseLoop(form);
  const first = clauses[0];

  if (clauses.length === 1 && first !== undefined && first.kind === "simple") {
    for (;;) {
      spendStep();
      try {
        evaluateBody(first.forms, env);
      } catch (error) {
        if (error instanceof ReturnSignal) return error.value;
        throw error;
      }
    }
  }

  const scope = createEnv(env);
  const drivers = collectClauses(clauses, (clause) => clause.kind === "driver").map(
    (clause) => (clause as Extract<LoopClause, { kind: "driver" }>).driver,
  );
  const terminations = collectClauses(
    clauses,
    (clause) => clause.kind === "termination",
  ) as Array<Extract<LoopClause, { kind: "termination" }>>;
  const accumulation = collectAccumulators(clauses);

  const repeated = terminations.find((clause) => clause.test === "repeat");
  const repeatCount =
    repeated === undefined ? undefined : expectNumber(evaluate(repeated.form, env));

  const states = drivers.map((driver) => startDriver(driver, env, scope));

  // Loop accumulators with an INTO name are visible to the body and to finally.
  for (const accumulator of accumulation.all) {
    if (accumulator.into !== undefined)
      define(scope, accumulator.into, accumulatorValue(accumulator));
  }

  for (const clause of collectClauses(clauses, (c) => c.kind === "initially"))
    for (const initial of (clause as Extract<LoopClause, { kind: "initially" }>).forms)
      evaluate(initial, scope);

  let iterations = 0;
  let returned: LispValue | undefined;

  try {
    for (;;) {
      spendStep();
      if (repeatCount !== undefined && iterations >= repeatCount) break;
      if (states.some((state) => state.done)) break;

      // Drivers are bound before the termination tests, so a WHILE may read a
      // driver variable on the first iteration, as in CL.
      bindDrivers(states, scope);
      if (!terminationAllows(terminations, scope)) break;

      for (const clause of clauses) runClause(clause, scope, accumulation);
      stepDrivers(states);
      iterations += 1;
    }

    for (const clause of collectClauses(clauses, (c) => c.kind === "finally"))
      for (const final of (clause as Extract<LoopClause, { kind: "finally" }>).forms)
        evaluate(final, scope);
  } catch (error) {
    if (error instanceof ReturnSignal) returned = error.value;
    else throw error;
  }

  if (returned !== undefined) return returned;

  // CL allows one kind of implicit accumulation per loop; two kinds cannot
  // share the loop's value, which SBCL reports at macroexpansion.
  if (accumulation.implicit.size > 1)
    throw new LispEvalError(
      "malformed-form",
      form.start,
      "loop: incompatible kinds of accumulation leave the loop's value",
    );
  const only = [...accumulation.implicit.values()][0];
  return only === undefined ? NIL : accumulatorValue(only);
}

type DriverState =
  | {
      readonly kind: "in" | "on";
      readonly name: string;
      readonly by: LispValue | undefined;
      current: LispValue;
      done: boolean;
    }
  | {
      readonly kind: "across";
      readonly name: string;
      readonly elements: LispValue[];
      index: number;
      done: boolean;
    }
  | {
      readonly kind: "range";
      readonly name: string;
      current: number;
      readonly bound: { readonly op: "to" | "below" | "above"; readonly value: number } | undefined;
      readonly by: number;
      done: boolean;
    }
  | {
      readonly kind: "hash";
      readonly name: string;
      readonly of: "keys" | "values";
      readonly entries: Array<{ readonly key: LispValue; readonly value: LispValue }>;
      readonly other?: { readonly kind: "key" | "value"; readonly name: string };
      index: number;
      done: boolean;
    };

function startDriver(driver: LoopDriver, env: Env, _scope: Env): DriverState {
  if (driver.kind === "range") {
    const current = driver.from === undefined ? 0 : expectNumber(evaluate(driver.from, env));
    const bound =
      driver.bound === undefined
        ? undefined
        : {
            op: driver.bound.op,
            value: expectNumber(evaluate(driver.bound.node, env)),
          };
    const by = driver.by === undefined ? 1 : expectNumber(evaluate(driver.by, env));
    const state: DriverState = {
      kind: "range",
      name: driver.name,
      current,
      bound,
      by,
      done: false,
    };
    state.done = rangeDone(state);
    return state;
  }

  if (driver.kind === "hash") {
    const table = expectHashTable(evaluate(driver.table, env));
    const entries = [...table.entries.values()];
    return {
      kind: "hash",
      name: driver.name,
      of: driver.of,
      entries,
      ...(driver.other === undefined ? {} : { other: driver.other }),
      index: 0,
      done: entries.length === 0,
    };
  }

  const source = evaluate(driver.source, env);
  if (driver.how === "across") {
    // ACROSS walks any vector; a string is a vector of characters.
    const elements =
      source.kind === "array"
        ? source.elements
        : source.kind === "string"
          ? [...source.value].map<LispValue>((character) => ({
              kind: "char",
              value: character,
            }))
          : undefined;
    if (elements === undefined)
      throw new LispEvalError(
        "type-error",
        null,
        `loop: ACROSS needs a vector or a string, got ${source.kind}`,
      );
    return {
      kind: "across",
      name: driver.name,
      elements,
      index: 0,
      done: elements.length === 0,
    };
  }

  if (driver.how === "in" && source.kind !== "cons" && !isNil(source))
    throw new LispEvalError(
      "type-error",
      null,
      `loop: IN needs a list, got ${source.kind}`,
    );

  return {
    kind: driver.how,
    name: driver.name,
    by: driver.by === undefined ? undefined : evaluate(driver.by, env),
    current: source,
    done: isNil(source),
  };
}

function rangeDone(state: Extract<DriverState, { kind: "range" }>): boolean {
  if (state.bound === undefined) return false;
  if (state.bound.op === "to") return state.current > state.bound.value;
  if (state.bound.op === "below") return state.current >= state.bound.value;
  return state.current < state.bound.value;
}

function bindDrivers(states: DriverState[], scope: Env): void {
  for (const state of states) {
    if (state.kind === "across") {
      define(scope, state.name, state.elements[state.index] ?? NIL);
    } else if (state.kind === "range") {
      define(scope, state.name, { kind: "number", value: state.current });
    } else if (state.kind === "hash") {
      const entry = state.entries[state.index]!;
      define(scope, state.name, state.of === "keys" ? entry.key : entry.value);
      if (state.other !== undefined)
        define(
          scope,
          state.other.name,
          state.other.kind === "key" ? entry.key : entry.value,
        );
    } else if (state.kind === "in") {
      define(scope, state.name, expectCons(state.current).car);
    } else {
      // ON binds the successive tails themselves, not their first elements.
      define(scope, state.name, state.current);
    }
  }
}

function stepDrivers(states: DriverState[]): void {
  for (const state of states) {
    if (state.kind === "across") {
      state.index += 1;
      state.done = state.index >= state.elements.length;
    } else if (state.kind === "range") {
      state.current += state.by;
      state.done = rangeDone(state);
    } else if (state.kind === "hash") {
      state.index += 1;
      state.done = state.index >= state.entries.length;
    } else {
      const next =
        state.by === undefined
          ? expectCons(state.current).cdr
          : callValue(state.by, [state.current]);
      state.current = next;
      state.done = !isTruthy(next) || next.kind !== "cons";
    }
  }
}

function terminationAllows(
  terminations: Array<Extract<LoopClause, { kind: "termination" }>>,
  scope: Env,
): boolean {
  for (const clause of terminations) {
    if (clause.test === "repeat") continue;
    const truthy = isTruthy(evaluate(clause.form, scope));
    if (clause.test === "while" && !truthy) return false;
    if (clause.test === "until" && truthy) return false;
  }
  return true;
}

interface AccumulatorState {
  readonly kind: AccumulatorKind;
  readonly form: AstNode;
  readonly into: string | undefined;
  list: LispValue[];
  total: number;
  best: number | undefined;
}

type AccumulatorKind =
  | "collect"
  | "append"
  | "sum"
  | "count"
  | "maximize"
  | "minimize";

interface Accumulators {
  // Every accumulation clause, for INTO bindings and for evaluation.
  readonly all: AccumulatorState[];
  // The clause's own expression identifies its accumulator.
  readonly byForm: Map<AstNode, AccumulatorState>;
  // Implicit accumulators share one value per kind: two COLLECT clauses in one
  // loop append to the same list, as in CL. Two different kinds are an error.
  readonly implicit: Map<AccumulatorKind, AccumulatorState>;
}

function collectAccumulators(clauses: LoopClause[]): Accumulators {
  const all: AccumulatorState[] = [];
  const byForm = new Map<AstNode, AccumulatorState>();
  const implicit = new Map<AccumulatorKind, AccumulatorState>();

  const create = (
    kind: AccumulatorKind,
    form: AstNode,
    into: string | undefined,
  ): AccumulatorState => {
    const state: AccumulatorState = {
      kind,
      form,
      into,
      list: [],
      total: 0,
      best: undefined,
    };
    all.push(state);
    return state;
  };

  const walk = (list: LoopClause[]): void => {
    for (const clause of list) {
      if (clause.kind === "main") {
        const main = clause.main;
        if (
          main.kind === "collect" ||
          main.kind === "append" ||
          main.kind === "sum" ||
          main.kind === "count" ||
          main.kind === "maximize" ||
          main.kind === "minimize"
        ) {
          if (main.into !== undefined) {
            byForm.set(main.form, create(main.kind, main.form, main.into));
            continue;
          }
          const shared = implicit.get(main.kind);
          byForm.set(
            main.form,
            shared ?? create(main.kind, main.form, undefined),
          );
          if (shared === undefined)
            implicit.set(main.kind, byForm.get(main.form)!);
        }
      } else if (clause.kind === "conditional") {
        walk(clause.then);
        walk(clause.otherwise);
      }
    }
  };

  walk(clauses);
  return { all, byForm, implicit };
}

function accumulatorValue(accumulator: AccumulatorState): LispValue {
  if (accumulator.kind === "collect" || accumulator.kind === "append")
    return listToValue(accumulator.list);
  if (accumulator.kind === "sum" || accumulator.kind === "count")
    return { kind: "number", value: accumulator.total };
  if (accumulator.kind === "maximize" || accumulator.kind === "minimize")
    return accumulator.best === undefined
      ? NIL
      : { kind: "number", value: accumulator.best };
  return NIL;
}

// The clause's own form is evaluated, not the accumulator's: clauses that share
// an implicit accumulator each have their own expression.
function accumulate(
  accumulator: AccumulatorState,
  form: AstNode,
  scope: Env,
): void {
  const value = evaluate(form, scope);

  switch (accumulator.kind) {
    case "collect":
      accumulator.list.push(value);
      break;
    case "append":
      accumulator.list.push(...consForm(value));
      break;
    case "sum":
      accumulator.total += expectNumber(value);
      break;
    case "count":
      if (isTruthy(value)) accumulator.total += 1;
      break;
    case "maximize": {
      const number = expectNumber(value);
      if (accumulator.best === undefined || number > accumulator.best)
        accumulator.best = number;
      break;
    }
    case "minimize": {
      const number = expectNumber(value);
      if (accumulator.best === undefined || number < accumulator.best)
        accumulator.best = number;
      break;
    }
  }

  if (accumulator.into !== undefined)
    define(scope, accumulator.into, accumulatorValue(accumulator));
}

function runClause(
  clause: LoopClause,
  scope: Env,
  accumulation: Accumulators,
): void {
  if (clause.kind === "main") {
    const main = clause.main;
    if (main.kind === "do") {
      for (const form of main.forms) evaluate(form, scope);
      return;
    }
    if (main.kind === "return") throw new ReturnSignal(evaluate(main.form, scope));

    const accumulator = accumulation.byForm.get(main.form);
    if (accumulator !== undefined) accumulate(accumulator, main.form, scope);
    return;
  }

  if (clause.kind !== "conditional") return;

  const truthy = isTruthy(evaluate(clause.form, scope));
  const runsThen = clause.test === "unless" ? !truthy : truthy;
  const body = runsThen ? clause.then : clause.otherwise;

  for (const inner of body) runClause(inner, scope, accumulation);
}

function collectClauses(
  clauses: LoopClause[],
  match: (clause: LoopClause) => boolean,
): LoopClause[] {
  return clauses.filter(match);
}

function listToValue(items: LispValue[]): LispValue {
  let result: LispValue = NIL;
  for (let index = items.length - 1; index >= 0; index -= 1)
    result = cons(items[index]!, result);
  return result;
}


// WITH-OUTPUT-TO-STRING binds a string output stream for the body and returns
// everything the write functions appended to it.
function evalWithOutputStream(form: ListNode, env: Env): LispValue {
  const binding = form.children[1];
  if (binding === undefined || binding.kind !== "list" || binding.children[0] === undefined)
    throw new LispEvalError(
      "malformed-form",
      form.start,
      "with-output-to-string needs (variable) before its body",
    );

  const name = symbolName(binding.children[0]);
  if (name === undefined)
    throw new LispEvalError(
      "malformed-form",
      form.start,
      "with-output-to-string needs a variable name",
    );

  const stream: StreamValue = { kind: "stream", chunks: [] };
  const scope = createEnv(env);
  define(scope, name, stream);
  evaluateBody(form.children.slice(2), scope);

  return { kind: "string", value: stream.chunks.join("") };
}

// (with-hash-table-iterator (next table) body…) binds NEXT to a function of no
// arguments that hands back three values — true, key, value — until the table is
// exhausted. It needs the evaluator because it builds a closure over the entries.
function evalWithHashTableIterator(form: ListNode, env: Env): LispValue {
  const spec = form.children[1];
  if (spec === undefined || spec.kind !== "list" || spec.children.length !== 2)
    throw new LispEvalError(
      "malformed-form",
      form.start,
      "with-hash-table-iterator needs (function table) before its body",
    );

  const nameNode = spec.children[0];
  const tableNode = spec.children[1];
  const name = nameNode === undefined ? undefined : symbolName(nameNode);
  if (name === undefined)
    throw new LispEvalError(
      "malformed-form",
      form.start,
      "with-hash-table-iterator needs a function name",
    );

  const table = expectHashTable(evaluate(tableNode!, env));
  const entries = [...table.entries.values()];
  let cursor = 0;

  const next: BuiltInValue = {
    kind: "builtin",
    name,
    min: 0,
    max: 0,
    fn: () => {
      const entry = entries[cursor];
      if (entry === undefined) return NIL;
      cursor += 1;
      return { kind: "values", values: [intern("T"), entry.key, entry.value] };
    },
  };

  const scope = createEnv(env);
  define(scope, name, next);
  return evaluateBody(form.children.slice(2), scope);
}
// The body's last form is evaluated without taking the primary value, so the
// call observer can report all of them.
function evaluateBodyRaw(forms: AstNode[], env: Env): LispValue {
  if (forms.length === 0) return NIL;
  let result: LispValue = NIL;
  for (let index = 0; index < forms.length - 1; index += 1)
    result = evaluate(forms[index]!, env);
  return evaluateRaw(forms[forms.length - 1]!, env);
}


// MULTIPLE-VALUE-BIND binds one name per value, NIL for any the form did not
// provide; MULTIPLE-VALUE-SETQ assigns existing names; MULTIPLE-VALUE-LIST
// collects every value into a list.
function evalMultipleValueBind(form: ListNode, env: Env): LispValue {
  const bindings = form.children[1];
  const valueForm = form.children[2];
  if (bindings === undefined || bindings.kind !== "list" || valueForm === undefined)
    throw new LispEvalError(
      "malformed-form",
      form.start,
      "multiple-value-bind needs (names) and a form",
    );

  const values = evaluateValues(valueForm, env);
  const scope = createEnv(env);

  for (let index = 0; index < bindings.children.length; index += 1) {
    const name = symbolName(bindings.children[index]!);
    if (name === undefined)
      throw new LispEvalError(
        "malformed-form",
        form.start,
        "multiple-value-bind needs variable names",
      );
    define(scope, name, values[index] ?? NIL);
  }

  return evaluateBody(form.children.slice(3), scope);
}

function evalMultipleValueSetq(form: ListNode, env: Env): LispValue {
  const names = form.children[1];
  const valueForm = form.children[2];
  if (names === undefined || names.kind !== "list" || valueForm === undefined)
    throw new LispEvalError(
      "malformed-form",
      form.start,
      "multiple-value-setq needs (names) and a form",
    );

  const values = evaluateValues(valueForm, env);

  for (let index = 0; index < names.children.length; index += 1) {
    const name = symbolName(names.children[index]!);
    if (name === undefined)
      throw new LispEvalError(
        "malformed-form",
        form.start,
        "multiple-value-setq needs variable names",
      );
    const value = values[index] ?? NIL;
    if (!assign(env, name, value)) define(env, name, value);
  }

  return values[0] ?? NIL;
}

function evalMultipleValueList(form: ListNode, env: Env): LispValue {
  const valueForm = form.children[1];
  if (valueForm === undefined)
    throw new LispEvalError(
      "malformed-form",
      form.start,
      "multiple-value-list needs a form",
    );
  return listToValue(evaluateValues(valueForm, env));
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

// DEFSTRUCT — the type, its slots, and the four names CL generates from it: the
// keyword constructor MAKE-NAME, the predicate NAME-P, the copier COPY-NAME and
// one accessor per slot. Only the :conc-name option is modelled; :include and
// friends are Lispnt's gap and say so rather than being ignored.
function evalDefstruct(form: ListNode, env: Env): LispValue {
  const header = form.children[1];
  if (header === undefined)
    throw new LispEvalError("malformed-form", form.start, "defstruct needs a name");

  const headerName = header.kind === "list" ? header.children[0] : header;
  const typeName = headerName === undefined ? undefined : symbolName(headerName);
  if (typeName === undefined)
    throw new LispEvalError(
      "malformed-form",
      form.start,
      "defstruct needs a name",
    );

  let concName = `${typeName}-`;
  if (header.kind === "list") {
    for (const option of header.children.slice(1)) {
      if (option.kind !== "list" || option.children[0] === undefined)
        throw new LispEvalError(
          "malformed-form",
          option.start,
          "defstruct options are written as (name value)",
        );

      const key = String(symbolName(option.children[0]) ?? "").toUpperCase();
      if (key !== ":CONC-NAME")
        throw new LispEvalError(
          "unsupported-standard",
          option.start,
          `defstruct option ${key} is not implemented`,
        );

      const valueNode = option.children[1];
      if (valueNode === undefined)
        throw new LispEvalError(
          "malformed-form",
          option.start,
          "defstruct :conc-name needs a value",
        );

      if (valueNode.kind !== "atom")
        throw new LispEvalError(
          "unsupported-standard",
          valueNode.start,
          "defstruct :conc-name takes a symbol, a string or nil",
        );

      const prefix = String(valueNode.value);
      concName = prefix.toUpperCase() === "NIL" ? "" : prefix.toUpperCase();
    }
  }

  const slots: Array<{ name: string; defaultNode?: AstNode }> = [];
  for (const slotNode of form.children.slice(2)) {
    if (slotNode.kind === "atom") {
      const name = symbolName(slotNode);
      if (name === undefined)
        throw new LispEvalError(
          "malformed-form",
          slotNode.start,
          "defstruct slots need a name",
        );
      slots.push({ name });
      continue;
    }

    if (slotNode.kind !== "list" || slotNode.children[0] === undefined)
      throw new LispEvalError(
        "malformed-form",
        slotNode.start,
        "defstruct slots are written as name or (name default)",
      );

    const name = symbolName(slotNode.children[0]);
    if (name === undefined)
      throw new LispEvalError(
        "malformed-form",
        slotNode.start,
        "defstruct slots need a name",
      );

    if (slotNode.children.length > 2)
      throw new LispEvalError(
        "unsupported-standard",
        slotNode.children[2]!.start,
        "defstruct slot options (such as :type or :read-only) are not implemented",
      );

    const defaultNode = slotNode.children[1];
    if (defaultNode === undefined) slots.push({ name });
    else slots.push({ name, defaultNode });
  }

  const constructorName = `MAKE-${typeName}`;
  const predicateName = `${typeName}-P`;
  const copierName = `COPY-${typeName}`;

  // The constructor runs through the same keyword binder a (&key …) function
  // uses, so the two cannot drift apart. A keyword that names no slot is the
  // caller's mistake, not a missing piece of syntax.
  const keys: KeywordParameter[] = slots.map((slot) =>
    slot.defaultNode === undefined
      ? { keyword: `:${slot.name}`, name: slot.name }
      : { keyword: `:${slot.name}`, name: slot.name, default: slot.defaultNode },
  );

  const construct: BuiltInValue["fn"] = (args) => {
    const scope = createEnv(env);
    bindKeywordArguments(keys, args, scope, constructorName);

    const values = new Map<string, LispValue>();
    for (const slot of slots) values.set(slot.name, lookup(scope, slot.name) ?? NIL);

    return { kind: "struct", type: typeName, slots: values };
  };

  define(env, constructorName, {
    kind: "builtin",
    name: constructorName,
    min: 0,
    max: null,
    fn: construct,
  });

  define(env, predicateName, {
    kind: "builtin",
    name: predicateName,
    min: 1,
    max: 1,
    fn: (args) =>
      args[0]!.kind === "struct" && args[0]!.type === typeName
        ? intern("T")
        : NIL,
  });

  define(env, copierName, {
    kind: "builtin",
    name: copierName,
    min: 1,
    max: 1,
    fn: (args) => {
      const source = expectStruct(args[0]!, typeName, copierName);
      return { kind: "struct", type: typeName, slots: new Map(source.slots) };
    },
  });

  for (const slot of slots) {
    const accessorName = `${concName}${slot.name}`;
    define(env, accessorName, {
      kind: "builtin",
      name: accessorName,
      min: 1,
      max: 1,
      accessor: { type: typeName, slot: slot.name },
      fn: (args) => {
        const target = expectStruct(args[0]!, typeName, accessorName);
        return target.slots.get(slot.name) ?? NIL;
      },
    });
  }

  structTypeNames.add(typeName);
  return intern(typeName);
}

export function expectStruct(
  value: LispValue,
  type: string,
  name: string,
): StructValue {
  if (value.kind !== "struct" || value.type !== type)
    throw new LispEvalError(
      "type-error",
      null,
      `${name}: expected a ${type}, got ${value.kind === "struct" ? value.type : value.kind}`,
    );
  return value;
}

// A defstruct accessor used as a place: (setf (lc node) 5). The struct is
// evaluated once, as a place's subforms are in CL.
function resolveAccessorPlace(
  node: ListNode,
  env: Env,
): Place | undefined {
  const head = node.children[0];
  const name = head === undefined ? undefined : symbolName(head);
  if (name === undefined) return undefined;

  const callable = lookup(env, name);
  if (callable === undefined || callable.kind !== "builtin") return undefined;
  const accessor = callable.accessor;
  if (accessor === undefined) return undefined;

  const objectNode = node.children[1];
  if (objectNode === undefined)
    throw new LispEvalError(
      "malformed-form",
      null,
      `${callable.name} needs an object to read`,
    );

  const target = expectStruct(evaluate(objectNode, env), accessor.type, callable.name);
  return {
    get: () => target.slots.get(accessor.slot) ?? NIL,
    set: (value) => {
      target.slots.set(accessor.slot, value);
    },
  };
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
    if (node.atomType === "char")
      return { kind: "char", value: String(node.value) };

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







