import { checkForms } from "./checks";
import {
  type Diagnostic,
  diagnosticFromEvalError,
  diagnosticFromError,
} from "./diagnostics";
import { LispEvalError, type ReaderError } from "./errors";
import {
  createEnv,
  evaluate,
  HARD_STEP_CEILING,
  ReturnSignal,
  withStepCeiling,
} from "./interpreter";
import { checkNames } from "./name-checks";
import {
  type AstNode,
  createReader,
  type ListNode,
  type Position,
} from "./reader";
import { collectSymbols } from "./scopes";
import { emptyTraceMarkers } from "./trace-cases";

// Mistakes the name checker reports for the whole file. Evaluation finds the
// same ones in code it reaches, so its copies are dropped rather than shown
// twice — with a different position and a weaker message.
const NAME_CODES: ReadonlySet<string> = new Set([
  "undefined-function",
  "unbound-variable",
  "arity",
]);

function isCoveredByDiagnostic(
  form: AstNode,
  diagnostics: Diagnostic[],
): boolean {
  return diagnostics.some((diagnostic) => {
    if (diagnostic.position.offset < form.start.offset) return false;
    if (form.kind === "list")
      return diagnostic.position.offset < form.end.offset;
    return true;
  });
}

// True when a name diagnostic sits inside a form the shape pass already marked.
// A shape mark without an end cannot say how far it reaches, so it suppresses
// nothing; every mark the shape pass makes today carries one.
function insideShapeMark(
  diagnostic: Diagnostic,
  shapeMarks: readonly Diagnostic[],
): boolean {
  const at: Position = diagnostic.position;
  return shapeMarks.some((mark) => {
    if (mark.end === undefined) return mark.position.offset === at.offset;
    return at.offset > mark.position.offset && at.offset < mark.end.offset;
  });
}

export function analyze(source: string): Diagnostic[] {
  const reader = createReader(source);
  const diagnostics: Diagnostic[] = [];
  const forms: AstNode[] = [];
  const readerErrors: ReaderError[] = [];

  let result = reader.next();
  while (result.kind !== "end") {
    if (result.kind === "error") {
      readerErrors.push(result.error);
    } else {
      forms.push(result.node);
    }
    result = reader.next();
  }

  // Where checking stops: the end of the last form that was complete.
  const lastComplete = forms[forms.length - 1];
  const lastCompleteLine =
    lastComplete === undefined
      ? undefined
      : lastComplete.kind === "list"
        ? lastComplete.end.line
        : lastComplete.start.line;

  // A file that ends inside a form cannot be read further, so the missing
  // closer is supplied at the end and the file is read again. That hypothetical
  // read answers two questions: which names the file really defines (so a
  // warning the truncation manufactured can be dropped), and whether the text
  // has a form that swallowed its sibling — which is where the mark belongs.
  const missingCloser = readerErrors.find(
    (error) => error.code === "unterminated-list",
  );
  const recovered =
    missingCloser === undefined ? null : recoveredParse(source, missingCloser);
  const repaired =
    missingCloser === undefined
      ? undefined
      : (bracketMismatch(missingCloser, recovered) ??
        unclosedBindingMismatch(missingCloser, recovered, source));

  for (const error of readerErrors) {
    diagnostics.push(
      error === missingCloser && repaired !== undefined
        ? repaired
        : diagnosticFromError(error, lastCompleteLine),
    );
  }

  const shapeDiagnostics = checkForms(forms, source);
  diagnostics.push(...shapeDiagnostics);

  // A file that loads another cannot be checked for undefined functions: the
  // definitions may arrive from the loaded file.
  const loadsAnotherFile = forms.some((form) => {
    if (form.kind !== "list" || form.prefix !== undefined) return false;
    const head = form.children[0];
    return (
      head !== undefined &&
      head.kind === "atom" &&
      head.atomType === "symbol" &&
      String(head.value).toUpperCase() === "LOAD"
    );
  });

  withStepCeiling(HARD_STEP_CEILING, () => {
    const env = createEnv(null);

    for (const form of forms) {
      if (isCoveredByDiagnostic(form, diagnostics)) continue;

      try {
        evaluate(form, env);
      } catch (error) {
        if (error instanceof LispEvalError) {
          // A standard CL name Lispnt does not implement is our gap, not the
          // learner's mistake, so it is not reported.
          if (error.code === "unsupported-standard") continue;
          if (error.code === "undefined-function" && loadsAnotherFile) continue;
          // The name checker reports these for the whole file, including the
          // bodies evaluation never reaches.
          if (NAME_CODES.has(error.code)) continue;
          diagnostics.push(diagnosticFromEvalError(error, form.start));
          continue;
        }
        if (error instanceof ReturnSignal) continue;
        // Deep recursion blows the JS stack before the step budget trips, so
        // both failure modes surface as the same diagnostic.
        if (error instanceof RangeError) {
          diagnostics.push(
            diagnosticFromEvalError(
              new LispEvalError(
                "evaluation-budget",
                form.start,
                "This code recursed too deeply to check safely.",
              ),
              form.start,
            ),
          );
          continue;
        }
        throw error;
      }
    }
  });

  // Whole-file name checks: they see every body, including the ones evaluation
  // never reaches. A name inside a form that already has a shape mark is left
  // out: the shape comes first, and the learner should see one repair, not four
  // warnings inside a form that cannot run.
  diagnostics.push(
    ...checkNames(forms).filter(
      (diagnostic) => !insideShapeMark(diagnostic, shapeDiagnostics),
    ),
  );

  // Last, after evaluation: a marker warning can sit inside a definition, and
  // isCoveredByDiagnostic would skip evaluating that form if the warning came
  // earlier — hiding real mistakes in the body it sits in.
  for (const marker of emptyTraceMarkers(source)) {
    diagnostics.push({
      code: "trace-marker",
      severity: "warning",
      message:
        "This ;;[trace] marker has no test case for the function. Write the test case you want traced after [trace], for example ;;[trace] (fact 4).",
      position: { line: marker.line, column: marker.column, offset: marker.offset },
    });
  }

  if (missingCloser === undefined) return diagnostics;

  return withoutHiddenNameWarnings(diagnostics, forms, recoveredNames(recovered));
}

