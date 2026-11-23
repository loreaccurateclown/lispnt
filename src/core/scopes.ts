import { builtins } from "./builtins";
import type { AstNode, ListNode, Position } from "./reader";
import { STANDARD_SYMBOLS } from "./standard-symbols";

export type BindingKind =
  | "parameter"
  | "local"
  | "global"
  | "function"
  | "builtin"
  | "standard";

export interface Binding {
  readonly name: string;
  readonly kind: BindingKind;
  readonly position?: Position;
  readonly parameterCount?: number;
}

export interface Scope {
  readonly variables: Map<string, Binding>;
  readonly functions: Map<string, Binding>;
  readonly parent: Scope | null;
}

export interface FileSymbols {
  readonly variables: Map<string, Binding>;
  readonly functions: Map<string, Binding>;
  readonly loadsAnotherFile: boolean;
}

export function collectSymbols(forms: AstNode[]): FileSymbols {
  const variables = new Map<string, Binding>();
  const functions = new Map<string, Binding>();

  const loadsAnotherFile = forms.some((form) => headName(form) === "LOAD");

  for (const form of forms) collectFromNode(form, variables, functions);

  return { variables, functions, loadsAnotherFile };
}

export function createFileScope(symbols: FileSymbols): Scope {
  const variables = new Map(symbols.variables);
  const functions = new Map(symbols.functions);

  for (const [name, builtin] of builtins) {
    if (functions.has(name)) continue;
    functions.set(name, { name, kind: "builtin" });
  }

  for (const name of STANDARD_SYMBOLS) {
    if (functions.has(name)) continue;
    functions.set(name, { name, kind: "standard" });
  }

  variables.set("T", { name: "T", kind: "global" });
  variables.set("NIL", { name: "NIL", kind: "global" });

  return { variables, functions, parent: null };
}

