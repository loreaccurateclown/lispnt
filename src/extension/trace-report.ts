import { renderTrace, type TraceRenderOptions } from "../core/trace";
import { traceCases } from "../core/trace-cases";

// A trace needs a call, and learner files define functions without calling them,
// so the cases come from the ;;[trace] markers a learner writes above a
// definition. With no marker there is nothing to trace, and the report says how
// to add one rather than showing an empty page.

export const TRACE_SCHEME = "lispnt-trace";
export const TRACE_URI = `${TRACE_SCHEME}:/Trace`;

export function formatTraceReport(path: string, source: string): string {
  const cases = traceCases(source);
  const lines: string[] = [`;; Lispnt trace for ${path}`, ""];

  if (cases.length === 0) {
    lines.push(
      "No ;;[trace] calls in this file.",
      "",
      "Write ;;[trace] (function-name test-value) above a function definition, then",
      "run the command again:",
      "",
      "    ;;[trace] (fact 4)",
      "",
      "SBCL ignores the comment, so the file still loads unchanged. A number limits",
      "the calls shown per level: ;;[trace:3] shows three.",
    );
    return lines.join("\n");
  }

  for (const one of cases) {
    lines.push(`;; line ${one.line}  ${one.expression}`);

    if (one.status === "unreadable" || one.trace === null) {
      lines.push("   this call could not be read as an expression");
      lines.push("");
      continue;
    }

    const options: TraceRenderOptions =
      one.limit === undefined
        ? { explain: true }
        : { explain: true, limit: one.limit };
    lines.push(renderTrace(one.trace, options));
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
