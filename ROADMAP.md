# Lispnt roadmap

Read-only diagnostic path for Common Lisp (SBCL), alongside OLIVE.

Current state and working conventions live in `HANDOFF.md`; this file is the
long-form milestone plan. Totals today: 270 tests (62 reader, 42 analyze, 119
interpreter, 39 print, 8 pipeline).

## Milestones

- **M1 — Reader.** Text → AST with positions. Atoms, lists, nesting, whitespace. Then comments, strings, quote shorthand.
  *Status: complete — the reader suite, 62 tests. Covers symbols, numbers, strings with escapes, lists, `#(` vector literals (as `ListNode.prefix`), `'` and `#'` quotes (both preserved as `QuoteNode` with `quoteKind`), line comments, nested block comments, half-open positions, `parse`/`parseAll` over a cursor factory. Verified against SBCL on disk fixtures.*
  *Deferred: `#\` char literals, backquote/unquote. `#+`/`#-` read-time conditionals are out of scope.*
- **M2 — Structural analyzer.** Diagnostics over the AST: unbalanced delimiters, stray closers, unterminated strings/comments, malformed `defun`/`let`/`lambda` shapes.
  *Status: complete — the analyze suite, 42 tests. `ReaderError` carries a stable code plus the position of the offending construct; `analyze` returns `Diagnostic[]` with learner-facing messages, recovers past each error via `reader.next()` so a bad form does not hide the rest of the file, and runs AST shape checks (`defun` name/arglist, `lambda` arglist, `let`/`let*` bindings) recursively while skipping quoted data and `#(...)` vectors.*
  *Deferred: diagnostics carry one position, not a range (M6 converts); shape checks do not validate binding entries or arity.*
- **M3 — Interpreter.** Evaluator over the AST: `defun`, `if`, `cond`, `let`, arithmetic, recursion.
  *Status: complete — 223 tests (62 reader, 42 analyze, 119 interpreter). Special forms incl. `let*`, `cond`, `when`/`unless`, `progn`, `defun`/`lambda`, `labels`/`flet`, `setq`/`setf` with places, `dolist`/`dotimes`/`return`, `push`/`pop`; forty builtins; arrays; dotted pairs; `#'` function quotes. Evaluation errors surface as diagnostics with codes and positions, a step budget stops runaway code, and an observer exposes form and call events for M4/M5.*
  *Deferred: `loop`/`do`, `case`, `defstruct`, `handler-case`, multiple values, hash tables, `#+`/`#-`, backquote/unquote. All are in the standard-symbols list, so they are silently skipped rather than misreported.*
- **M4 — Value tracking.** Evaluate to a point, expose symbol values for inline display.
  *Status: in progress. Design settled — snapshots per form with copied bindings, cursor resolves to the innermost snapshot, builtins plus `T`/`NIL` filtered, `unavailable` codes instead of fake diagnostics, per-line hints by default. 4.1 `printValue` is complete (`src/core/print.ts`, 39 unit tests, 8 pipeline tests); the value run and hint layer are next. Decisions are recorded in `HANDOFF.md`.*
- **M5 — Recursion trace.** Frame enter/exit recording, rendered as a call tree outside the REPL.
- **M6 — Extension glue.** `activate()`, diagnostics provider, view. The only layer importing `vscode`.

## Long-term / optional

- **M7 — Prettier-style formatter for Lisp.** Automated, opinionated re-indentation and layout of Common Lisp source. Optional; only after M1–M6 are complete.
- **Benchmarks.** After M1–M6, a benchmark pass to put numbers on parse and evaluate cost (file size vs. time), so design tradeoffs have evidence rather than intuition.

## Learning notes

- Superseded implementations are kept as commented "monuments" in `src/core/reader.ts` on purpose — this is a learning project, and they document assumptions that didn't hold.
