import { LispEvalError } from "./errors";
import type { AstNode, ListNode } from "./reader";

// The LOOP clause grammar Lispnt models. Deliberately a subset: a clause word
// that is not in this grammar is reported as unsupported-standard, never
// silently skipped, so an unimplemented clause cannot change what a loop means.
//
// Not modelled on purpose: `named`, `thereis`/`always`/`never`, `nconc`, `with`,
// destructuring drivers, `for … = … then`, package iteration, and the
// hash-table drivers (which arrive with hash tables).

export type LoopDriver =
  | {
      readonly kind: "sequence";
      readonly name: string;
      readonly how: "in" | "on" | "across";
      readonly source: AstNode;
      readonly by?: AstNode;
    }
  | {
      readonly kind: "range";
      readonly name: string;
      readonly from?: AstNode;
      readonly bound?: RangeBound;
      readonly by?: AstNode;
    }
  | {
      readonly kind: "hash";
      readonly name: string;
      readonly of: "keys" | "values";
      readonly table: AstNode;
      readonly other?: { readonly kind: "key" | "value"; readonly name: string };
    };

interface RangeBound {
  readonly op: "to" | "below" | "above";
  readonly node: AstNode;
}

export type LoopMain =
  | { readonly kind: "do"; readonly forms: AstNode[] }
  | {
      readonly kind:
        | "collect"
        | "append"
        | "sum"
        | "count"
        | "maximize"
        | "minimize";
      readonly form: AstNode;
      readonly into?: string;
    }
  | { readonly kind: "return"; readonly form: AstNode };

export type LoopClause =
  | { readonly kind: "driver"; readonly driver: LoopDriver }
  | {
      readonly kind: "termination";
      readonly test: "while" | "until" | "repeat";
      readonly form: AstNode;
    }
  | { readonly kind: "main"; readonly main: LoopMain }
  | { readonly kind: "initially"; readonly forms: AstNode[] }
  | { readonly kind: "finally"; readonly forms: AstNode[] }
  | {
      readonly kind: "conditional";
      readonly test: "if" | "when" | "unless";
      readonly form: AstNode;
      readonly then: LoopClause[];
      readonly otherwise: LoopClause[];
    }
  // (loop form…) — the simple form: run the forms forever until a RETURN.
  | { readonly kind: "simple"; readonly forms: AstNode[] };

const DRIVER_HEADS = new Set(["FOR", "AS"]);
const HOW = new Set(["IN", "ON", "ACROSS"]);
const RANGE_HEADS = new Set(["FROM", "UPFROM", "DOWNFROM"]);
const BOUNDS = new Set(["TO", "BELOW", "ABOVE"]);
const TERMINATION_HEADS = new Set(["WHILE", "UNTIL", "REPEAT"]);
const DO_HEADS = new Set(["DO", "DOING"]);
type AccumulatorKind =
  | "collect"
  | "append"
  | "sum"
  | "count"
  | "maximize"
  | "minimize";

const ACCUMULATORS: ReadonlyMap<string, AccumulatorKind> = new Map<
  string,
  AccumulatorKind
>([
  ["COLLECT", "collect"],
  ["COLLECTING", "collect"],
  ["APPEND", "append"],
  ["APPENDING", "append"],
  ["SUM", "sum"],
  ["SUMMING", "sum"],
  ["COUNT", "count"],
  ["COUNTING", "count"],
  ["MAXIMIZE", "maximize"],
  ["MAXIMIZING", "maximize"],
  ["MINIMIZE", "minimize"],
  ["MINIMIZING", "minimize"],
]);
const CONDITIONALS = new Set(["IF", "WHEN", "UNLESS"]);

// Any of these starts a clause, so a `do` body ends where one of them begins.
// The unimplemented ones are listed too: they make the loop parse as extended
// syntax and then fail loudly, instead of being read as a simple loop body.
const CLAUSE_WORDS: ReadonlySet<string> = new Set([
  ...DRIVER_HEADS,
  ...TERMINATION_HEADS,
  ...DO_HEADS,
  ...ACCUMULATORS.keys(),
  "INITIALLY",
  "FINALLY",
  "RETURN",
  ...CONDITIONALS,
  "AND",
  // clauses Lispnt knows about but does not model
  "NAMED",
  "WITH",
  "BEING",
  "USING",
  "THEREIS",
  "ALWAYS",
  "NEVER",
  "NCONC",
  "NCONCING",
]);

function word(node: AstNode | undefined): string | undefined {
  if (node === undefined || node.kind !== "atom" || node.atomType !== "symbol")
    return undefined;
  return String(node.value).toUpperCase();
}

function unsupported(node: AstNode, what: string): LispEvalError {
  return new LispEvalError("unsupported-standard", node.start, what);
}