export function walkWithScopes(
  forms: AstNode[],
  scope: Scope,
  onForm: (node: AstNode, scope: Scope) => void,
): void {
  function visit(node: AstNode, current: Scope): void {
    if (node.kind === "quote") return;

    onForm(node, current);

    if (node.kind === "atom") return;
    // #( ... ) contents are data, not forms.
    if (node.prefix !== undefined) return;

    switch (headName(node)) {
      case "DEFUN":
        visitDefun(node, current);
        return;
      case "LAMBDA":
        visitLambda(node, current);
        return;
      case "LET":
        visitLet(node, current, false);
        return;
      case "LET*":
        visitLet(node, current, true);
        return;
      case "FLET":
        visitLocalFunctions(node, current, false);
        return;
      case "LABELS":
        visitLocalFunctions(node, current, true);
        return;
      case "DOLIST":
      case "DOTIMES":
        visitLoop(node, current);
        return;
      case "COND":
        visitConditional(node, current);
        return;
      case "FUNCTION":
        visitFunctionForm(node, current);
        return;
      case "LOOP":
        visitLoopForm(node, current);
        return;
      case "DEFPARAMETER":
      case "DEFVAR":
      case "DEFCONSTANT":
        visitDefinition(node, current);
        return;
      default: {
        // A head symbol is a function position, not a variable reference.
        const head = node.children[0];
        const first = head !== undefined && isSymbolNode(head) ? 1 : 0;

        for (const child of node.children.slice(first)) visit(child, current);
        if (node.tail !== undefined) visit(node.tail, current);
      }
    }
  }

  function visitDefun(node: ListNode, current: Scope): void {
    const parameters = parameterNodes(node.children[2]);
    const inner = withParameters(current, parameters);

    for (const form of node.children.slice(3)) visit(form, inner);
  }

  function visitLambda(node: ListNode, current: Scope): void {
    const parameters = parameterNodes(node.children[1]);
    const inner = withParameters(current, parameters);

    for (const form of node.children.slice(2)) visit(form, inner);
  }

  function visitLet(node: ListNode, current: Scope, sequential: boolean): void {
    const bindingsNode = node.children[1];
    const bindings =
      bindingsNode !== undefined && bindingsNode.kind === "list"
        ? bindingPairs(bindingsNode)
        : [];

    const inner = childScope(current);

    for (const [nameNode, valueNode] of bindings) {
      // let evaluates every value in the enclosing scope; let* uses the scope
      // it is building, so earlier names are already visible.
      if (valueNode !== undefined) visit(valueNode, sequential ? inner : current);
      if (sequential) bindVariable(inner, nameNode, "local");
    }

    if (!sequential) {
      for (const [nameNode] of bindings) bindVariable(inner, nameNode, "local");
    }

    for (const form of node.children.slice(2)) visit(form, inner);
  }

  function visitLocalFunctions(
    node: ListNode,
    current: Scope,
    recursive: boolean,
  ): void {
    const definitionsNode = node.children[1];
    const inner = childScope(current);

    const definitions: ListNode[] = [];
    if (definitionsNode !== undefined && definitionsNode.kind === "list") {
      for (const definition of definitionsNode.children) {
        if (definition.kind === "list") definitions.push(definition);
      }
    }

    for (const definition of definitions) {
      const nameNode = definition.children[0];
      if (nameNode === undefined || !isSymbolNode(nameNode)) continue;
      inner.functions.set(symbolText(nameNode), {
        name: symbolText(nameNode),
        kind: "function",
        position: nameNode.start,
        parameterCount: parameterNodes(definition.children[1]).length,
      });
    }

    for (const definition of definitions) {
      const parameters = parameterNodes(definition.children[1]);
      // flet definitions are evaluated outside their own bindings; labels ones
      // can see themselves and each other.
      const definitionsScope = recursive ? inner : current;
      const bodyScope = withParameters(definitionsScope, parameters);

      for (const form of definition.children.slice(2)) visit(form, bodyScope);
    }

    for (const form of node.children.slice(2)) visit(form, inner);
  }

  function visitLoop(node: ListNode, current: Scope): void {
    const specNode = node.children[1];
    const inner = childScope(current);

    if (specNode !== undefined && specNode.kind === "list") {
      const [counterNode, listNode, resultNode] = specNode.children;

      // The iterated form and the result form run in the enclosing scope.
      if (listNode !== undefined) visit(listNode, current);
      if (resultNode !== undefined) visit(resultNode, current);

      bindVariable(inner, counterNode, "local");
    }

    for (const form of node.children.slice(2)) visit(form, inner);
  }

  function visitDefinition(node: ListNode, current: Scope): void {
    const valueNode = node.children[2];
    if (valueNode !== undefined) visit(valueNode, current);
  }

  function visitConditional(node: ListNode, current: Scope): void {
    for (const clause of node.children.slice(1)) {
      // A clause is (test form*): its first element is a form in test
      // position, not a call.
      if (clause.kind === "list" && clause.prefix === undefined) {
        for (const form of clause.children) visit(form, current);
      } else {
        visit(clause, current);
      }
    }
  }

  function visitFunctionForm(node: ListNode, current: Scope): void {
    // (function f) names a function; (function (lambda ...)) is code.
    const target = node.children[1];
    if (target !== undefined && target.kind === "list") visit(target, current);
  }

  function visitLoopForm(node: ListNode, current: Scope): void {
    const inner = childScope(current);
    const tokens = node.children.slice(1);

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === undefined) continue;

      const word = symbolWord(token);

      if (word === "FOR" || word === "AS" || word === "WITH" || word === "AND") {
        const candidate = tokens[index + 1];
        const candidateWord =
          candidate !== undefined ? symbolWord(candidate) : undefined;

        if (
          candidate !== undefined &&
          isSymbolNode(candidate) &&
          (candidateWord === undefined || !LOOP_KEYWORDS.has(candidateWord))
        ) {
          bindVariable(inner, candidate, "local");
        }
      }

      if (token.kind === "list") visit(token, inner);
    }
  }

  for (const form of forms) visit(form, scope);
}

export function lookupVariable(
  scope: Scope,
  name: string,
): Binding | undefined {
  let current: Scope | null = scope;
  while (current !== null) {
    const binding = current.variables.get(name);
    if (binding !== undefined) return binding;
    current = current.parent;
  }
  return undefined;
}