interface RecoveredParse {
  readonly forms: AstNode[];
  readonly source: string;
  // The real text ends here; anything after it is the closers this run supplied.
  readonly originalLength: number;
}

interface Span {
  readonly position: Position;
  readonly end?: Position;
}

// Read the file again with the missing closers supplied at the end. Null means
// even that read fails, which leaves the answer unknown.
function recoveredParse(
  source: string,
  error: ReaderError,
): RecoveredParse | null {
  const count = Math.max(1, error.openForms?.length ?? 1);
  const padded = source + ")".repeat(count);
  const reader = createReader(padded);
  const forms: AstNode[] = [];

  for (;;) {
    const result = reader.next();
    if (result.kind === "end") break;
    if (result.kind === "error") return null;
    forms.push(result.node);
  }

  return { forms, source: padded, originalLength: source.length };
}

// A missing closer can make a form swallow its sibling. The recovered read shows
// which form that was, so the mark moves there and the message says what the
// swallow broke; the unclosed form itself is not useful to point at, because it
// is the whole file from the reader's point of view.
const BRACKET_HINT_CODES: ReadonlySet<string> = new Set([
  "arity",
  "operand-count",
  "local-definition",
  "let-binding",
  "do-binding",
  "do-end-test",
  "iteration-spec",
]);

// When one swallow produces two complaints — DO reads the end clause as a
// binding and then has no end clause — the more specific one is the useful one.
const BRACKET_HINT_PRIORITY: readonly string[] = [
  "arity",
  "local-definition",
  "let-binding",
  "do-binding",
  "do-end-test",
  "iteration-spec",
  "operand-count",
];