function malformed(node: AstNode, message: string): LispEvalError {
  return new LispEvalError("malformed-form", node.start, message);
}

// Parses the body of a (loop …) form. The simple form is (loop form…), which is
// what a loop whose first token is not a clause word must be.
export function parseLoop(form: ListNode): LoopClause[] {
  const tokens = form.children.slice(1);
  const first = tokens[0];

  if (first === undefined) return [{ kind: "simple", forms: [] }];
  if (word(first) === undefined || !CLAUSE_WORDS.has(word(first)!))
    return [{ kind: "simple", forms: tokens }];

  const parser = new ClauseParser(tokens);
  const clauses: LoopClause[] = [];
  let seenMain = false;

  while (parser.more()) {
    // A bare `and` between clauses joins them; the joined clause is already in
    // the list, so it only needs consuming.
    if (parser.peekWord() === "AND") {
      parser.next();
      continue;
    }

    // SBCL: a driver may follow `initially`, but not a main clause. "FOR does
    // not introduce a LOOP clause that can follow WHEN."
    const head = parser.peekWord();
    const next = parser.peek();
    if (seenMain && head !== undefined && DRIVER_HEADS.has(head))
      throw malformed(
        next!,
        "loop: a for/as clause must come before the loop's body",
      );

    const clause = parser.parseClause();
    if (clause.kind === "main" || clause.kind === "conditional") seenMain = true;
    clauses.push(clause);
  }

  return clauses;
}

class ClauseParser {
  private index = 0;

  constructor(private readonly tokens: readonly AstNode[]) {}

  more(): boolean {
    return this.index < this.tokens.length;
  }

  next(): AstNode {
    const token = this.tokens[this.index];
    if (token === undefined)
      throw new LispEvalError("malformed-form", null, "loop form ended early");
    this.index += 1;
    return token;
  }

  peek(): AstNode | undefined {
    return this.tokens[this.index];
  }

  peekWord(): string | undefined {
    return word(this.peek());
  }

  private currentPosition(): AstNode {
    return this.peek() ?? this.tokens[this.tokens.length - 1]!;
  }

  parseClause(): LoopClause {
    const start = this.currentPosition();
    const head = this.peekWord();
    if (head === undefined)
      throw unsupported(start, "loop: a clause must start with a clause word");

    if (DRIVER_HEADS.has(head)) {
      this.next();
      return { kind: "driver", driver: this.parseDriver() };
    }

    if (TERMINATION_HEADS.has(head)) {
      this.next();
      return {
        kind: "termination",
        test: head.toLowerCase() as "while" | "until" | "repeat",
        form: this.next(),
      };
    }

    if (DO_HEADS.has(head)) {
      this.next();
      return { kind: "main", main: { kind: "do", forms: this.parseForms() } };
    }

    const accumulator = ACCUMULATORS.get(head);
    if (accumulator !== undefined) {
      this.next();
      const form = this.next();
      const into = this.parseInto();
      return into === undefined
        ? { kind: "main", main: { kind: accumulator, form } }
        : { kind: "main", main: { kind: accumulator, form, into } };
    }

    if (head === "INITIALLY") {
      this.next();
      return { kind: "initially", forms: this.parseForms() };
    }

    if (head === "FINALLY") {
      this.next();
      return { kind: "finally", forms: this.parseForms() };
    }

    if (head === "RETURN") {
      this.next();
      return { kind: "main", main: { kind: "return", form: this.next() } };
    }

    if (CONDITIONALS.has(head)) {
      this.next();
      return this.parseConditional(head.toLowerCase() as "if" | "when" | "unless");
    }

    throw unsupported(
      start,
      `loop: the ${head} clause is not implemented`,
    );
  }

  // Consumes forms until the next token starts a clause. SBCL wants compound
  // forms after do, initially and finally ("A compound form was expected").
  private parseForms(): AstNode[] {
    const forms: AstNode[] = [];
    for (;;) {
      const next = this.peek();
      if (next === undefined) return forms;
      const w = word(next);
      if (w !== undefined && CLAUSE_WORDS.has(w)) return forms;
      if (next.kind !== "list")
        throw malformed(
          next,
          "loop: do, initially and finally take compound forms",
        );
      forms.push(this.next());
    }
  }

