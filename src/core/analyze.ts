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
import { type AstNode, createReader, type Position } from "./reader";
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

  for (const error of readerErrors) {
    diagnostics.push(diagnosticFromError(error, lastCompleteLine));
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

  const missingCloser = readerErrors.find(
    (error) => error.code === "unterminated-list",
  );
  if (missingCloser === undefined) return diagnostics;

  return withoutHiddenNameWarnings(
    diagnostics,
    forms,
    recoveredNames(source, missingCloser),
  );
}

// The names the file would define if its missing closers were supplied, or null
// when even that read fails. Only the symbol table is used: the hypothetical
// forms are never checked, evaluated or reported.
function recoveredNames(
  source: string,
  error: ReaderError,
): ReadonlySet<string> | null {
  const count = Math.max(1, error.openForms?.length ?? 1);
  const reader = createReader(source + ")".repeat(count));
  const forms: AstNode[] = [];

  for (;;) {
    const result = reader.next();
    if (result.kind === "end") break;
    if (result.kind === "error") return null;
    forms.push(result.node);
  }

  const symbols = collectSymbols(forms);
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