function bracketMismatch(
  error: ReaderError,
  recovered: RecoveredParse | null,
): Diagnostic | undefined {
  // With more than one open list the count of missing closers is the useful
  // message, and it stays as it is.
  if (recovered === null || (error.openForms?.length ?? 1) !== 1)
    return undefined;

  // The complaint may sit exactly on the unclosed form when that form is the one
  // that swallowed the rest of the file, as a top-level definition does.
  const candidates = [
    ...checkForms(recovered.forms, recovered.source),
    ...checkNames(recovered.forms),
  ].filter(
    (diagnostic) =>
      BRACKET_HINT_CODES.has(diagnostic.code) &&
      diagnostic.position.offset >= error.position.offset,
  );
  if (candidates.length === 0) return undefined;

  // The swallow happens at the end, so the complaint nearest the end of the
  // file is the one the missing bracket produced; ties go to the more specific.
  const farthest = Math.max(
    ...candidates.map((candidate) => candidate.position.offset),
  );
  const candidate = candidates
    .filter((candidate) => candidate.position.offset === farthest)
    .sort(
      (a, b) =>
        BRACKET_HINT_PRIORITY.indexOf(a.code) -
        BRACKET_HINT_PRIORITY.indexOf(b.code),
    )[0];
  if (candidate === undefined) return undefined;

  const span = spanForCandidate(candidate, recovered.forms);
  if (span === undefined) return undefined;

  // A swallowed sibling still stands at the start of its own line. A complaint
  // with no line-starting form inside it did not come from the missing closer —
  // (let (x 0), one closer short, still has a bindings mistake — so the
  // unclosed-form mark is the honest one there.
  const evidence =
    hasLineStartInside(recovered.source, span, recovered.originalLength) ||
    (candidate.code === "local-definition" &&
      startsLine(recovered.source, span.position.offset));
  if (!evidence) return undefined;

  return describeBracketMismatch(candidate, recovered.forms, span);
}

// The unclosed form can be the very form whose bindings are wrong: `(let (x 0)`
// with no final closer is one `)` short and also missing the brackets around the
// pair. The recovered read knows the second fact, so the message states both
// instead of hiding the binding repair behind the unclosed mark.
function unclosedBindingMismatch(
  error: ReaderError,
  recovered: RecoveredParse | null,
  source: string,
): Diagnostic | undefined {
  const openForms = error.openForms ?? [];
  const open = openForms[0];
  if (recovered === null || openForms.length !== 1 || open === undefined)
    return undefined;

  const head = formHeadAt(source, open.position.offset, open.headEnd);
  if (head !== "LET" && head !== "LET*") return undefined;

  // The complaint whose form starts at the unclosed opener is about that form.
  const candidate = checkForms(recovered.forms, recovered.source).find(
    (diagnostic) =>
      diagnostic.code === "let-binding" &&
      diagnostic.position.offset === error.position.offset,
  );
  if (candidate === undefined) return undefined;

  const closes = `The ${head} also never closes: the file ends ${openForms.length} \`)\` short.`;
  return {
    code: "bracket-mismatch",
    severity: "error",
    message: `${candidate.message} ${closes}`,
    position: open.position,
    ...(open.headEnd === undefined ? {} : { end: open.headEnd }),
  };
}

function formHeadAt(
  source: string,
  start: number,
  headEnd: Position | undefined,
): string | undefined {
  const raw = source.slice(start + 1, headEnd?.offset ?? start + 2);
  const word = raw.trim().split(/\s+/)[0];
  return word === undefined || word === "" ? undefined : word.toUpperCase();
}

// The arity complaint points at the called name; the form to mark is the call.
function spanForCandidate(
  candidate: Diagnostic,
  forms: readonly AstNode[],
): Span | undefined {
  if (candidate.code === "arity") {
    const call = callingListAt(forms, candidate.position.offset);
    return call === undefined
      ? undefined
      : { position: call.start, end: call.end };
  }
  return candidate.end === undefined
    ? undefined
    : { position: candidate.position, end: candidate.end };
}

function hasLineStartInside(
  source: string,
  span: Span,
  limit: number,
): boolean {
  if (span.end === undefined) return false;
  const end = Math.min(span.end.offset, limit);
  for (let offset = span.position.offset + 1; offset < end; offset++) {
    if (startsLine(source, offset)) return true;
  }
  return false;
}