  private parseDriver(): LoopDriver {
    const nameNode = this.next();
    const name = word(nameNode);
    if (name === undefined)
      throw malformed(nameNode, "loop: a driver needs a variable name");

    if (this.peekWord() === "BEING") return this.parseHashDriver(name);

    const how = this.peekWord();
    if (how !== undefined && HOW.has(how)) {
      this.next();
      const source = this.next();
      const by = this.parseBy();
      return {
        kind: "sequence",
        name,
        how: how.toLowerCase() as "in" | "on" | "across",
        source,
        ...(by === undefined ? {} : { by }),
      };
    }

    const rangeHead = this.peekWord();
    if (
      rangeHead !== undefined &&
      (RANGE_HEADS.has(rangeHead) || BOUNDS.has(rangeHead))
    ) {
      let from: AstNode | undefined;
      if (rangeHead !== undefined && RANGE_HEADS.has(rangeHead)) {
        this.next();
        from = this.next();
      }

      let bound: RangeBound | undefined;
      const boundHead = this.peekWord();
      if (boundHead !== undefined && BOUNDS.has(boundHead)) {
        this.next();
        const op = boundHead.toLowerCase() as "to" | "below" | "above";
        const node = this.next();
        bound = { op, node };
      }

      const by = this.parseBy();
      return {
        kind: "range",
        name,
        ...(from === undefined ? {} : { from }),
        ...(bound === undefined ? {} : { bound }),
        ...(by === undefined ? {} : { by }),
      };
    }

    throw unsupported(
      this.currentPosition(),
      "loop: a driver needs `in`, `on`, `across`, `from`, `to`, `below` or `above`",
    );
  }

  // for k being the hash-keys of table [using (hash-value v)]
  private parseHashDriver(name: string): LoopDriver {
    this.next(); // past BEING
    if (this.peekWord() === "THE") this.next();

    const which = this.peekWord();
    if (
      which !== "HASH-KEYS" &&
      which !== "HASH-KEY" &&
      which !== "HASH-VALUES" &&
      which !== "HASH-VALUE"
    )
      throw unsupported(
        this.currentPosition(),
        "loop: only hash-keys and hash-values can follow BEING",
      );
    this.next();
    const of = which === "HASH-KEYS" || which === "HASH-KEY" ? "keys" : "values";

    const ofWord = this.peekWord();
    if (ofWord !== "OF" && ofWord !== "IN")
      throw malformed(
        this.currentPosition(),
        "loop: a hash driver needs OF or IN before the table",
      );
    this.next();
    const table = this.next();

    let other: { kind: "key" | "value"; name: string } | undefined;
    if (this.peekWord() === "USING") {
      this.next();
      const spec = this.next();
      if (spec.kind !== "list" || spec.children[0] === undefined)
        throw malformed(spec, "loop: USING takes (hash-value v) or (hash-key k)");

      const kindWord = word(spec.children[0]);
      const otherName =
        spec.children[1] === undefined ? undefined : word(spec.children[1]);
      if (otherName === undefined)
        throw malformed(spec, "loop: USING needs a variable name");

      if (kindWord === "HASH-VALUE") other = { kind: "value", name: otherName };
      else if (kindWord === "HASH-KEY") other = { kind: "key", name: otherName };
      else throw malformed(spec, "loop: USING takes (hash-value v) or (hash-key k)");
    }

    return {
      kind: "hash",
      name,
      of,
      table,
      ...(other === undefined ? {} : { other }),
    };
  }

  private parseBy(): AstNode | undefined {
    if (this.peekWord() !== "BY") return undefined;
    this.next();
    return this.next();
  }

  private parseInto(): string | undefined {
    if (this.peekWord() !== "INTO") return undefined;
    this.next();
    const nameNode = this.next();
    const name = word(nameNode);
    if (name === undefined)
      throw malformed(nameNode, "loop: INTO needs a variable name");
    return name;
  }

  // if/when/unless test <clauses> [else <clauses>] [end]
  private parseConditional(
    test: "if" | "when" | "unless",
  ): LoopClause {
    const form = this.next();
    const then = this.parseBody();
    let otherwise: LoopClause[] = [];

    if (this.peekWord() === "ELSE") {
      this.next();
      otherwise = this.parseBody();
    }
    if (this.peekWord() === "END") this.next();

    return { kind: "conditional", test, form, then, otherwise };
  }

  private parseBody(): LoopClause[] {
    const clauses: LoopClause[] = [];
    for (;;) {
      const next = this.peek();
      if (next === undefined) return clauses;

      const w = this.peekWord();
      if (w === "ELSE" || w === "END") return clauses;
      if (w === "AND") {
        this.next();
        continue;
      }

      // SBCL: "FOR does not introduce a LOOP clause that can follow WHEN".
      // A driver belongs among the loop's own variable clauses, not inside a
      // conditional body, where the executor could only ignore it.
      if (w !== undefined && DRIVER_HEADS.has(w))
        throw malformed(
          next,
          "loop: a for/as clause cannot follow when, if or unless",
        );

      clauses.push(this.parseClause());
    }
  }
}
