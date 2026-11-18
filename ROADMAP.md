# Lispnt roadmap

Read-only diagnostic path for Common Lisp (SBCL), alongside OLIVE.

## Milestones

- **M1 — Reader.** Text → AST with positions. Atoms, lists, nesting, whitespace. Then comments, strings, quote shorthand.
  *Status: complete — 43 tests. Covers symbols, numbers, strings with escapes, lists, `#(` vector literals (as `ListNode.prefix`), `'` quote (preserved as `QuoteNode`), line comments, nested block comments, half-open positions, `parse`/`parseAll` over a cursor factory. Verified against SBCL on disk fixtures.*
  *Deferred: `#\` char literals, backquote/unquote, `#'` function quote parse as single atoms (structurally safe, semantically resolved at M3). `#+`/`#-` read-time conditionals are out of scope.*
- **M2 — Structural analyzer.** Diagnostics over the AST: unbalanced delimiters, stray closers, unterminated strings/comments, malformed `defun`/`let`/`lambda` shapes.
  *Status: complete — 69 tests (51 reader, 18 analyze). `ReaderError` carries a stable code plus the position of the offending construct; `analyze` returns `Diagnostic[]` with learner-facing messages, recovers past each error via `reader.next()` so a bad form does not hide the rest of the file, and runs AST shape checks (`defun` name/arglist, `lambda` arglist, `let`/`let*` bindings) recursively while skipping quoted data and `#(...)` vectors.*
  *Deferred: diagnostics carry one position, not a range (M6 converts); shape checks do not validate binding entries or arity.*
- **M3 — Interpreter.** Evaluator over the AST: `defun`, `if`, `cond`, `let`, arithmetic, recursion.
- **M4 — Value tracking.** Evaluate to a point, expose symbol values for inline display.
- **M5 — Recursion trace.** Frame enter/exit recording, rendered as a call tree outside the REPL.
- **M6 — Extension glue.** `activate()`, diagnostics provider, view. The only layer importing `vscode`.

## Long-term / optional

- **M7 — Prettier-style formatter for Lisp.** Automated, opinionated re-indentation and layout of Common Lisp source. Optional; only after M1–M6 are complete.
- **Benchmarks.** Once the reader is done, a benchmark pass to put numbers on parse cost (file size vs. time), so design tradeoffs have evidence rather than intuition.

## Learning notes

- Superseded implementations are kept as commented "monuments" in `src/core/reader.ts` on purpose — this is a learning project, and they document assumptions that didn't hold.
