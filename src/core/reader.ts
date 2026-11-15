export interface Position {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

export interface AtomNode {
  readonly kind: "atom";
  readonly atomType: "symbol" | "number" | "string"; //This is apparently needed due to JS treating string values and Lisp symbols as equivalent.
  readonly value: unknown;
  readonly start: Position;
}

export interface ListNode {
  readonly prefix?: string; //covers #() vector definitions, optional prefix because it's not super common when learning (but may be used by a precocious learner i guess)
  readonly kind: "list";
  readonly children: AstNode[];
  readonly start: Position;
  readonly end: Position;
}

export interface QuoteNode {
  //I decided to not desugar '() as shorthand for (quote) as this is primarily a user-oriented linter and should always be able to traverse their code as they wrote it
  readonly kind: "quote";
  readonly target: AstNode;
  readonly start: Position; //'
  readonly end: Position;
}

export interface Reader {
  parse(): AstNode;
  parseAll(): AstNode[];
}

const carriageReturnsAndSpaces = [" ", "\t", "\n", "\r"]; //Is there an award for worst var names
const atomDelimiters = [...carriageReturnsAndSpaces, "(", ")"]; //spread operator pretty cool! fish wants a helper function but idk

export type AstNode = AtomNode | ListNode | QuoteNode;

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
        advance();
        advance(); //move over two characters
        let depth = 1;
        while (depth > 0) {
          const c = peek(); //assuming const means it won't get overwritten every loop iter here
          if (c === undefined) throw Error("unterminated sequence");
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

  function readNode(): AstNode {
    //apparently you can just declare your return type as a union... TypeScript is crazy
    skipTrivia(); //move past no-op's
    const ch = peek(); //grab

    switch (
      ch //I think the fishtention was to use if statements here but I can't resist a good switch case
    ) {
      case undefined:
        throw Error("unexpected end of input");
      case "(":
        return readList(); //JS hoisting is a neat concept but feels strange
      case '"':
        return readString();
      case ")":
        throw Error("stray closer detected");
      case "'": //I initially wrote this switch statement on a whim but it's actually paid off massively for easily adding conditionals. Go figure.
        return readQuote();
      case "#":
        if (peekAt(1) === "(") {
          //#(, start of vector literal
          const start = here();
          advance();
          return readList(start, "#(");
        }
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
      children.push(readNode()); //feels very elegant. Well, if I wrote it myself anyway.
      skipTrivia(); //it feels inefficient to manually call skipTrivia after calling readNode which has it anyway,
      // but it's probably more dangerous trying to automate it/move it to the called funcs
      ch = peek(); //starting to recognize this pattern
    }
    if (ch === undefined) throw Error("unterminated sequence"); //dunno if that's the right error string.
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
        if (next === undefined) throw Error("unterminated string"); //dunno about error string but its unique at least
        chars.push(next);
        advance();
      } else {
        chars.push(ch);
        advance();
      }
      ch = peek();
    }

    if (ch === undefined) throw Error("unterminated string");
    advance();

    return {
      kind: "atom",
      atomType: "string",
      value: chars.join(""),
      start,
    };
  }

  function readQuote(): QuoteNode {
    const start = here(); //position of the '
    advance();
    const target = readNode(); //notably not readAtom, as there may be a bracket '() requiring readList or 'text requiring readAtom
    const end = here(); //thanks to advance
    return { kind: "quote", target, start, end };
  }

  function parse(): AstNode {
    //the block comment below doesn't really make sense now I guess. Oh well.
    //Actual body of parse
    skipTrivia(); //no trivia!
    if (peek() === undefined)
      throw Error("End of File or unterminated sequence"); //could be either I guess?
    const node = readNode();
    skipTrivia(); //absolutely none!
    if (peek() !== undefined) throw Error("form contains extra data");
    /* So we will apparently loop this to read multiple top-level forms (i.e. defun, defvar)
      and thus this should terminate cleanly after reading one form, extra data is invalid */
    return node;
  }

  function parseAll(): AstNode[] {
    const nodes: AstNode[] = [];
    skipTrivia(); //trivia is eternal
    while (peek() !== undefined) {
      nodes.push(readNode());
      skipTrivia();
    }
    return nodes;
  }
  return { parse, parseAll };
}