function startsLine(source: string, offset: number): boolean {
  const here = source[offset];
  if (here === undefined) return false;
  // Only a token starts a line; the newline and the indentation do not.
  if (here === " " || here === "\t" || here === "\r" || here === "\n")
    return false;

  let at = offset - 1;
  while (at >= 0 && (source[at] === " " || source[at] === "\t")) at -= 1;
  return at < 0 || source[at] === "\n" || source[at] === "\r";
}

function describeBracketMismatch(
  candidate: Diagnostic,
  forms: readonly AstNode[],
  span: Span,
): Diagnostic | undefined {
  const line = candidate.position.line;

  if (candidate.code === "arity") {
    const info = candidate.arityInfo;
    const name = candidate.name;
    if (info === undefined || name === undefined) return undefined;
    return describeBracket(
      line,
      `${name} was given ${info.given} arguments; it takes ${describeArity(info.min, info.max)}. Check the ${name} form for a missing closing bracket.`,
      span,
    );
  }

  if (candidate.code === "operand-count") {
    const form = listAt(forms, candidate.position.offset);
    if (form === undefined) return undefined;
    const head = headName(form);
    const tail = head === undefined ? undefined : operandHint(head);
    if (head === undefined || tail === undefined) return undefined;

    const given = form.children.length - 1;
    return describeBracket(
      line,
      `${head} was given ${given} form${given === 1 ? "" : "s"}; it takes ${tail}. Check the ${head} form for a missing closing bracket.`,
      span,
    );
  }

  if (candidate.code === "local-definition") {
    const head = enclosingLocalFunctionForm(forms, candidate.position) ?? "LABELS";
    return describeBracket(
      line,
      `a ${head} entry has no argument list; each local function needs a name and an argument list. Check the ${head} form for a missing closing bracket.`,
      span,
    );
  }

  if (candidate.code === "let-binding") {
    const head = headOf(candidate, forms, "LET");
    return describeBracket(
      line,
      `the ${head} binding list read a body form as a binding; each binding is a name or a (name value) pair. Check the ${head} form for a missing closing bracket.`,
      span,
    );
  }

  if (candidate.code === "do-binding") {
    const head = headOf(candidate, forms, "DO");
    return describeBracket(
      line,
      `the ${head} binding list read the form below it as a binding; each ${head} binding is a name or (name init step). Check the ${head} form for a missing closing bracket.`,
      span,
    );
  }

  if (candidate.code === "do-end-test") {
    const head = headOf(candidate, forms, "DO");
    return describeBracket(
      line,
      `the ${head} form lost its end-test clause, so a body form was read in its place; it takes (end-test result*) after the bindings. Check the ${head} form for a missing closing bracket.`,
      span,
    );
  }

  if (candidate.code === "iteration-spec") {
    const head = headOf(candidate, forms, "DOTIMES");
    const spec =
      head === "DOLIST"
        ? "(variable list [result])"
        : "(variable count [result])";
    return describeBracket(
      line,
      `the ${head} spec read a body form as part of it; it takes ${spec}. Check the ${head} form for a missing closing bracket.`,
      span,
    );
  }

  return undefined;
}

// The form a shape mark is about starts at its own offset, so its head names the
// form in the message.
function headOf(
  candidate: Diagnostic,
  forms: readonly AstNode[],
  fallback: string,
): string {
  const form = listAt(forms, candidate.position.offset);
  return form === undefined ? fallback : (headName(form) ?? fallback);
}

function describeBracket(
  line: number,
  clause: string,
  span: Span,
): Diagnostic {
  const diagnostic: Diagnostic = {
    code: "bracket-mismatch",
    severity: "error",
    message: `Bracket mismatch at line ${line}: ${clause}`,
    position: span.position,
  };
  return span.end === undefined
    ? diagnostic
    : { ...diagnostic, end: span.end };
}

