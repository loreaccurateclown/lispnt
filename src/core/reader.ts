import { diagnosticFromError } from "./diagnostics";
import { ReaderError } from "./errors";

export interface Position {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

export interface AtomNode {
  readonly kind: "atom";
  readonly atomType: "symbol" | "number" | "string" | "char"; //This is apparently needed due to JS treating string values and Lisp symbols as equivalent.
  readonly value: unknown;
  readonly start: Position;
}

export interface ListNode {
  readonly prefix?: string; //covers #() vector definitions, optional prefix because it's not super common when learning (but may be used by a precocious learner i guess)
  readonly kind: "list";
  readonly children: AstNode[];
  readonly start: Position;
  readonly end: Position;
  readonly tail?: AstNode;
}

export interface QuoteNode {
  //I decided to not desugar '() as shorthand for (quote) as this is primarily a user-oriented linter and should always be able to traverse their code as they wrote it
  readonly kind: "quote";
  readonly quoteKind: "'" | "#'";
  readonly target: AstNode;
  readonly start: Position; //' or #
  readonly end: Position;
}
export interface Reader {
  parse(): AstNode;
  parseAll(): AstNode[];
  next(): NextResult;
}

export type AstNode = AtomNode | ListNode | QuoteNode;

export type NextResult = //for Slice 3 - recovery after analysis
  | { kind: "node"; node: AstNode }
  | { kind: "error"; error: ReaderError }
  | { kind: "end" };

const carriageReturnsAndSpaces = [" ", "\t", "\n", "\r"]; //Is there an award for worst var names
const atomDelimiters = [...carriageReturnsAndSpaces, "(", ")"]; //spread operator pretty cool! fish wants a helper function but idk

// Characters that cannot be written as themselves after #\, because the reader
// would consume the character as whitespace or structure. Names are matched
// case-insensitively, as in CL; a single character is taken literally.
const namedChars = new Map<string, string>([
  ["SPACE", " "],
  ["NEWLINE", "\n"],
  ["TAB", "\t"],
]);

export function parse(source: string): AstNode {
  //this used to be createReader, then fish told me to turn it into a factory
  return createReader(source).parse();
}

export function parseAll(source: string): AstNode[] {
  //factories are pretty neat, honestly.
  return createReader(source).parseAll();
}

export function createReader(source: string): Reader {
  //throw new Error("parse: not implemented"); //I could delete this, but I won't
  let offset = 0;
  let line = 1;
  let column = 1;

  function peek(): string | undefined {
    return source[offset];
  }

  function peekAt(n: number): string | undefined {
    return source[offset + n];
  }

  function advance(): string | undefined {
    const ch = source[offset]; //current character is at offset
    if (ch === undefined) {
      //exit if undefined, according to big fish this is good because it returns without moving the "carriage"
      return undefined;
    }

    offset += 1; //advance offset, ch remains at previous offset
    if (ch === "\n") {
      line += 1; //newline, obvs
      column = 1; //reset column for newline (wonder how this works with VS Code auto-indent? tabs are 1 space iirc?)
    } else {
      column += 1; //advance horizontally if not newline I guess
    }

    return ch; //offset is advanced so we can call advance again and actually get the next value and we return ch which is offset - 1
  }

  function here(): Position {
    //getter for our local state vars
    return {
      line: line,
      column: column,
      offset: offset,
    };
  }

  //a monument to my previous hubris
  // function skipSpaces(): void { //fish wanted to call this "skipTrivia" which is fair but idgi
  //   for (const item of carriageReturnsAndSpaces) {        //fish wants to while loop this and I kinda don't get it. wouldn't it be simpler to just peek() check each array in a for?
  //       if (peek() === item) {
  //         advance();
  //       }
  //     }
  //   }

  //a monument to my current hubris
  function skipTrivia(): void {
    let ch = peek();
    //reference: carriageReturnsAndSpaces = [" ", "\t", "\n", "\r"]
    while (
      ch !== undefined &&
      (carriageReturnsAndSpaces.includes(ch) ||
        ch === ";" ||
        (ch === "#" && peekAt(1) === "|"))
    ) {
      if (ch === ";") {
        advance();
        let c = peek();
        while (c !== undefined && c !== "\n") {
          advance();
          c = peek(); //assuming this runs to the end of the comment (eof or newline)
        }
      } else if (ch === "#" && peekAt(1) === "|") {
        const blockCommentStart = here();
        advance();
        advance(); //move over two characters
        let depth = 1;
        while (depth > 0) {
          const c = peek(); //assuming const means it won't get overwritten every loop iter here
          if (c === undefined)
            throw new ReaderError(
              "unterminated-block-comment",
              blockCommentStart,
              "unterminated block comment",
            );
          if (c === "#" && peekAt(1) === "|") {
            advance();
            advance(); //as janky as this looks it's still better than making an advanceBy helper imo
            depth += 1;
          } else if (c === "|" && peekAt(1) === "#") {
            advance();
            advance();
            depth -= 1;
          } else {
            advance();
          }
        }
      } else {
        advance();
      }
      ch = peek(); //keep ch moving
    }
  }

  function readAtom(): AtomNode {
    const start = here(); //cute
    const chars: string[] = []; //this is a const which initially threw me as obvs we're gonna mutate it
    let ch = peek(); //e.g. this, which was originally a const but needed to be let-ted to change

    //reference: atomDelimiters = [...carriageReturnsAndSpaces, "(", ")"]
    while (ch !== undefined && !atomDelimiters.includes(ch)) {
      //while we're not looking at a space or EOF
      chars.push(ch); //turns out you can mutate a const freely so long as you dont '=' rebind it again
      advance();
      ch = peek();
    }
    const text = chars.join(""); //join the chars into a string. Probably a type thing (I guess String arrays aren't contiguous. Actually this is a char array, but type is string array. This comment is too long.)

    const n = Number(text);
    const checkIfNum = text !== "" && !Number.isNaN(n);

    return {
      kind: "atom",
      atomType: checkIfNum ? "number" : "symbol",
      value: checkIfNum ? n : text,
      start, //pretty cool that you can just return a value with the same name without needing to specify the field
    };
  }

  // #\a / #\A / #\Space. A character is one character taken literally, case
  // preserved; longer text is a character name. A name we do not know, or a
  // lone #\, stays the symbol it used to be rather than inventing a reader
  // error for syntax CL accepts but we do not model.
  function readChar(): AtomNode {
    const start = here();
    advance(); //past "#"
    advance(); //past "\"

    const first = peek();
    if (first === undefined)
      return { kind: "atom", atomType: "symbol", value: "#\\", start };

    if (atomDelimiters.includes(first) || first === '"') {
      advance();
      return { kind: "atom", atomType: "char", value: first, start };
    }

    const chars: string[] = [];
    let ch = peek();
    while (ch !== undefined && !atomDelimiters.includes(ch)) {
      chars.push(ch);
      advance();
      ch = peek();
    }
    const text = chars.join("");

    if (text.length === 1)
      return { kind: "atom", atomType: "char", value: text, start };

    const named = namedChars.get(text.toUpperCase());
    if (named !== undefined)
      return { kind: "atom", atomType: "char", value: named, start };

    return { kind: "atom", atomType: "symbol", value: `#\\${text}`, start };
  }

  function readNode(): AstNode {
    //apparently you can just declare your return type as a union... TypeScript is crazy
    skipTrivia(); //move past no-op's
    const ch = peek(); //grab

    switch (
      ch //I think the fishtention was to use if statements here but I can't resist a good switch case
    ) {
      case undefined:
        throw new ReaderError(
          "unexpected-eof",
          here(),
          "unexpected end of input (EOF)",
        ); //transitioned from plain Error throws to our own class that extends Error
      case "(":
        return readList(); //JS hoisting is a neat concept but feels strange
      case '"':
        return readString();
      case ")":
        throw new ReaderError("stray-closer", here(), "stray closer detected");
      case "'": //I initially wrote this switch statement on a whim but it's actually paid off massively for easily adding conditionals. Go figure.
        return readQuote("'", 1);
      case "#":
        if (peekAt(1) === "(") {
          //#(, start of vector literal
          const start = here();
          advance();
          return readList(start, "#(");
        }
        if (peekAt(1) === "'") return readQuote("#'", 2);
        if (peekAt(1) === "\\") return readChar();
        return readAtom();
      default: //Good explanation for switch efficiency vs a big if statement: you can check all conditionals immediately with an if,
        //while a switch will ALWAYS have to check the upper cases before resolving to our common form.
        //since the vast majority of our read data is atoms, this adds mandatory extra processing compared to an if which can test and exit immediately.
        return readAtom();
    }
  }

  function readList(start: Position = here(), prefix?: string): ListNode {
    advance();
    const children: AstNode[] = [];
    skipTrivia();

    let ch = peek();
    while (ch !== undefined && ch !== ")") {
      const next = peekAt(1);
      const isDot =
        peek() === "." && (next === undefined || atomDelimiters.includes(next));

      if (isDot) {
        if (children.length === 0) {
          throw new ReaderError(
            "dotted-tail-without-head",
            here(),
            "dotted pair missing first element",
          );
        }
        advance(); //past the "."
        skipTrivia();
        const tail = readNode();
        skipTrivia(); //maybe it would have been better to do an optional bool passed to any reader function in case we don't want to skip trivia but that seems a bit hard to intuit

        if (peek() !== ")") {
          throw new ReaderError(
            "dotted-tail-extra-form",
            here(),
            "dotted PAIR has more than one form after the dot.",
          ); //maybe a little obnoxious for the error message but brevity is important when delivering bad news
        }

        advance();
        const end = here();
        if (prefix === undefined)
          return { kind: "list", children, start, end, tail };
        //otherwise:
        return { kind: "list", prefix, children, start, end, tail }; //apparently it's not possible to do e.g. #(1 . 2) since they're different types so this is unreachable and exists only for TS's type checker.
      }

      children.push(readNode()); //feels very elegant. Well, if I wrote it myself anyway.
      skipTrivia(); //it feels inefficient to manually call skipTrivia after calling readNode which has it anyway,
      // but it's probably more dangerous trying to automate it/move it to the called funcs
      ch = peek(); //starting to recognize this pattern
    }
    if (ch === undefined)
      throw new ReaderError("unterminated-list", start, "unterminated list");
    advance();
    const end = here(); //as above, so below

    if (prefix === undefined) {
      return {
        kind: "list",
        children,
        start,
        end,
      };
    }

    return {
      kind: "list",
      prefix,
      children,
      start,
      end,
    };
  }

  function readString(): AtomNode {
    const start = here();
    advance();
    const chars: string[] = [];

    let ch = peek();

    while (ch !== undefined && ch !== '"') {
      if (ch === "\\") {
        //Was confused why my char was 2 chars here till I realized you also need to escape it as a string in JS
        advance();
        const next = peek();
        if (next === undefined)
          throw new ReaderError(
            "unterminated-string",
            start,
            "unterminated string",
          );
        chars.push(next);
        advance();
      } else {
        chars.push(ch);
        advance();
      }
      ch = peek();
    }

    if (ch === undefined)
      throw new ReaderError(
        "unterminated-string",
        start,
        "unterminated string",
      );
    advance();

    return {
      kind: "atom",
      atomType: "string",
      value: chars.join(""),
      start,
    };
  }

  function readQuote(quoteKind: "'" | "#'", consumedLength: number): QuoteNode {
    const start = here(); //position of the ' or the #
    advance(); //the "'" or the "#"
    if (consumedLength === 2) advance(); //the "'" of "#'"
    skipTrivia();
    const target = readNode(); //notably not readAtom, as there may be a bracket '() requiring readList or 'text requiring readAtom
    const end = here(); //thanks to advance
    return { kind: "quote", quoteKind, target, start, end };
  }

  function parse(): AstNode {
    //the block comment below doesn't really make sense now I guess. Oh well.
    //Actual body of parse
    skipTrivia(); //no trivia!
    if (peek() === undefined)
      throw new ReaderError("empty-input", here(), "undefined input"); //could be either I guess?
    const node = readNode();
    skipTrivia(); //absolutely none!
    if (peek() !== undefined)
      throw new ReaderError(
        "trailing-content",
        here(),
        "form contains extra data",
      );
    /* So we will apparently loop this to read multiple top-level forms (i.e. defun, defvar)
      and thus this should terminate cleanly after reading one form, extra data is invalid */
    return node;
  }

  function parseAll(): AstNode[] {
    const nodes: AstNode[] = [];
    while (true) {
      //it's over...
      const result = next();
      switch (result.kind) {
        case "end":
          return nodes;
        case "error":
          throw result.error;
        case "node":
          nodes.push(result.node);
          break;
      }
    }
  }
  // //reference:
  //   | { kind: "node"; node: AstNode }
  //   | { kind: "error"; error: ReaderError }
  //   | { kind: "end" };
  function next(): NextResult {
    //approved of this function after discussing the cost/benefit of modular, reusable code with the fish. Harder to comprehend on the writer's end but much better from the execution end.
    // skipTrivia belongs inside the try: an unterminated block comment is reported
    // from there, and a throw escaping next() reached the caller as a crash
    // instead of a diagnostic.
    try {
      skipTrivia();
      if (peek() === undefined) return { kind: "end" };

      return { kind: "node", node: readNode() };
    } catch (error) {
      if (!(error instanceof ReaderError)) throw error;
      if (peek() !== undefined) advance(); //move to next character, I assume to avoid chain-erroring in place (with basic EOF check)
      return { kind: "error", error };
    }
  }

  return { parse, parseAll, next };
}
