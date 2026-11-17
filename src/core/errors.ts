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

export type ReaderErrorCode =
  | "empty-input" //parsing trivia
  | "trailing-content" //parsing a second form
  | "stray-closer" //readNode: ')' where form was expected
  | "unexpected-eof" //readNode: EOF where a form was expected
  | "unterminated-list" //readList: EOF before ')'
  | "unterminated-string" //readString: EOF before closing quote
  | "unterminated-block-comment"; //skipTrivia: EOF before '|#'
