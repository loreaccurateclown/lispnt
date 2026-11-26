import { builtins } from "./builtins";
import { CONSTANTS } from "./constants";
import type { AstNode, ListNode, Position } from "./reader";
import { STANDARD_SYMBOLS } from "./standard-symbols";

export type BindingKind =
  | "parameter"
  | "local"
  | "global"
  | "function"
  | "builtin"
  | "standard";

export interface Arity {
  readonly min: number;
  readonly max: number | null;
}

export interface Binding {
  readonly name: string;
  readonly kind: BindingKind;
  readonly position?: Position;
  readonly arity?: Arity;
}

export interface Scope {
  readonly variables: Map<string, Binding>;
  readonly functions: Map<string, Binding>;
  readonly parent: Scope | null;
}

export interface FileSymbols {
  readonly variables: Map<string, Binding>;
  readonly functions: Map<string, Binding>;
  readonly definitionCounts: Map<string, number>;
  readonly loadsAnotherFile: boolean;
  readonly unmodelledStructures: boolean;
}

export function collectSymbols(forms: AstNode[]): FileSymbols {
  const variables = new Map<string, Binding>();
  const functions = new Map<string, Binding>();
  const definitionCounts = new Map<string, number>();
  const flags = { unmodelled: false };

  const loadsAnotherFile = forms.some((form) => headName(form) === "LOAD");

  for (const form of forms) {
    collectFromNode(form, variables, functions, definitionCounts, flags);
  }

  return {
    variables,
    functions,
    definitionCounts,
    loadsAnotherFile,
    unmodelledStructures: flags.unmodelled,
  };
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
  // The standard constants are bound before user code runs, so reading one is
  // never a name mistake.
  for (const name of CONSTANTS.keys()) {
    if (!variables.has(name)) variables.set(name, { name, kind: "global" });
  }

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
      case "DEFSTRUCT":
        visitDefstruct(node, current);
        return;
      case "MULTIPLE-VALUE-SETQ":
        visitMultipleValueSetq(node, current);
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
      case "DO":
        visitDo(node, current, false);
        return;
      case "DO*":
        visitDo(node, current, true);
        return;
      case "CASE":
      case "ECASE":
      case "CCASE":
      case "TYPECASE":
      case "ETYPECASE":
        visitCase(node, current);
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
      case "WITH-OUTPUT-TO-STRING":
        visitStreamBinding(node, current, false);
        return;
      case "WITH-INPUT-FROM-STRING":
        visitStreamBinding(node, current, true);
        return;
      case "WITH-OPEN-FILE":
      case "WITH-OPEN-STREAM":
        visitOpenBinding(node, current);
        return;
      case "WITH-HASH-TABLE-ITERATOR":
        visitIteratorBinding(node, current);
        return;
      case "MULTIPLE-VALUE-BIND":
        visitMultipleValueBind(node, current);
        return;
      case "DESTRUCTURING-BIND":
        visitDestructuringBind(node, current);
        return;
      case "HANDLER-CASE":
        visitHandlerCase(node, current);
        return;
      case "DEFPARAMETER":
      case "DEFVAR":
      case "DEFCONSTANT":
        visitDefinition(node, current);
        return;
      default: {
        const head = node.children[0];
        const headWord = head !== undefined ? symbolWord(head) : undefined;

        // Standard forms whose syntax we do not model: descending would report
        // their binding names and clause keywords as ordinary code. Their
        // contents go unchecked until each is decoded.
        if (headWord !== undefined && OPAQUE_FORMS.has(headWord)) return;

        // A head symbol is a function position, not a variable reference.
        const first = head !== undefined && isSymbolNode(head) ? 1 : 0;

        for (const child of node.children.slice(first)) visit(child, current);
        if (node.tail !== undefined) visit(node.tail, current);
      }
    }
  }

  function visitDefun(node: ListNode, current: Scope): void {
    const parameters = parameterNodes(node.children[2]);
    const inner = withParameters(current, parameters, visit);

    for (const form of node.children.slice(3)) visit(form, inner);
  }

  // DEFSTRUCT's header names a type and its options, which are names rather than
  // code; the slot defaults are ordinary expressions, so an undefined name in one
  // is worth reporting like any other use.
  function visitDefstruct(node: ListNode, current: Scope): void {
    for (const slotNode of node.children.slice(2)) {
      if (slotNode.kind !== "list") continue;
      const defaultNode = slotNode.children[1];
      if (defaultNode !== undefined) visit(defaultNode, current);
    }
  }

  // MULTIPLE-VALUE-SETQ assigns existing names, so its targets are uses like
  // SETQ's, and its value form is code that has to be checked.
  function visitMultipleValueSetq(node: ListNode, current: Scope): void {
    const namesNode = node.children[1];
    if (namesNode !== undefined && namesNode.kind === "list") {
      for (const name of namesNode.children) visit(name, current);
    }
    const valueNode = node.children[2];
    if (valueNode !== undefined) visit(valueNode, current);
  }
  function visitLambda(node: ListNode, current: Scope): void {
    const parameters = parameterNodes(node.children[1]);
    const inner = withParameters(current, parameters, visit);

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
        arity: parseArity(definition.children[1]),
      });
    }

    for (const definition of definitions) {
      const parameters = parameterNodes(definition.children[1]);
      // flet definitions are evaluated outside their own bindings; labels ones
      // can see themselves and each other.
      const definitionsScope = recursive ? inner : current;
      const bodyScope = withParameters(definitionsScope, parameters, visit);

      for (const form of definition.children.slice(2)) visit(form, bodyScope);
    }

    for (const form of node.children.slice(2)) visit(form, inner);
  }

  function visitLoop(node: ListNode, current: Scope): void {
    const specNode = node.children[1];
    const inner = childScope(current);

    if (specNode !== undefined && specNode.kind === "list") {
      const [counterNode, listNode, resultNode] = specNode.children;

      bindVariable(inner, counterNode, "local");

      // The iterated form runs in the enclosing scope; the result form runs
      // with the counter still bound, as in Common Lisp.
      if (listNode !== undefined) visit(listNode, current);
      if (resultNode !== undefined) visit(resultNode, inner);
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
    let codeFollows = false;

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === undefined) continue;

      const word = symbolWord(token);

      if (
        word === "FOR" ||
        word === "AS" ||
        word === "WITH" ||
        word === "AND" ||
        word === "INTO"
      ) {
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

      if (token.kind === "list") {
        if (codeFollows) visit(token, inner);
        // Not code: a clause list such as (hash-value v). Its symbols are the
        // names the clause binds, so bind them rather than walking them.
        else bindSymbols(inner, token);

        codeFollows = false;
        continue;
      }

      codeFollows = word !== undefined && LOOP_CODE_KEYWORDS.has(word);
    }
  }

  function visitDo(node: ListNode, current: Scope, sequential: boolean): void {
    const bindingsNode = node.children[1];
    const endNode = node.children[2];
    const inner = childScope(current);
    const bindings: Array<
      [AstNode | undefined, AstNode | undefined, AstNode | undefined]
    > = [];

    if (bindingsNode !== undefined && bindingsNode.kind === "list") {
      for (const binding of bindingsNode.children) {
        if (binding.kind === "list" && binding.prefix === undefined) {
          bindings.push([
            binding.children[0],
            binding.children[1],
            binding.children[2],
          ]);
        } else {
          bindings.push([binding, undefined, undefined]);
        }
      }
    }

    for (const [nameNode, initNode] of bindings) {
      // do evaluates every init before binding; do* binds as it goes.
      if (initNode !== undefined) visit(initNode, sequential ? inner : current);
      if (sequential) bindVariable(inner, nameNode, "local");
    }

    if (!sequential) {
      for (const [nameNode] of bindings) bindVariable(inner, nameNode, "local");
    }

    if (endNode !== undefined && endNode.kind === "list") {
      const [testNode, ...resultNodes] = endNode.children;
      if (testNode !== undefined) visit(testNode, inner);
      for (const resultNode of resultNodes) visit(resultNode, inner);
    }

    for (const [, , stepNode] of bindings) {
      if (stepNode !== undefined) visit(stepNode, inner);
    }

    for (const form of node.children.slice(3)) visit(form, inner);
  }

  function visitCase(node: ListNode, current: Scope): void {
    const keyNode = node.children[1];
    if (keyNode !== undefined) visit(keyNode, current);

    for (const clause of node.children.slice(2)) {
      if (clause.kind === "list" && clause.prefix === undefined) {
        // The first element holds the keys or a type spec, not code.
        for (const form of clause.children.slice(1)) visit(form, current);
      } else {
        visit(clause, current);
      }
    }
  }

  function visitStreamBinding(
    node: ListNode,
    current: Scope,
    hasValue: boolean,
  ): void {
    const spec = node.children[1];
    const inner = childScope(current);

    if (spec !== undefined && spec.kind === "list") {
      const [varNode, valueNode] = spec.children;
      // with-input-from-string takes the string to read from first.
      if (hasValue && valueNode !== undefined) visit(valueNode, current);
      bindVariable(inner, varNode, "local");
    }

    for (const form of node.children.slice(2)) visit(form, inner);
  }

  function visitOpenBinding(node: ListNode, current: Scope): void {
    const spec = node.children[1];
    const inner = childScope(current);

    if (spec !== undefined && spec.kind === "list") {
      const [varNode, ...optionNodes] = spec.children;
      for (const optionNode of optionNodes) visit(optionNode, current);
      bindVariable(inner, varNode, "local");
    }

    for (const form of node.children.slice(2)) visit(form, inner);
  }

  function visitIteratorBinding(node: ListNode, current: Scope): void {
    const spec = node.children[1];
    const inner = childScope(current);

    if (spec !== undefined && spec.kind === "list") {
      const [functionNode, tableNode] = spec.children;
      if (tableNode !== undefined) visit(tableNode, current);

      if (functionNode !== undefined && isSymbolNode(functionNode)) {
        const name = symbolText(functionNode);
        inner.functions.set(name, {
          name,
          kind: "function",
          position: functionNode.start,
          arity: { min: 0, max: 0 },
        });
      }
    }

    for (const form of node.children.slice(2)) visit(form, inner);
  }

  function visitMultipleValueBind(node: ListNode, current: Scope): void {
    const varsNode = node.children[1];
    const valueNode = node.children[2];
    const inner = childScope(current);

    if (valueNode !== undefined) visit(valueNode, current);
    if (varsNode !== undefined && varsNode.kind === "list") {
      for (const variable of varsNode.children) {
        bindVariable(inner, variable, "local");
      }
    }

    for (const form of node.children.slice(3)) visit(form, inner);
  }

  function visitDestructuringBind(node: ListNode, current: Scope): void {
    const patternNode = node.children[1];
    const valueNode = node.children[2];
    const inner = childScope(current);

    if (valueNode !== undefined) visit(valueNode, current);
    bindPattern(inner, patternNode);

    for (const form of node.children.slice(3)) visit(form, inner);
  }

  function bindPattern(scope: Scope, node: AstNode | undefined): void {
    if (node === undefined) return;
    if (node.kind === "atom") {
      const word = symbolWord(node);
      if (word !== undefined && !word.startsWith("&")) {
        bindVariable(scope, node, "local");
      }
      return;
    }
    if (node.kind !== "list") return;

    for (const child of node.children) bindPattern(scope, child);
  }

  function visitHandlerCase(node: ListNode, current: Scope): void {
    const protectedNode = node.children[1];
    if (protectedNode !== undefined) visit(protectedNode, current);

    for (const clause of node.children.slice(2)) {
      if (clause.kind !== "list" || clause.prefix !== undefined) {
        visit(clause, current);
        continue;
      }

      // (condition (variable) forms...), or (:no-error (variables...) ...)
      const variablesNode = clause.children[1];
      const inner = childScope(current);

      if (variablesNode !== undefined && variablesNode.kind === "list") {
        for (const variable of variablesNode.children) {
          bindVariable(inner, variable, "local");
        }
      }

      for (const form of clause.children.slice(2)) visit(form, inner);
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

// Registers the names a defstruct generates. Returns false when an option we do
// not model (:include, an unknown option) may generate names we cannot see.
function registerDefstruct(
  node: ListNode,
  functions: Map<string, Binding>,
): boolean {
  let nameNode = node.children[1];
  if (nameNode === undefined) return true;

  const options: ListNode[] = [];

  if (nameNode.kind === "list") {
    const header = nameNode.children;
    nameNode = header[0];
    for (const option of header.slice(1)) {
      if (option.kind === "list" && option.prefix === undefined) {
        options.push(option);
      }
    }
  }

  if (nameNode === undefined || !isSymbolNode(nameNode)) return true;

  const name = symbolText(nameNode);
  const position = nameNode.start;

  let prefix: string | null = `${name}-`;
  let constructor: string | null = `MAKE-${name}`;
  let predicate: string | null = `${name}-P`;
  let copier: string | null = `COPY-${name}`;
  let modelled = true;

  for (const option of options) {
    const rawKey =
      option.children[0] !== undefined
        ? symbolWord(option.children[0])
        : undefined;
    // Keywords arrive with the leading colon, as in ":CONC-NAME".
    const key =
      rawKey !== undefined && rawKey.startsWith(":")
        ? rawKey.slice(1)
        : rawKey;
    const value = option.children[1];

    switch (key) {
      case "CONC-NAME": {
        if (value === undefined) break;
        const word = symbolWord(value);
        if (word === "NIL") prefix = null;
        else if (word === undefined) modelled = false;
        else prefix = word;
        break;
      }
      case "CONSTRUCTOR":
        constructor = namedOption(value, `MAKE-${name}`, () => {
          modelled = false;
        });
        break;
      case "PREDICATE":
        predicate = namedOption(value, `${name}-P`, () => {
          modelled = false;
        });
        break;
      case "COPIER":
        copier = namedOption(value, `COPY-${name}`, () => {
          modelled = false;
        });
        break;
      case "INCLUDE":
        modelled = false;
        break;
      case "NAMED":
      case "TYPE":
      case "PRINT-FUNCTION":
      case "PRINT-OBJECT":
        break;
      default:
        modelled = false;
    }
  }

  const register = (functionName: string | null, arity: Arity): void => {
    if (functionName === null || functions.has(functionName)) return;
    functions.set(functionName, {
      name: functionName,
      kind: "function",
      position,
      arity,
    });
  };

  register(constructor, { min: 0, max: null });
  register(predicate, { min: 1, max: 1 });
  register(copier, { min: 1, max: 1 });

  for (const slot of node.children.slice(2)) {
    const slotNode = slot.kind === "list" ? slot.children[0] : slot;
    if (slotNode === undefined || !isSymbolNode(slotNode)) continue;

    const slotName = symbolText(slotNode);
    register(prefix === null ? slotName : `${prefix}${slotName}`, {
      min: 1,
      max: 1,
    });
  }

  return modelled;
}

function namedOption(
  value: AstNode | undefined,
  fallback: string,
  onUnmodelled: () => void,
): string | null {
  if (value === undefined) return fallback;

  const word = symbolWord(value);
  if (word === "NIL") return null;
  if (word !== undefined) return word;

  if (value.kind === "list") {
    const first = value.children[0];
    if (first !== undefined && isSymbolNode(first)) return symbolText(first);
  }

  onUnmodelled();
  return null;
}

function collectFromNode(
  node: AstNode,
  variables: Map<string, Binding>,
  functions: Map<string, Binding>,
  definitionCounts: Map<string, number>,
  flags: { unmodelled: boolean },
): void {
  if (node.kind === "quote") return;
  if (node.kind === "atom") return;
  if (node.prefix !== undefined) return;

  const head = headName(node);

  if (head === "DEFSTRUCT") {
    if (!registerDefstruct(node, functions)) flags.unmodelled = true;
  }

  if (head === "DEFUN") {
    const nameNode = node.children[1];
    if (nameNode !== undefined && isSymbolNode(nameNode)) {
      const name = symbolText(nameNode);
      functions.set(name, {
        name,
        kind: "function",
        position: nameNode.start,
        arity: parseArity(node.children[2]),
      });
      definitionCounts.set(name, (definitionCounts.get(name) ?? 0) + 1);
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

  for (const child of node.children) {
    collectFromNode(child, variables, functions, definitionCounts, flags);
  }
  if (node.tail !== undefined) {
    collectFromNode(node.tail, variables, functions, definitionCounts, flags);
  }
}

function childScope(parent: Scope): Scope {
  return { variables: new Map(), functions: new Map(), parent };
}

// A parameter binds its variable, and the supplied-p name when it has one. A
// marker binds nothing. For &key's ((:keyword name) …) form the variable is the
// second element, because the first names the keyword instead.
function parameterVariables(parameter: AstNode): AstNode[] {
  if (isSymbolNode(parameter)) {
    return symbolText(parameter).startsWith("&") ? [] : [parameter];
  }

  if (parameter.kind !== "list") return [];

  const head = parameter.children[0];
  const variable =
    head !== undefined && head.kind === "list" ? head.children[1] : head;

  const names: AstNode[] = [];
  if (variable !== undefined) names.push(variable);

  const supplied = parameter.children[2];
  if (supplied !== undefined) names.push(supplied);

  return names;
}

// Parameters bind left to right, and a default runs in the scope of the
// parameters before it — so (defun f (a &optional (b a)) …) sees A. Each
// parameter gets its own scope rather than sharing one, so a default recorded
// here cannot later appear to see a name bound to its right.
function withParameters(
  scope: Scope,
  parameters: AstNode[],
  visitDefault: (node: AstNode, scope: Scope) => void,
): Scope {
  let current = scope;

  for (const parameter of parameters) {
    const defaultNode = parameter.kind === "list" ? parameter.children[1] : undefined;
    if (defaultNode !== undefined) visitDefault(defaultNode, current);

    const names = parameterVariables(parameter);
    if (names.length === 0) continue;

    const inner = childScope(current);
    for (const name of names) bindVariable(inner, name, "parameter");
    current = inner;
  }

  return current;
}

function bindVariable(scope: Scope, node: AstNode | undefined, kind: "local" | "parameter"): void {
  if (node === undefined || !isSymbolNode(node)) return;
  scope.variables.set(symbolText(node), {
    name: symbolText(node),
    kind,
    position: node.start,
  });
}

function bindSymbols(scope: Scope, node: ListNode): void {
  for (const child of node.children) bindVariable(scope, child, "local");
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

// A subset of the Common Lisp lambda list: required names, then &optional,
// &rest / &body, &key and &aux. Markers do not count as arguments.
function parseArity(node: AstNode | undefined): Arity {
  const parameters = parameterNodes(node);

  let required = 0;
  let optional = 0;
  let unbounded = false;
  let mode: "required" | "optional" | "key" | "aux" | "rest" = "required";

  for (const parameter of parameters) {
    const word = symbolWord(parameter);

    switch (word) {
      case "&OPTIONAL":
        mode = "optional";
        continue;
      case "&REST":
      case "&BODY":
        mode = "rest";
        unbounded = true;
        continue;
      case "&KEY":
        mode = "key";
        unbounded = true;
        continue;
      case "&AUX":
        mode = "aux";
        continue;
      default:
        break;
    }

    if (mode === "required") required += 1;
    if (mode === "optional") optional += 1;
  }

  return { min: required, max: unbounded ? null : required + optional };
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

export function symbolWord(node: AstNode): string | undefined {
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

// Keywords after which a list token in a loop form is an expression rather
// than a clause list such as (hash-value v).
const LOOP_CODE_KEYWORDS: ReadonlySet<string> = new Set([
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
  "FINALLY",
  "INITIALLY",
  "WHILE",
  "UNTIL",
  "REPEAT",
  "RETURN",
  "IF",
  "WHEN",
  "UNLESS",
  "ELSE",
  "IN",
  "ON",
  "ACROSS",
  "FROM",
  "TO",
  "BELOW",
  "ABOVE",
  "BY",
  "=",
  "THEN",
]);

// Standard forms whose syntax we do not model. Their binding names and clause
// keywords would otherwise be read as ordinary code, so the walk stops here.
// Each entry is a candidate for decoding later; until then its body is unchecked.
export const OPAQUE_FORMS: ReadonlySet<string> = new Set([
  "DEFCLASS",
  "DEFGENERIC",
  "DEFMETHOD",
  "DEFMACRO",
  "DEFTYPE",
  "DEFPACKAGE",
  "WITH-SLOTS",
  "WITH-ACCESSORS",
  "HANDLER-BIND",
  "RESTART-CASE",
  "MACROLET",
  "SYMBOL-MACROLET",
]);