export function lookupFunction(
  scope: Scope,
  name: string,
): Binding | undefined {
  let current: Scope | null = scope;
  while (current !== null) {
    const binding = current.functions.get(name);
    if (binding !== undefined) return binding;
    current = current.parent;
  }
  return undefined;
}

function collectFromNode(
  node: AstNode,
  variables: Map<string, Binding>,
  functions: Map<string, Binding>,
): void {
  if (node.kind === "quote") return;
  if (node.kind === "atom") return;
  if (node.prefix !== undefined) return;

  const head = headName(node);

  if (head === "DEFUN") {
    const nameNode = node.children[1];
    if (nameNode !== undefined && isSymbolNode(nameNode)) {
      functions.set(symbolText(nameNode), {
        name: symbolText(nameNode),
        kind: "function",
        position: nameNode.start,
        parameterCount: parameterNodes(node.children[2]).length,
      });
    }
  }

  if (
    head === "DEFPARAMETER" ||
    head === "DEFVAR" ||
    head === "DEFCONSTANT"
  ) {
    const nameNode = node.children[1];
    if (nameNode !== undefined && isSymbolNode(nameNode)) {
      variables.set(symbolText(nameNode), {
        name: symbolText(nameNode),
        kind: "global",
        position: nameNode.start,
      });
    }
  }

  for (const child of node.children) collectFromNode(child, variables, functions);
  if (node.tail !== undefined) collectFromNode(node.tail, variables, functions);
}

function childScope(parent: Scope): Scope {
  return { variables: new Map(), functions: new Map(), parent };
}

function withParameters(scope: Scope, parameters: AstNode[]): Scope {
  const inner = childScope(scope);
  for (const parameter of parameters) bindVariable(inner, parameter, "parameter");
  return inner;
}

function bindVariable(scope: Scope, node: AstNode | undefined, kind: "local" | "parameter"): void {
  if (node === undefined || !isSymbolNode(node)) return;
  scope.variables.set(symbolText(node), {
    name: symbolText(node),
    kind,
    position: node.start,
  });
}

function bindingPairs(bindingsNode: ListNode): Array<[AstNode | undefined, AstNode | undefined]> {
  const pairs: Array<[AstNode | undefined, AstNode | undefined]> = [];

  for (const binding of bindingsNode.children) {
    if (binding.kind === "list" && binding.prefix === undefined) {
      pairs.push([binding.children[0], binding.children[1]]);
    } else {
      pairs.push([binding, undefined]);
    }
  }

  return pairs;
}

function parameterNodes(node: AstNode | undefined): AstNode[] {
  if (node === undefined || node.kind !== "list") return [];
  return node.children;
}

function headName(node: AstNode): string | undefined {
  if (node.kind !== "list") return undefined;
  if (node.prefix !== undefined) return undefined;

  const head = node.children[0];
  if (head === undefined || !isSymbolNode(head)) return undefined;
  return symbolText(head);
}

function isSymbolNode(node: AstNode | undefined): boolean {
  return node !== undefined && node.kind === "atom" && node.atomType === "symbol";
}

function symbolWord(node: AstNode): string | undefined {
  return isSymbolNode(node) ? symbolText(node) : undefined;
}

function symbolText(node: AstNode): string {
  return String(node.kind === "atom" ? node.value : "").toUpperCase();
}

const LOOP_KEYWORDS: ReadonlySet<string> = new Set([
  "FOR",
  "AS",
  "WITH",
  "AND",
  "IN",
  "ON",
  "ACROSS",
  "FROM",
  "TO",
  "BELOW",
  "ABOVE",
  "BY",
  "WHILE",
  "UNTIL",
  "REPEAT",
  "DO",
  "DOING",
  "COLLECT",
  "COLLECTING",
  "SUM",
  "SUMMING",
  "COUNT",
  "COUNTING",
  "MAXIMIZE",
  "MAXIMIZING",
  "MINIMIZE",
  "MINIMIZING",
  "APPEND",
  "APPENDING",
  "NCONC",
  "INITIALLY",
  "FINALLY",
  "RETURN",
  "INTO",
]);
