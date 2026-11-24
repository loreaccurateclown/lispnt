import type { Position } from "./reader";

// A list the reader is still inside when it reaches the end of the file. The
// position is its opening parenthesis; headEnd is the position just past the
// form's head, so a diagnostic can underline `(let` instead of one character.
export interface OpenForm {
  readonly position: Position;
  readonly headEnd?: Position;
}

export class ReaderError extends Error {
  // Innermost first. Only an unterminated list carries these, and only when it
  // is nested: the reader learns about the enclosing lists while the error
  // unwinds through them.
  readonly openForms?: readonly OpenForm[];

  constructor(
    readonly code: ReaderErrorCode,
    readonly position: Position,
    message: string,
    options?: {
      readonly openForms?: readonly OpenForm[];
    },
  ) {
    super(message);
    this.name = "ReaderError";
    // Assigned only when present: exactOptionalPropertyTypes forbids writing an
    // explicit undefined over an optional property.
    if (options?.openForms !== undefined) this.openForms = options.openForms;
  }
}

export class LispEvalError extends Error {
  //LLM Pain Point #50,631: having to tell the fish not to use function names reserved by TS libraries
  constructor(
    readonly code: EvalErrorCode,
    readonly position: Position | null,
    message: string,
  ) {
    super(message);
    this.name = "LispEvalError";
  }
}

export type EvalErrorCode =
  | "arity"
  | "type-error"
  | "index-error"
  | "division-by-zero"
  | "not-a-place"
  | "malformed-form"
  | "evaluation-budget"
  | "unbound-variable"
  | "undefined-function"
  | "unsupported-standard"
  | "signalled-error"; //(error …) in the learner's own code

export type ReaderErrorCode =
  | "empty-input" //parsing trivia
  | "trailing-content" //parsing a second form
  | "stray-closer" //readNode: ')' where form was expected
  | "unexpected-eof" //readNode: EOF where a form was expected
  | "unterminated-list" //readList: EOF before ')'
  | "unterminated-string" //readString: EOF before closing quote
  | "unterminated-block-comment" //skipTrivia: EOF before '|#'
  | "dotted-tail-without-head" //dotted pairs: ( . 2) (missing first element of pair)
  | "dotted-tail-extra-form"; //dotted pairs: (1 . 2 3) or (1 . 2 . 3), since it's a pair it can't have more than two forms
