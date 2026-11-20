import type { Diagnostic, ShapeCode } from "./diagnostics";
import type { AstNode, ListNode, Position } from "./reader";

export function checkForms(forms: AstNode[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const form of forms) {
    walk(form, diagnostics); //we're recursing in JS!
  }
  return diagnostics;
}

function walk(node: AstNode, diagnostics: Diagnostic[]): void {
  if (node.kind === "quote") return; //quoted data: skip subtree ' on ()
  if (node.kind === "atom") return; //nothing to check
  if (node.prefix !== undefined) return; //vectors use prefix # on () so this skips their subtree

  checkFormSingle(node, diagnostics); //the recurser!!!!!!! also fish named this "checkForm" so I added an extra word to distinguish it

  for (const child of node.children) walk(child, diagnostics); //JS has inline for loops... woah

  if (node.tail !== undefined) walk(node.tail, diagnostics);
}

function checkFormSingle(list: ListNode, diagnostics: Diagnostic[]): void {
  const first = list.children[0];
  const head =
    first === undefined ? undefined : symbolText(first)?.toUpperCase(); //if not undefined head returns the symboltext in our first index

  switch (head) {
    case "DEFUN":
      checkDefun(list, diagnostics);
      return;
    case "LAMBDA":
      checkLambda(list, diagnostics);
      return;
    case "LET":
    case "LET*":
      checkLet(list, diagnostics);
      return;
    default:
      return;
  }
}

function checkDefun(list: ListNode, diagnostics: Diagnostic[]): void {
  //building the array of diagnostics
  const nameNode = list.children[1];
  if (nameNode === undefined || !isSymbolNode(nameNode)) {
    diagnostics.push(
      shapeDiagnostic(
        "defun-name",
        "A defun needs a name symbol here.",
        nameNode?.start ?? list.start,
      ),
    );
  }

  const arglistNode = list.children[2];
  if (arglistNode === undefined || !isListNode(arglistNode)) {
    diagnostics.push(
      shapeDiagnostic(
        "defun-arglist",
        "A defun needs an argument list here.",
        arglistNode?.start ?? list.start,
      ),
    );
  }
}

function checkLambda(list: ListNode, diagnostics: Diagnostic[]): void {
  const arglistNode = list.children[1];
  if (arglistNode === undefined || !isListNode(arglistNode)) {
    diagnostics.push(
      shapeDiagnostic(
        "lambda-arglist",
        "A lambda needs an argument list here.",
        arglistNode?.start ?? list.start,
      ),
    );
  }
}

function checkLet(list: ListNode, diagnostics: Diagnostic[]): void {
  const bindingsNode = list.children[1];
  if (bindingsNode === undefined || !isListNode(bindingsNode)) {
    diagnostics.push(
      shapeDiagnostic(
        "let-bindings",
        "a let needs a list of bindings here.",
        bindingsNode?.start ?? list.start,
      ),
    );
  }
}

function isListNode(node: AstNode): node is ListNode {
  return node.kind === "list";
}

function isSymbolNode(node: AstNode): boolean {
  return node.kind === "atom" && node.atomType === "symbol";
}

function symbolText(node: AstNode): string | undefined {
  return node.kind === "atom" && node.atomType === "symbol"
    ? String(node.value)
    : undefined;
}

function shapeDiagnostic(
  code: ShapeCode, //honestly I do not understand why Prettier prefers this kind of look. Inline is genuinely easier to read for this few params
  message: string,
  position: Position,
): Diagnostic {
  return { code, severity: "error", message, position };
}
