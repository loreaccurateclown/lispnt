# Lispnt roadmap

Read-only diagnostic path for Common Lisp (SBCL), alongside OLIVE.

Current state and working conventions live in `HANDOFF.md`; this file is the
long-form milestone plan. Totals today: 300 tests (62 reader, 42 analyze, 125
interpreter, 39 print, 8 pipeline, 24 bindings).

## Milestones

- **M1 — Reader.** Text → AST with positions. Atoms, lists, nesting, whitespace. Then comments, strings, quote shorthand.
  *Status: complete — the reader suite, 62 tests. Covers symbols, numbers, strings with escapes, lists, `#(` vector literals (as `ListNode.prefix`), `'` and `#'` quotes (both preserved as `QuoteNode` with `quoteKind`), line comments, nested block comments, half-open positions, `parse`/`parseAll` over a cursor factory. Verified against SBCL on disk fixtures.*
  *Deferred: `#\` char literals, backquote/unquote. `#+`/`#-` read-time conditionals are out of scope.*
- **M2 — Structural analyzer.** Diagnostics over the AST: unbalanced delimiters, stray closers, unterminated strings/comments, malformed `defun`/`let`/`lambda` shapes.
  *Status: complete — the analyze suite, 42 tests. `ReaderError` carries a stable code plus the position of the offending construct; `analyze` returns `Diagnostic[]` with learner-facing messages, recovers past each error via `reader.next()` so a bad form does not hide the rest of the file, and runs AST shape checks (`defun` name/arglist, `lambda` arglist, `let`/`let*` bindings) recursively while skipping quoted data and `#(...)` vectors.*
  *Deferred: diagnostics carry one position, not a range (M6 converts); shape checks do not validate binding entries or arity.*
- **M3 — Interpreter.** Evaluator over the AST: `defun`, `if`, `cond`, `let`, arithmetic, recursion.
  *Status: complete — the interpreter suite, 125 tests. Special forms incl. `let*`, `cond`, `when`/`unless`, `progn`, `defun`/`lambda`, `labels`/`flet`, `setq`/`setf` with places, `dolist`/`dotimes`/`return`, `push`/`pop`; forty builtins; arrays; dotted pairs; `#'` function quotes. Evaluation errors surface as diagnostics with codes and positions, a step budget stops runaway code, and an observer exposes form and call events for M4/M5.*
  *Deferred: `loop`/`do`, `case`, `defstruct`, `handler-case`, multiple values, hash tables, `#+`/`#-`, backquote/unquote. All are in the standard-symbols list, so they are silently skipped rather than misreported.*
- **M4 — Value tracking.** Evaluate to a point, expose symbol values for inline display.
  *Status: complete except for the extension-side setting and cache. Done: `printValue` (`src/core/print.ts`, 39 unit tests, 8 pipeline tests); a per-pass step ceiling under a fixed 2,000,000 backstop; the value run (`src/core/bindings.ts` — `recordBindings`, `snapshotAt`); and the hint layer (`src/core/hints.ts` — `collectHints` returning `hintsForLine`/`hintsInLines`/`hintAt`, plus `formatHint`/`formatLine`, 19 tests). Design settled — snapshots per form with copied bindings, cursor resolves to the innermost snapshot (fallback only when the run completed), builtins plus `T`/`NIL` filtered, `unavailable` codes instead of fake diagnostics. Hints annotate **uses**: a name shows a value where it is read, and the value comes from the snapshot containing that use.*
  *Provisional, awaiting user testing: print limits for hints (8 elements, depth 3, same as a REPL print, overridable per call). Known limits measured on the corpus: only 7 of 41 files produce any hint, because most learner files define functions and call nothing, so their bodies never run; values shown inside an uncalled body are the global state at definition time; and a value read after a mutation in the same form can be stale.*
- **M4-STATIC — Static checks over the whole file.** Every form checked whether or not anything calls it: the names each scope binds, undefined functions, argument counts, a variable called as a function, unbound variables, and structural checks inside bodies.
  *Status: in progress. Slices 1–3 are done: the scope model and symbol table (`src/core/scopes.ts`), structure rules for the walk (head atoms, `cond` clauses, `function` targets, `loop` clauses), and name checks over every body (`src/core/name-checks.ts`) — undefined functions, unbound variables, wrong argument counts, a variable called as a function. `analyze` runs them after the shape checks and evaluation, and drops the evaluator's copies of those three codes. Slices 4–6 decode the standard forms whose binding syntax used to be skipped: `defstruct` (its generated constructor, predicate, copier and accessors), `do`/`do*` and the `case` family, and the binding macros (`with-output-to-string`, `with-input-from-string`, `with-open-file`, `with-open-stream`, `with-hash-table-iterator`, `multiple-value-bind`, `destructuring-bind`, `handler-case`). Exists because learner code is usually a set of `defun`s loaded and compiled in the SBCL REPL rather than called in the file: 21 of the 37 corpus files with `defun`s call none of them, and 78 of 199 corpus `defun`s are never called. Evaluation only sees code that runs, so those bodies are checked today for nothing but name and arglist shape. This is the project's pre-compile promise — finding the mistake before SBCL's debugger does.*
  *Remaining opaque forms, decoded only when learner code uses them: `defclass`, `defgeneric`, `defmethod`, `defmacro`, `deftype`, `defpackage`, `with-slots`, `with-accessors`, `multiple-value-setq`, `handler-bind`, `restart-case`, `macrolet`, `symbol-macrolet`. Their bodies go unchecked and, for the definition forms, their generated names are unknown. Name checks also need the checker's own list of special forms, so that `(if …)` is not read as a call to `IF`; that list mirrors the interpreter's dispatcher, and a test asserts the two stay in step. Evaluating `loop` is not part of this; it would need a milestone of its own.*
  *Deferred: any knowledge beyond this file and the standard library (unknown names stay at most a warning); unused bindings; type inference; finishing the `loop` walk (an atom in a driver position such as `xs` in `for x in xs`, and a bare-atom body such as `do x`, are skipped — recovering them means decoding clauses rather than scanning keywords; both are lost checks, not false reports); evaluating `loop` (5 of 38 corpus files and 10 occurrences use it, against 28 `dolist`/`dotimes`, which already work).*
- **M5 — Recursion trace.** Frame enter/exit recording, rendered as a call tree outside the REPL.
- **M6 — Extension glue.** `activate()`, diagnostics provider, view. The only layer importing `vscode`.

## Long-term / optional

- **M7 — Prettier-style formatter for Lisp.** Automated, opinionated re-indentation and layout of Common Lisp source. Optional; only after M1–M6 are complete.
- **Benchmarks.** After M1–M6, a benchmark pass to put numbers on parse and evaluate cost (file size vs. time), so design tradeoffs have evidence rather than intuition.

## Learning notes

- Superseded implementations are kept as commented "monuments" in `src/core/reader.ts` on purpose — this is a learning project, and they document assumptions that didn't hold.
