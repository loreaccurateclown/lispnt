import { Diagnostic, diagnosticFromError } from "./diagnostics";
import { createReader } from "./reader";

export function analyze(source: string): Diagnostic[] {
  const reader = createReader(source);
  const diagnostics: Diagnostic[] = [];
  let result = reader.next();

  while (result.kind !== "end") {
    //I didn't want to for(;;;) or while(true)
    switch (result.kind) { //I have however made the switch statement pointless through this. Oh well.
      case "error":
        diagnostics.push(diagnosticFromError(result.error));
      case "node":
        //pass
    }
    result = reader.next();
  }
  return diagnostics;
}
