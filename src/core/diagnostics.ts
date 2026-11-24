import {
  ReaderErrorCode,
  ReaderError,
  EvalErrorCode,
  LispEvalError,
} from "./errors";
import type { Position } from "./reader";

export type DiagnosticSeverity = "error" | "warning" | "info";

export type ShapeCode =
  | "defun-name"
  | "defun-arglist"
  | "lambda-arglist"
  | "let-bindings"
  | "local-definitions"
  | "local-definition";

// Name mistakes found without evaluating the file. The other three codes these
// checks use (undefined-function, unbound-variable, arity) come from EvalErrorCode
// because the evaluator can find the same mistakes in code that actually runs.
export type NameCode = "variable-as-function";

// A Lispnt convention rather than a Lisp one: the ;;[trace] marker names the call
// to follow, and written without one it does nothing.
export type TraceCode = "trace-marker";

export type DiagnosticCode =
  | ReaderErrorCode
  | ShapeCode
  | EvalErrorCode
  | NameCode
  | TraceCode;

export interface Diagnostic {
  //ideally this naming won't collide with vscode.Diagnostic
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly position: Position; //where the squiggle starts; M2 deferred the rest to this layer
  // Where the squiggle stops, when the mistake is longer than its start. Absent
  // means the presentation layer underlines the whole line, as before.
  readonly end?: Position;
  // The name a name check is about. Analysis uses it to tell a mistake the file
  // really has from one the missing brackets hid.
  readonly name?: string;
}

export function diagnosticFromError(
  error: ReaderError,
  lastCompleteLine?: number,
): Diagnostic {
  const message = readerMessage(error, lastCompleteLine);
  const diagnostic: Diagnostic = {
    code: error.code,
    severity: "error",
    message,
    position: error.position,
  };
  // An unclosed form underlines from its `(` through its head, as in `(let`.
  const end = error.openForms?.[0]?.headEnd;
  return end === undefined ? diagnostic : { ...diagnostic, end };
}

export function diagnosticFromEvalError(
  error: LispEvalError,
  fallback: Position,
): Diagnostic {
  return {
    code: error.code,
    severity: "error",
    // A signalled error carries the learner's own message, which is the point
    // of calling (error "…").
    message: error.code === "signalled-error" ? error.message : evalMessage(error.code),
    position: error.position ?? fallback,
  };
}

function evalMessage(code: EvalErrorCode): string {
  switch (code) {
    case "arity":
      return "Wrong number of arguments for this function.";
    case "type-error":
      return "That value is not the type this operation needs.";
    case "index-error":
      return "That index is outside the sequence.";
    case "division-by-zero":
      return "Division by zero.";
    case "not-a-place":
      return "That form cannot be assigned to.";
    case "malformed-form":
      return "This form is missing part of its syntax.";
    case "evaluation-budget":
      return "This code ran too long to check safely.";
    case "unbound-variable":
      return "This name has no value here. Check the spelling, or define it with defparameter or let.";
    case "undefined-function":
      return "No function with this name is defined. Check the spelling, or define it with defun.";
    case "unsupported-standard":
      return "Lispnt does not implement this standard Common Lisp function yet.";
    case "signalled-error":
      return "This code signals an error.";
  }
}

function readerMessage(error: ReaderError, lastCompleteLine?: number): string {
  if (error.code === "unterminated-list") {
    return unterminatedListMessage(error, lastCompleteLine);
  }
  return userMessageSwitcher(error.code);
}

// An unclosed form is the one reader mistake whose repair depends on how much
// is missing, so the message counts the closers instead of asking for "a" `)`.
// The learner has to add them at the end of the file; naming the outermost form
// says where the first of them belongs, and the last complete form says where
// checking stopped.
function unterminatedListMessage(
  error: ReaderError,
  lastCompleteLine?: number,
): string {
  const openForms = error.openForms ?? [];
  const count = Math.max(1, openForms.length);
  const outermost = openForms[openForms.length - 1];
  const closers = ")".repeat(count);

  const tick = "`";
  const short =
    count === 1
      ? "This form never closes, so the file ends 1 `)` short. Add `)` after the last line."
      : `${count} lists are still open, so the file ends ${count} ${tick})${tick} short. Add ${tick}${closers}${tick} after the last line; the outermost opened on line ${outermost?.position.line ?? error.position.line}.`;

  return lastCompleteLine === undefined
    ? short
    : `${short} The last complete form ends on line ${lastCompleteLine}.`;
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
    case "dotted-tail-extra-form": //In retrospect any Lisp learners' course teaching dotted pairs is probably doing something terribly wrong. Still tho
      return "This dotted pair has too many forms after the dot. It is a cons cell and can only hold two forms.";
    case "dotted-tail-without-head":
      return "This dotted pair is missing its first element. It is a cons cell and requires a car and cdr.";
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
