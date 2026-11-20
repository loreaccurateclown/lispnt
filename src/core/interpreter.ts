import { NIL, cons, intern, isNil, type LispValue } from "./values";
import type { AstNode, AtomNode, ListNode } from "./reader";

interface Env {
  vars: Map<string, LispValue>;
  parent: Env | null;
}

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

export function evaluate(node: AstNode, env: Env): LispValue {
  if (node.kind === "quote") return astToValue(node.target);
  if (node.kind === "list")
    throw new Error("evaluate: lists not implemented yet"); //placeholder

  //node is AtomNode
  if (node.atomType === "number")
    return { kind: "number", value: Number(node.value) };
  if (node.atomType === "string")
    return { kind: "string", value: String(node.value) };

  const value = lookup(env, String(node.value));
  if (value === undefined)
    throw new Error(`unbound variable: ${String(node.value)}`); //placeholder

  return value;
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
