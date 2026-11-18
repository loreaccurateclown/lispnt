import { checkForms } from "./checks";
import { type Diagnostic, diagnosticFromError } from "./diagnostics";
import { type AstNode, createReader } from "./reader";

export function analyze(source: string): Diagnostic[] {
  const reader = createReader(source);
  const diagnostics: Diagnostic[] = [];
  const forms: AstNode[] = [];

  let result = reader.next();

  while (result.kind !== "end") {
    if (result.kind === "error")
      diagnostics.push(diagnosticFromError(result.error));
    else forms.push(result.node); //it's so nice being able to do this inline.

    result = reader.next();
  }
  diagnostics.push(...checkForms(forms)); //spread checkForms and push
  return diagnostics;
}
