import {
  NIL,
  cons,
  intern,
  isNil,
  Env,
  isTruthy,
  type LispValue,
  FunctionValue,
} from "./values";
import type { AstNode, AtomNode, ListNode } from "./reader";

export function createEnv(parent: Env | null): Env {
  const env = { vars: new Map(), parent };
  if (parent === null) {
    env.vars.set("T", intern("T"));
    env.vars.set("NIL", NIL);
  }
  return env;
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

export function applyFunction(fn: FunctionValue, args: LispValue[]): LispValue {
  if (args.length !== fn.params.length) {
    throw new Error(
      `${fn.name} expects ${fn.params.length} argument(s), got ${args.length}`,
    );
  }

  const scope = createEnv(fn.env);
  for (let index = 0; index < fn.params.length; index += 1) {
    define(scope, fn.params[index]!, args[index]!);
  }
  return evaluateBody(fn.body, scope);
}

function evalCall(form: ListNode, env: Env): LispValue {
  const head = form.children[0];
  if (head === undefined) return NIL;

  const callable = evaluate(head, env);
  if (callable.kind !== "function") throw new Error(`not a function: ${String(callable.kind)}`);

  const args = form.children.slice(1).map((argument) => evaluate(argument, env)); // slice(1): drop the head symbol, keep the argument forms
  return applyFunction(callable, args);
}

function designatedFunction(node: AstNode, env: Env): LispValue {
  const name = symbolName(node);

  if (name === undefined || !name.startsWith("#'")) throw new Error("not a function designator");
  const target = lookup(env, name.slice(2)); // slice(2): strip the leading "#'" to get the bare function name
  if (target === undefined  ) throw new Error(`undefined function: ${name.slice(2)}`); // slice(2): same strip, this time for the error text

  return target;
}

export function evaluate(node: AstNode, env: Env): LispValue {
  if (node.kind === "quote") return astToValue(node.target);
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
      case "PROGN":
        return evaluateBody(node.children.slice(1), env); // slice(1): drop "progn", keep the body forms
      case "LET":
        return evalLet(node, env, false);
      case "LET*":
        return evalLet(node, env, true);
      case "DEFUN":
        return evalDefun(node, env);
      case "DEFPARAMETER":
      case "DEFVAR":
        return evalDefParameter(node, env);
      case "SETQ":
        return evalSetQ(node, env);
      default:
        return evalCall(node, env);
    }
  }
  //node is AtomNode
  const raw = String(node.value);
  if (raw.startsWith("#'")) return designatedFunction(node, env);

  if (node.atomType === "number")
    return { kind: "number", value: Number(node.value) };
  if (node.atomType === "string")
    return { kind: "string", value: String(node.value) };

  const value = lookup(env, String(node.value));
  if (value === undefined)
    throw new Error(`unbound variable: ${String(node.value)}`); //placeholder

  return value;
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

  if (test === undefined) throw new Error("if needs test");
  if (!isTruthy(evaluate(test, env)))
    return otherwise === undefined ? NIL : evaluate(otherwise, env);
  //this feels very strange
  return then === undefined ? NIL : evaluate(then, env);
}

function evalCond(form: ListNode, env: Env): LispValue {
  for (const clauseNode of form.children.slice(1)) { // slice(1): drop "cond", keep the clause forms
    if (clauseNode.kind !== "list")
      throw new Error("cond clause must be a list");
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
    throw new Error("let needs a bindings list");

  const scope = createEnv(env);
  for (const bindingNode of bindingsNode.children) {
    if (bindingNode.kind === "atom") {
      const name = symbolName(bindingNode);
      if (name === undefined)
        throw new Error("evalLet: bindingNode has no name");
      define(scope, name, NIL);
      continue;
    } //to be real i have no idea what any of this is doing. I have several guesses, but nothing concrete.
    if (bindingNode.kind !== "list") throw new Error("binding must be a list");
    const nameNode = bindingNode.children[0];
    const valueNode = bindingNode.children[1];
    const name = nameNode === undefined ? undefined : symbolName(nameNode);

    if (name === undefined) throw new Error("binding needs a symbol name");

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
    throw new Error("defun needs a name and an argument list");

  const params: string[] = [];

  for (const paramNode of paramsNode.children) {
    const param = symbolName(paramNode);
    if (param === undefined) throw new Error("parameter must be a symbol");
    params.push(param);
  }

  //placeholder until 3.3
  define(env, name, {
    kind: "function",
    name,
    params,
    body: form.children.slice(3), // slice(3): drop "defun", the name and the parameter list, keep the body
    env,
  });

  return intern(name);
}

function evalDefParameter(form: ListNode, env: Env): LispValue {
  const nameNode = form.children[1];

  const name = nameNode === undefined ? undefined : symbolName(nameNode);
  if (name === undefined) throw new Error("evalDefParameter: name not defined");

  const valueNode = form.children[2];
  define(env, name, valueNode === undefined ? NIL : evaluate(valueNode, env));

  return intern(name);
}

function assign(env: Env, name: string, value: LispValue  ): boolean {
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
      throw new Error("evalDefParameter: name not defined");
    result = evaluate(form.children[index + 1]!, env); //! before in js, ! after in ts. #wow
    if (!assign(env, name, result)) define(env,name,result);
    index += 2;
  }
  return result;
}

function evalAnd(form: ListNode, env: Env): LispValue {
  let result: LispValue = intern("T");
  for (const operand of form.children.slice(1)) { // slice(1): drop "and", keep the operands
    result = evaluate(operand, env);
    if (!isTruthy(result)) return NIL;
  }
  return result;
}

function evalOr(form: ListNode, env: Env): LispValue {
  let result: LispValue = NIL;
  for (const operand of form.children.slice(1)) { // slice(1): drop "or", keep the operands
    result = evaluate(operand, env);
    if (isTruthy(result)) return result;
  }
  return result;
}

function evalWhen(form: ListNode, env: Env): LispValue {
  const testNode = form.children[1];
  if (testNode === undefined) throw new Error("when needs a test");
  if (!isTruthy(evaluate(testNode, env))) return NIL;
  return evaluateBody(form.children.slice(2), env); // slice(2): drop "when" and the test, keep the body
}

function evalUnless(form: ListNode, env: Env): LispValue {
  const testNode = form.children[1];
  if (testNode === undefined) throw new Error("unless needs a test");
  if (isTruthy(evaluate(testNode, env))) return NIL;
  return evaluateBody(form.children.slice(2), env); // slice(2): drop "unless" and the test, keep the body
}

export function astToValue(node: AstNode): LispValue {
  if (node.kind === "quote") {
    //''x is the data (quote x)
    return cons(intern("QUOTE"), cons(astToValue(node.target), NIL));
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
