import type { Position } from "./reader";

export class ReaderError extends Error {
  constructor(
    readonly code: ReaderErrorCode,
    readonly position: Position,
    message: string,
  ) {
    super(message);
    this.name = "ReaderError";
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
  | "unsupported-standard";

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
