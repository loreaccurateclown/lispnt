import { ReaderErrorCode, ReaderError } from "./errors";
import type { Position } from "./reader";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  //ideally this naming won't collide with vscode.Diagnostic
  readonly code: ReaderErrorCode; //to be widened when we actually parse the AST's meaning
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly position: Position; //one position for now, will be converted into range later
}

export function diagnosticFromError(error: ReaderError): Diagnostic {
  const userMessage = userMessageSwitcher(error.code);

  return {
    code: error.code,
    severity: "error",
    message: userMessage,
    position: error.position,
  };
}

function userMessageSwitcher(errorMessage: ReaderErrorCode): string {
  //Apparently js will find the first valid case and then execute all after it, unless you break/return
  switch (
    errorMessage //coulda used a Record here but I like this more. May still be necessary later.
  ) {
    case "stray-closer":
      return "Unexpected ')': nothing is open here";
    case "empty-input":
      return "Nothing to parse.";
    case "unterminated-list":
      return "This list is never closed. Add a `)`.";
    case "unterminated-string":
      return 'This string is never closed. Add a closing `"`.';
    case "unterminated-block-comment":
      return "This block comment is never closed. Add a closing `|#`.";
    case "unexpected-eof":
      return "Unexpected end of file.";
    case "trailing-content":
      return "Unexpected extra form.";
  }
}

// //reference
//   | "empty-input" //parsing trivia
//   | "trailing-content" //parsing a second form
//   | "stray-closer" //readNode: ')' where form was expected
//   | "unexpected-eof" //readNode: EOF where a form was expected
//   | "unterminated-list" //readList: EOF before ')'
//   | "unterminated-string" //readString: EOF before closing quote
//   | "unterminated-block-comment"; //skipTrivia: EOF before '|#'