function operandHint(head: string): string | undefined {
  switch (head) {
    case "IF":
      return "2 or 3: a test-form, a then-form and an optional else-form";
    case "SETQ":
      return "pairs: a variable that is set and a form representing the value to be set";
    case "SETF":
      return "pairs: a place and a form";
    case "RETURN":
      return "at most one value";
    case "PUSH":
      return "a value and a place";
    case "POP":
      return "a place";
    case "INCF":
    case "DECF":
      return "a place and an optional amount";
    case "MULTIPLE-VALUE-SETQ":
      return "a list of names and one form";
    case "MULTIPLE-VALUE-BIND":
      return "a list of names and the form that produces the values";
    case "DEFPARAMETER":
      return "a name, an initial value and an optional description";
    case "DEFVAR":
      return "a name with an optional initial value and description";
    default:
      return undefined;
  }
}

function describeArity(min: number, max: number | null): string {
  if (max === null) return `at least ${min}`;
  if (min === max) return `exactly ${min}`;
  return `${min} to ${max}`;
}

function headName(list: ListNode): string | undefined {
  const head = list.children[0];
  if (head === undefined || head.kind !== "atom" || head.atomType !== "symbol")
    return undefined;
  return String(head.value).toUpperCase();
}

// The list that starts at this exact offset, which is how a shape mark records
// the form it is about.
function listAt(
  forms: readonly AstNode[],
  offset: number,
): ListNode | undefined {
  let found: ListNode | undefined;
  forEachList(forms, (list) => {
    if (list.start.offset === offset) found = list;
  });
  return found;
}

// The call whose head starts at this offset, which is what an arity mark points
// at: the squiggle should cover the call, not the bare name.
function callingListAt(
  forms: readonly AstNode[],
  offset: number,
): ListNode | undefined {
  let found: ListNode | undefined;
  forEachList(forms, (list) => {
    const head = list.children[0];
    if (head !== undefined && head.start.offset === offset) found = list;
  });
  return found;
}

// The nearest enclosing LABELS or FLET, so a bad entry can name the form it
// belongs to.
function enclosingLocalFunctionForm(
  forms: readonly AstNode[],
  position: Position,
): string | undefined {
  let found: string | undefined;

  const search = (node: AstNode): void => {
    if (node.kind === "quote") {
      search(node.target);
      return;
    }
    if (node.kind !== "list") return;
    if (
      position.offset <= node.start.offset ||
      position.offset >= node.end.offset
    )
      return;

    const head = headName(node);
    if (head === "LABELS" || head === "FLET") found = head;
    for (const child of node.children) search(child);
    if (node.tail !== undefined) search(node.tail);
  };

  for (const form of forms) search(form);
  return found;
}

function forEachList(
  forms: readonly AstNode[],
  visit: (list: ListNode) => void,
): void {
  const walk = (node: AstNode): void => {
    if (node.kind === "quote") {
      walk(node.target);
      return;
    }
    if (node.kind !== "list") return;
    visit(node);
    for (const child of node.children) walk(child);
    if (node.tail !== undefined) walk(node.tail);
  };

  for (const form of forms) walk(form);
}

// The names the file would define if its missing closers were supplied, or null
// when even that read fails. Only the symbol table is used: the hypothetical
// forms are never evaluated or reported as mistakes of their own.
function recoveredNames(
  recovered: RecoveredParse | null,
): ReadonlySet<string> | null {
  if (recovered === null) return null;
  const symbols = collectSymbols([...recovered.forms]);
  return new Set([...symbols.variables.keys(), ...symbols.functions.keys()]);
}

// A missing closer swallows the rest of the file, so a name defined after it
// looks undefined. A warning is kept only when the file really lacks the name:
// it is visible in what parsed, or the recovered text does not define it
// either. When the recovered read fails the answer is unknown and the warning
// is dropped, so that a shown warning always means a separate mistake.
function withoutHiddenNameWarnings(
  diagnostics: readonly Diagnostic[],
  forms: readonly AstNode[],
  recovered: ReadonlySet<string> | null,
): Diagnostic[] {
  const parsed = collectSymbols([...forms]);
  const visible = new Set([
    ...parsed.variables.keys(),
    ...parsed.functions.keys(),
  ]);

  return diagnostics.filter((diagnostic) => {
    if (!NAME_CODES.has(diagnostic.code)) return true;
    if (diagnostic.name === undefined || visible.has(diagnostic.name)) return true;
    return recovered !== null && !recovered.has(diagnostic.name);
  });
}

