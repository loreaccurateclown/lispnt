import type { Diagnostic, ShapeCode } from "./diagnostics";
import type { AstNode, ListNode, Position } from "./reader";

export function checkForms(forms: AstNode[], source: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const form of forms) {
    walk(form, diagnostics, source); //we're recursing in JS!
  }
  return diagnostics;
}

function walk(node: AstNode, diagnostics: Diagnostic[], source: string): void {
  if (node.kind === "quote") return; //quoted data: skip subtree ' on ()
  if (node.kind === "atom") return; //nothing to check
  if (node.prefix !== undefined) return; //vectors use prefix # on () so this skips their subtree

  checkFormSingle(node, diagnostics, source); //the recurser!!!!!!! also fish named this "checkForm" so I added an extra word to distinguish it

  for (const child of node.children) walk(child, diagnostics, source); //JS has inline for loops... woah

  if (node.tail !== undefined) walk(node.tail, diagnostics, source);
}

function checkFormSingle(
  list: ListNode,
  diagnostics: Diagnostic[],
  source: string,
): void {
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
      checkLet(list, diagnostics, source, head);
      return;
    case "LABELS":
    case "FLET":
      checkLocalFunctions(list, diagnostics);
      return;
    case "IF":
      checkOperandRange(
        list,
        diagnostics,
        2,
        3,
        `IF takes a test, a then-branch and an optional else-branch: write ${quote("(if test then else)")}.`,
      );
      return;
    case "WHEN":
    case "UNLESS":
      checkOperandRange(
        list,
        diagnostics,
        1,
        null,
        `${head} takes a test and then any number of body forms: write ${quote(`(${head.toLowerCase()} test body…)`)}.`,
      );
      return;
    case "SETQ":
    case "SETF":
      checkSetq(list, diagnostics, head);
      return;
    case "COND":
      checkCond(list, diagnostics);
      return;
    case "CASE":
    case "ECASE":
    case "CCASE":
      checkCase(list, diagnostics, head);
      return;
    case "DO":
    case "DO*":
      checkDo(list, diagnostics, head);
      return;
    case "DOTIMES":
    case "DOLIST":
      checkIteration(list, diagnostics, head);
      return;
    case "MULTIPLE-VALUE-BIND":
      checkMultipleValueBind(list, diagnostics);
      return;
    case "MULTIPLE-VALUE-SETQ":
      checkMultipleValueSetq(list, diagnostics);
      return;
    case "RETURN":
      checkOperandRange(
        list,
        diagnostics,
        0,
        1,
        `RETURN takes at most one value: write ${quote("(return value)")} or ${quote("(return)")}.`,
      );
      return;
    case "PUSH":
      checkOperandRange(
        list,
        diagnostics,
        2,
        2,
        `PUSH takes a value and a place: write ${quote("(push x stack)")}.`,
      );
      return;
    case "POP":
      checkOperandRange(
        list,
        diagnostics,
        1,
        1,
        `POP takes a place: write ${quote("(pop stack)")}.`,
      );
      return;
    case "INCF":
    case "DECF":
      checkOperandRange(
        list,
        diagnostics,
        1,
        2,
        `${head} takes a place and an optional amount: write ${quote(`(${head.toLowerCase()} n)`) } or ${quote(`(${head.toLowerCase()} n 2)`)}.`,
      );
      return;
    case "DEFPARAMETER":
      checkOperandRange(
        list,
        diagnostics,
        2,
        3,
        `DEFPARAMETER takes a name, an initial value and an optional description: write ${quote("(defparameter *x* 1)")}.`,
      );
      return;
    case "DEFVAR":
      checkOperandRange(
        list,
        diagnostics,
        1,
        3,
        `DEFVAR takes a name with an optional initial value and description: write ${quote("(defvar *x* 1)")}.`,
      );
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
        `A DEFUN needs its name before the argument list: write ${quote("(defun name (x) …)")}.`,
        list.start,
        list.end,
      ),
    );
    return; // one repair at a time: the argument list cannot be judged without a name
  }

  const arglistNode = list.children[2];
  if (arglistNode === undefined || !isListNode(arglistNode)) {
    const example = `(defun ${symbolText(nameNode)} (x) …)`;
    diagnostics.push(
      shapeDiagnostic(
        "defun-arglist",
        `A DEFUN needs an argument list after the name: write ${quote(example)}.`,
        list.start,
        list.end,
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
        `A LAMBDA needs its argument list first: write ${quote("(lambda (x) …)")}.`,
        list.start,
        list.end,
      ),
    );
  }
}

function checkLet(
  list: ListNode,
  diagnostics: Diagnostic[],
  source: string,
  head: string,
): void {
  const bindingsNode = list.children[1];
  if (bindingsNode === undefined || !isListNode(bindingsNode)) {
    diagnostics.push(
      shapeDiagnostic(
        "let-bindings",
        "a let needs a list of bindings here.",
        bindingsNode?.start ?? list.start,
      ),
    );
    return;
  }

  const entries = bindingsNode.children;
  const bad = entries.find((entry) => !isLetBinding(entry));
  if (bad === undefined) return;

  // The whole form is marked: the fault is in how the brackets group it, not in
  // one token that could be removed.
  diagnostics.push(
    shapeDiagnostic(
      "let-binding",
      letBindingMessage(bindingsNode, entries, bad, source, head),
      list.start,
      list.end,
    ),
  );
}

