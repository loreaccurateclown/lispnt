import { builtins } from "./builtins";
import type { Diagnostic, DiagnosticSeverity } from "./diagnostics";
import { SPECIAL_FORMS } from "./interpreter";
import type { AstNode, AtomNode, ListNode, Position } from "./reader";
import {
  collectSymbols,
  createFileScope,
  lookupFunction,
  lookupVariable,
  OPAQUE_FORMS,
  symbolWord,
  walkWithScopes,
  type Arity,
  type FileSymbols,
  type Scope,
} from "./scopes";

export function checkNames(forms: AstNode[]): Diagnostic[] {
  const symbols = collectSymbols(forms);
  const root = createFileScope(symbols);
  const diagnostics: Diagnostic[] = [];

  walkWithScopes(forms, root, (node, scope) => {
    if (node.kind === "atom") {
      checkVariable(node, scope, diagnostics);
      return;
    }
    if (node.kind !== "list") return;
    // #( ... ) contents are data, not code.
    if (node.prefix !== undefined) return;
    checkCall(node, scope, symbols, diagnostics);
  });

  return diagnostics;
}

function checkVariable(
  node: AtomNode,
  scope: Scope,
  diagnostics: Diagnostic[],
): void {
  const name = symbolWord(node);
  if (name === undefined) return;
  if (name.startsWith(":")) return;
  // Special variables are often defined elsewhere: another file, the REPL, or
  // the implementation. Leave them alone. A lone * is the multiplication
  // function, not a special.
  if (name.length > 2 && name.startsWith("*") && name.endsWith("*")) return;
  // Reader gaps: character literals and ratios are not parsed yet, so they
  // arrive as symbols. Reporting them as unbound names would be noise.
  if (name.startsWith("#\\")) return;
  if (/^\d+\/\d+$/.test(name)) return;
  if (lookupVariable(scope, name) !== undefined) return;

  diagnostics.push({
    code: "unbound-variable",
    severity: "warning",
    message: `${name} has no value here. If it comes from another file, load that file first.`,
    position: node.start,
    name,
  });
}

function checkCall(
  node: ListNode,
  scope: Scope,
  symbols: FileSymbols,
  diagnostics: Diagnostic[],
): void {
  const head = node.children[0];
  if (head === undefined) return;

  const name = symbolWord(head);
  if (name === undefined) return;
  if (name.startsWith(":")) return;
  if (SPECIAL_FORMS.has(name)) return;
  // Modelled only as opaque syntax: the name is known, its structure is not.
  if (OPAQUE_FORMS.has(name)) return;

  const fn = lookupFunction(scope, name);
  const variable = lookupVariable(scope, name);

  if (fn === undefined) {
    if (variable !== undefined) {
      // Only parameters and locals are reported. A global may legitimately hold
      // a function in this interpreter's single namespace.
      if (variable.kind === "parameter" || variable.kind === "local") {
        diagnostics.push({
          code: "variable-as-function",
          severity: "error",
          message: `${name} is a variable, so it cannot be called. Check the order of this form.`,
          position: head.start,
        });
      }
      return;
    }

    // A file that loads another, or defines a structure in a way we cannot
    // model (:include and the like), may call names we cannot see.
    if (symbols.loadsAnotherFile || symbols.unmodelledStructures) return;

    diagnostics.push({
      code: "undefined-function",
      severity: "warning",
      message: `No function ${name} is defined in this file. If it comes from another file, load that file first.`,
      position: head.start,
      name,
    });
    return;
  }

  if (fn.kind === "standard") return;
  // A dotted tail means this is not a well-formed call; arity would mislead.
  if (node.tail !== undefined) return;

  const given = node.children.length - 1;

  if (fn.kind === "builtin") {
    const builtin = builtins.get(name);
    if (builtin === undefined) return;

    if (given < builtin.min || (builtin.max !== null && given > builtin.max)) {
      pushArity(
        diagnostics,
        name,
        head.start,
        given,
        { min: builtin.min, max: builtin.max },
        "error",
      );
    }
    return;
  }

  if (fn.arity === undefined) return;

  const { min, max } = fn.arity;
  if (given >= min && (max === null || given <= max)) return;

  // A name defined more than once may have had a different arity at this call.
  const definitions = symbols.definitionCounts.get(name) ?? 1;
  pushArity(
    diagnostics,
    name,
    head.start,
    given,
    fn.arity,
    definitions > 1 ? "warning" : "error",
  );
}

function pushArity(
  diagnostics: Diagnostic[],
  name: string,
  position: Position,
  given: number,
  arity: Arity,
  severity: DiagnosticSeverity,
): void {
  diagnostics.push({
    code: "arity",
    severity,
    message: arityMessage(name, given, arity),
    position,
    name,
    arityInfo: { given, min: arity.min, max: arity.max },
  });
}

function arityMessage(name: string, given: number, arity: Arity): string {
  const describe = (count: number) =>
    `${count} argument${count === 1 ? "" : "s"}`;

  if (arity.max === null) {
    return `${name} takes at least ${describe(arity.min)}, but is called with ${given}.`;
  }
  if (arity.min === arity.max) {
    return `${name} takes exactly ${describe(arity.max)}, but is called with ${given}.`;
  }
  return `${name} takes ${arity.min} to ${arity.max} arguments, but is called with ${given}.`;
}
