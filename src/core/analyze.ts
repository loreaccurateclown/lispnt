import { checkForms } from "./checks";
import {
  type Diagnostic,
  diagnosticFromEvalError,
  diagnosticFromError,
} from "./diagnostics";
import { LispEvalError } from "./errors";
import {
  createEnv,
  evaluate,
  HARD_STEP_CEILING,
  ReturnSignal,
  withStepCeiling,
} from "./interpreter";
import { type AstNode, createReader } from "./reader";

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

export function analyze(source: string): Diagnostic[] {
  const reader = createReader(source);
  const diagnostics: Diagnostic[] = [];
  const forms: AstNode[] = [];

  let result = reader.next();
  while (result.kind !== "end") {
    if (result.kind === "error") {
      diagnostics.push(diagnosticFromError(result.error));
    } else {
      forms.push(result.node);
    }
    result = reader.next();
  }

  diagnostics.push(...checkForms(forms));

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

  return withStepCeiling(HARD_STEP_CEILING, () => {
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

    return diagnostics;
  });
}