// A binding entry is a name, or a list holding a name and an optional value.
function isLetBinding(entry: AstNode): boolean {
  if (isSymbolNode(entry)) return true;
  if (!isListNode(entry) || entry.tail !== undefined) return false;
  if (entry.children.length < 1 || entry.children.length > 2) return false;
  const name = entry.children[0];
  return name !== undefined && isSymbolNode(name);
}

function letBindingMessage(
  bindings: ListNode,
  entries: readonly AstNode[],
  bad: AstNode,
  source: string,
  head: string,
): string {
  const first = entries[0];
  const second = entries[1];

  // The mistake that brought the learner here: (x 0) where ((x 0)) was meant.
  // The exact repair is only suggested when the two entries are the name and the
  // value it should take; anything else gets the pattern instead of a guess.
  if (
    entries.length === 2 &&
    first !== undefined &&
    second !== undefined &&
    isSymbolNode(first) &&
    !isLetBinding(second) &&
    !isListNode(second)
  ) {
    const pair = source.slice(bindings.start.offset, bindings.end.offset);
    const name = (symbolText(first) ?? "X").toUpperCase();
    const value = textOf(second, bindings, source);
    return (
      `${head} bindings need a pair of brackets each: write ${quote(`(${pair})`)} so ${quote(name)} is bound to ${quote(value)}. ` +
      `As written, ${head} reads ${quote(name)}, then takes ${quote(value)} as a second binding, which fails.`
    );
  }

  const text = textOf(bad, bindings, source);
  return (
    `Each LET binding is a name or a ${quote("(name value)")} pair, as in ${quote("((x 0))")}. ` +
    `As written, ${quote(text)} is not a binding.`
  );
}

// The learner's own characters for a node, so the repair matches what they wrote.
function textOf(node: AstNode, parent: ListNode, source: string): string {
  const end = endOffset(node, parent);
  return source.slice(node.start.offset, end).trim();
}

function endOffset(node: AstNode, parent: ListNode): number {
  if (node.kind !== "atom") return node.end.offset;
  const index = parent.children.indexOf(node);
  const next = parent.children[index + 1];
  if (next !== undefined) return next.start.offset;
  return Math.max(node.start.offset + 1, parent.end.offset - 1);
}

function quote(text: string): string {
  return "`" + text + "`";
}

function checkLocalFunctions(list: ListNode, diagnostics: Diagnostic[]): void {
  const definitionsNode = list.children[1];
  if (definitionsNode === undefined || !isListNode(definitionsNode)) {
    diagnostics.push(
      shapeDiagnostic(
        "local-definitions",
        `FLET and LABELS need a list of local definitions: write ${quote("(labels ((name (x) …)) …)")}.`,
        list.start,
        list.end,
      ),
    );
    return;
  }

  const local = "Each local function is a name and an argument list: write `((name (x) …))`.";

  for (const definitionNode of definitionsNode.children) {
    if (!isListNode(definitionNode)) {
      diagnostics.push(
        // An atom entry has no recorded end, and the whole line is a better
        // target than guessing where the token stops.
        shapeDiagnostic("local-definition", local, definitionNode.start),
      );
      continue;
    }

    const nameNode = definitionNode.children[0];
    const paramsNode = definitionNode.children[1];

    if (
      nameNode === undefined ||
      !isSymbolNode(nameNode) ||
      paramsNode === undefined ||
      !isListNode(paramsNode)
    ) {
      diagnostics.push(
        shapeDiagnostic(
          "local-definition",
          local,
          definitionNode.start,
          definitionNode.end,
        ),
      );
    }
  }
}

// A special form whose operand count is fixed or bounded. The message says what
// to write rather than how many arguments it counted: a learner can act on the
// first and not on the second.
function checkOperandRange(
  list: ListNode,
  diagnostics: Diagnostic[],
  min: number,
  max: number | null,
  message: string,
): void {
  const count = list.children.length - 1;
  if (count < min || (max !== null && count > max)) {
    diagnostics.push(
      shapeDiagnostic("operand-count", message, list.start, list.end),
    );
  }
}

// An atom has no recorded end, so its diagnostic keeps the whole-line underline
// rather than guessing where the token stops.
function endOfNode(node: AstNode): Position | undefined {
  return node.kind === "atom" ? undefined : node.end;
}

function checkSetq(
  list: ListNode,
  diagnostics: Diagnostic[],
  head: string,
): void {
  const count = list.children.length - 1;
  // (setq) and (setf) are legal and answer NIL; an odd count is the mistake.
  if (count % 2 === 0) return;
  diagnostics.push(
    shapeDiagnostic(
      "operand-count",
      head === "SETQ"
        ? `SETQ takes pairs of a name and a value: write ${quote("(setq x 1)")}.`
        : `SETF takes pairs of a place and a value: write ${quote("(setf (car x) 1)")}.`,
      list.start,
      list.end,
    ),
  );
}

function checkCond(list: ListNode, diagnostics: Diagnostic[]): void {
  for (const clause of list.children.slice(1)) {
    if (clause.kind !== "list" || clause.prefix !== undefined) {
      diagnostics.push(
        shapeDiagnostic(
          "clause-shape",
          `A COND clause is a test and its body inside brackets: write ${quote("((test) …)")}.`,
          clause.start,
          endOfNode(clause),
        ),
      );
      continue;
    }
    if (clause.children.length === 0) {
      diagnostics.push(
        shapeDiagnostic(
          "clause-shape",
          `A COND clause needs a test: write ${quote("((test) …)")}.`,
          clause.start,
          clause.end,
        ),
      );
    }
  }
}

function checkCase(
  list: ListNode,
  diagnostics: Diagnostic[],
  head: string,
): void {
  for (const clause of list.children.slice(2)) {
    if (clause.kind === "list" && clause.prefix === undefined) continue;
    diagnostics.push(
      shapeDiagnostic(
        "clause-shape",
        `Each ${head} clause is a list of keys and its body: write ${quote("((1) …)")}.`,
        clause.start,
        endOfNode(clause),
      ),
    );
  }
}

function checkDo(
  list: ListNode,
  diagnostics: Diagnostic[],
  head: string,
): void {
  const example = quote(
    `(${head.toLowerCase()} ((i 0)) ((> i 10) i) …)`,
  );
  const bindings = list.children[1];

  if (
    bindings === undefined ||
    bindings.kind !== "list" ||
    bindings.prefix !== undefined
  ) {
    diagnostics.push(
      shapeDiagnostic(
        "let-bindings",
        `${head} needs a list of bindings after its name: write ${example}.`,
        list.start,
        list.end,
      ),
    );
    return;
  }

  if (!bindings.children.every(isDoBinding)) {
    diagnostics.push(
      shapeDiagnostic(
        "do-binding",
        `Each ${head} binding is a name or ${quote("(name init step)")}: write ${quote("((i 0 (1+ i)))")}.`,
        list.start,
        list.end,
      ),
    );
  }

  const endClause = list.children[2];
  if (
    endClause === undefined ||
    endClause.kind !== "list" ||
    endClause.prefix !== undefined ||
    endClause.children.length === 0
  ) {
    diagnostics.push(
      shapeDiagnostic(
        "do-end-test",
        `${head} needs an end-test clause after its bindings: write ${example}.`,
        list.start,
        list.end,
      ),
    );
  }
}

function isDoBinding(entry: AstNode): boolean {
  if (isSymbolNode(entry)) return true;
  if (!isListNode(entry) || entry.tail !== undefined) return false;
  if (entry.children.length < 1 || entry.children.length > 3) return false;
  const name = entry.children[0];
  return name !== undefined && isSymbolNode(name);
}

function checkIteration(
  list: ListNode,
  diagnostics: Diagnostic[],
  head: string,
): void {
  const example = quote(
    head === "DOTIMES" ? "(dotimes (i 3) …)" : "(dolist (x list) …)",
  );
  const spec = list.children[1];
  const ok =
    spec !== undefined &&
    spec.kind === "list" &&
    spec.prefix === undefined &&
    spec.children.length >= 2 &&
    spec.children.length <= 3 &&
    spec.children[0] !== undefined &&
    isSymbolNode(spec.children[0]);

  if (ok) return;
  diagnostics.push(
    shapeDiagnostic(
      "iteration-spec",
      `${head} takes ${quote(head === "DOTIMES" ? "(variable count [result])" : "(variable list [result])")}: write ${example}.`,
      list.start,
      list.end,
    ),
  );
}

function checkMultipleValueBind(
  list: ListNode,
  diagnostics: Diagnostic[],
): void {
  const names = list.children[1];
  const ok =
    names !== undefined &&
    names.kind === "list" &&
    names.prefix === undefined &&
    list.children.length >= 3;
  if (ok) return;
  diagnostics.push(
    shapeDiagnostic(
      "operand-count",
      `MULTIPLE-VALUE-BIND takes a list of names and then the form that produces the values: write ${quote("(multiple-value-bind (a b) (values 1 2) …)")}.`,
      list.start,
      list.end,
    ),
  );
}

function checkMultipleValueSetq(
  list: ListNode,
  diagnostics: Diagnostic[],
): void {
  const names = list.children[1];
  const ok =
    names !== undefined &&
    names.kind === "list" &&
    names.prefix === undefined &&
    list.children.length === 3;
  if (ok) return;
  diagnostics.push(
    shapeDiagnostic(
      "operand-count",
      `MULTIPLE-VALUE-SETQ takes a list of names and one form: write ${quote("(multiple-value-setq (a b) (values 1 2))")}.`,
      list.start,
      list.end,
    ),
  );
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
  end?: Position,
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity: "error", message, position };
  return end === undefined ? diagnostic : { ...diagnostic, end };
}


