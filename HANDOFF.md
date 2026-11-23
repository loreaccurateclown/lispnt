# Lispnt — handoff

Read this first in a new session. It records state, decisions, and working
conventions so nothing has to be re-derived. `ROADMAP.md` is the long-form
milestone record; this file is the working state.

Rewritten 2026-11-23, replacing an M4-era handoff. If an older copy turns up
elsewhere, this one wins.

## What this is

A read-only diagnostic path for Common Lisp (SBCL), aimed at learners, as a
VS Code extension that sits alongside OLIVE/SBCL. It parses the open file with
its own TypeScript s-expression reader and never evaluates anything in a live
Lisp image.

The project's core promise: **find the mistake before SBCL's debugger does.**
Learners write a file, load and compile it in the REPL, and only at the third
step discover something is wrong. Everything static here exists to shorten that.

## Status

- **M1 reader, M2 analyzer, M3 interpreter — complete.**
- **M4 value tracking — complete in core.** `printValue`, per-pass step
  ceilings, the value run (`recordBindings`/`snapshotAt`), and the hint layer
  (`collectHints`, `formatHint`/`formatLine`). Extension-side setting and cache
  remain, and are M6 work.
- **M4-STATIC static checks — complete as scoped.** Scope model, walk rules,
  name checks, `analyze` integration, and decoding of the standard forms we had
  been skipping: `defstruct` (for the checker), `do`/`do*`, the `case` family,
  and the binding macros.
- **M5 recursion trace — complete in core.** `traceCalls`, `traceFormIn`,
  `renderTrace`, and `traceCases` (the `;;[trace]` comment marker).
- **M6 extension glue — not started.**
- Optional last: M7 Prettier-style formatter; a benchmark pass.

Tests: **460** across eleven suites — 62 reader, 48 analyze, 131 interpreter,
39 print, 8 pipeline, 24 bindings, 44 scopes, 49 name-checks, 19 hints, 21
trace, 15 trace-cases. For current commit and tree state, run
`git log --oneline -1` and `git status`; the tree should be clean at the end of
a slice.

Corpus: 41 real `.lisp` files — 4 in `lisp_test_files/`, 37 under
`G:\My Drive\Labs\CPS305` (outside the repo; reads work under the sandbox,
nothing is written). `analyze` reports 10 diagnostics on 2 files, all genuine:
`PI` never defined in `lab04/q1.lisp`, and seven `sum-kids`/`depth-kids`/`kids`
mistakes in `patterns_test2/list_search.lisp`. 21 of the 37 files with `defun`s
call none of them; 78 of 199 `defun`s are never called. That shape is why the
static checker, not the evaluator, carries the project's value.

## Repo and toolchain

- TypeScript 7.0.2 pinned in `devDependencies`; a global 7.0.2 also exists.
- Repo: `C:\Users\admin\Desktop\Programming\TypeScript\Lispnt`, branch `master`.
  Run `npm install` first if `node_modules/` is missing.
- Build `npm run build`; check `npm run check`; test `npm test` (builds, then
  runs each suite file explicitly — `node --test <dir>` fails in this sandbox
  because it spawns children).
- `dist/src/core/*.js` and `dist/test/*.js`; add every new suite to the `test`
  script in `package.json`.
- Tests use `node:test` with `node:assert/strict`. Agent-written blocks are
  marked `//LLM-written tests`.
- `tsconfig`: `nodenext` module/resolution (TS 7 removed `"node"`), `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (optional properties
  cannot be assigned `undefined` explicitly — omit them instead),
  `noImplicitOverride`.
- `.npmrc` pins the cache to `.npm-cache` (global npm cache is outside the
  sandbox and fails with EPERM).
- `userdocs/` is the user's own notes on Lisp and CL — not project material.
  Leave it alone unless asked.

## Layout

| file | role |
|---|---|
| `reader.ts` | cursor factory, `parse`/`parseAll`/`next`, AST types (`AtomNode`, `ListNode`, `QuoteNode`); comments are trivia and are discarded |
| `errors.ts` | `ReaderError`, `LispEvalError`, code unions |
| `values.ts` | `LispValue` union, `NIL`, `Env`, `Place`, `intern` |
| `builtins.ts` | builtin table (`min`/`max` arities) and `applyBuiltIn` |
| `interpreter.ts` | `evaluate`, special forms, `callValue`, `SPECIAL_FORMS`, `withStepCeiling`, observer hooks |
| `standard-symbols.ts` | ANSI names the evaluator does not implement |
| `print.ts` | `printValue` — SBCL-faithful rendering with `...`/`#` truncation |
| `bindings.ts` | `recordBindings`/`snapshotAt` — the value run and snapshots |
| `hints.ts` | `collectHints` — per-line and per-cursor values |
| `scopes.ts` | scope model, file symbol table, `walkWithScopes`, `OPAQUE_FORMS`, `symbolWord` |
| `name-checks.ts` | static name checks (undefined/unbound/variable-as-function/arity) |
| `checks.ts` | AST shape checks (`defun`, `lambda`, `let`, `labels`, `flet`) |
| `diagnostics.ts` | `Diagnostic`, message tables, error→diagnostic |
| `analyze.ts` | entry point: parse → shape checks → evaluation → static name checks |
| `trace.ts` | `traceCalls`/`traceFormIn`, `TraceFrame`, `renderTrace` |
| `trace-cases.ts` | `traceCases` — the `;;[trace]` comment marker |

Layering: `reader/values/errors → builtins → interpreter`, then consumers above
it (`bindings`, `hints`, `scopes`, `trace`, `trace-cases`), with
`name-checks` above `scopes` and `analyze` on top. `builtins.ts` must not import
`interpreter.ts`; that is why `APPLY`/`FUNCALL` are registered in
`interpreter.ts` where `callValue` lives.

## Working conventions

**Permission.** No code without an explicit instruction; "go ahead" is one. If
an instruction is vague, stop and ask. Ask before anything that mutates the repo
outside the current slice (branch work, force operations, history rewrites).

**Commits.** One commit per completed slice, with `ROADMAP.md` edits folded in:
roadmap text describing unshipped work lands with the code that ships it. Docs
edits that are not `ROADMAP.md` (this handoff, corrections) may stand alone.
A roadmap note about unshipped work waits for the next code commit; that is the
only reason the roadmap is ever dirty.

**Outlines.** The user does not write the code now. Since M4-STATIC the preferred
outline is compact: changes per file, decisions, test list, sizes — no full
pseudocode unless asked. For a new subsystem, one paragraph of mechanism plus
the decisions is enough.

**Output honesty.** When showing test or tool output, paste it verbatim. Short
outputs are shown in full, never abbreviated; only genuinely large ones get a
head/tail excerpt, and that must be labelled as an excerpt. No hand-retyped
output.

**Naming and words.** Do not invent shorthand without asking; say what a thing
is in plain words. Prefix exported types/classes (`LispValue`, `ReaderError`,
`LispEvalError`) because JS/DOM globals include `EvalError`, `Node`, `Element`,
`Event`, `Text`, `Range`, `File` (a real bug came from `EvalError`). TS 7's npm
package ships no `lib.*.d.ts`, so that list cannot be grepped locally.

**Tone.** Short answers; explain only when asked; halt and ask rather than guess.

## Locked decisions

Reader and values:

- Fidelity over desugaring: `'x` stays a `QuoteNode` (`quoteKind` `'` or `#'`).
- `#(…)` vector literals are `ListNode` with `prefix`, and self-evaluate.
- Dotted pairs: `ListNode.tail`; two reader codes for bad dots.
- Symbols interned uppercase; keywords self-evaluate.
- Reader gaps still open: `#\` character literals and ratios (`14/5`) arrive as
  symbols. The checker skips them; the evaluator has no char type.
- `eq` is identity plus number/string value comparison.

Interpreter:

- `setf` uses a `Place` abstraction (`get`/`set` closures) over symbols, `aref`,
  `car`, `cdr`; `push` is binary; `pop` reads.
- `labels` closes over its own scope; `flet` closes over the outer env.
- Single namespace for variables and functions (unlike CL). A parameter holding
  a function can be called here; the checker still reports a parameter called as
  a function, because CL would.
- `unsupported-standard` is silent: our gap, not the learner's.
- `(load …)` suppresses `undefined-function`.

Budgets:

- `HARD_STEP_CEILING = 2_000_000` is a never-exceeded backstop. `withStepCeiling`
  takes a per-pass ceiling in `1 … HARD`, throws `RangeError` outside it, refuses
  a second open pass, and restores state in `finally`. `analyze` runs at the
  backstop; the value run and trace run at 200,000 steps. The counter is
  module-level.
- Budget wording, if surfaced: "1,000+ iterations" for loops, "1,000+ calls, N
  levels deep" for recursion, "1,000+ evaluations" otherwise. "Recursions" is
  not the count noun. A budget hit must read as a warning, not an error.

Diagnostics (static checks):

- Severity describes the program's execution, not SBCL's compile status — a
  deliberate divergence, documented in the roadmap: red means "this fails when
  reached", yellow means "the name may come from outside this file".
- **error**: `variable-as-function` (parameters/locals only), arity when the name
  is defined exactly once in the file, arity against a builtin.
- **warning**: `undefined-function`, `unbound-variable`, arity when the name is
  defined more than once.
- **silent**: standard-but-unimplemented names, globals called as functions,
  `*special*` names, keyword arguments, `(load …)` files for undefined functions,
  and files defining a `defstruct` with `:include` or another unmodelled option.
- `analyze` drops the evaluator's own `undefined-function`, `unbound-variable`
  and `arity` diagnostics; the static checker owns those three codes. Runtime-only
  codes (`type-error`, `division-by-zero`, `index-error`, `malformed-form`,
  `not-a-place`, `evaluation-budget`) still come from evaluation.

Opaque forms (checker-side decoding):

- `OPAQUE_FORMS` are standard forms whose binding syntax we do not model. The
  walk stops at them, so their contents are unchecked rather than misreported.
  Remaining: `defclass`, `defgeneric`, `defmethod`, `defmacro`, `deftype`,
  `defpackage`, `with-slots`, `with-accessors`, `multiple-value-setq`,
  `handler-bind`, `restart-case`, `macrolet`, `symbol-macrolet`.
- Decoded for the checker: `defstruct` (constructor/predicate/copier/accessors
  registered in the symbol table; `:include` keeps the file suppressed),
  `do`/`do*`, the `case` family, and the binding macros.
- **The evaluator has none of those decodings.** `defstruct`, `do`/`do*`, the
  `case` family and the binding macros are checker-only; at run time the form
  throws `unsupported-standard` and is skipped, so its generated names never
  exist. This is why tree-lab traces fail with `undefined-function`. Slice A and
  Slice B below are the fix.

Values and hints:

- Hints annotate **uses**: a name shows a value where it is read, taken from the
  snapshot containing that use (most recent call wins). One hint per name per
  line; no hint on a line that binds the name; builtins, `T`/`NIL` and unbound
  names are silent.
- Hints report **what executed**. Measured: only 7 of 41 corpus files produce any
  hint; inside a function nothing calls, only globals appear, at definition-time
  values; a value read after mutation in the same form can be stale (snapshots
  copy binding maps, not the values in them).
- Print limits for hints are `printValue`'s (8 elements, depth 3), overridable
  per call. Provisional until user testing.
- Hints are not built on the static checker: static analysis knows names and
  scopes, not values.

Trace:

- Only user functions are recorded (builtins bypass the observer); arguments and
  results are printed at call time, not render time.
- Caps: 200,000 steps, depth 64, 1,000 frames. Past a cap evaluation continues,
  recording stops, `truncated` is set. The depth cap exists because JS overflows
  at roughly 800 Lisp calls (measured, and it varies run to run); 64 is a
  deterministic policy well inside it.
- `;;[trace]` marker: line comment, bracketed, then one form; whitespace and case
  tolerated; block comments are ignored. Each marker is an independent case,
  evaluated against a freshly loaded copy of the file. An unreadable marker is
  reported as `unreadable`, not as a diagnostic.
- Rendering today: `NAME(args) => result`, two spaces per depth, `!! code` on the
  failing frame, `…` footers. **Known cosmetic defect:** SBCL prints the return
  on its own line *after* the subtree; ours puts `=> result` on the entry line,
  so it reads in reverse. Recorded in the roadmap for a later fix.
- A display limit (`[trace:N]`, `[trace:all]`, 10 per level, first N + hidden
  count + last entry) was specified and approved but **is not implemented**; the
  renderer currently shows every recorded frame.

Rejected, with reasons (do not re-propose without new evidence):

- **Static value tier** (constants or symbolic definitions): 35 of 77 corpus
  locals are literal, 11 computable, 31 input-dependent, and all 286 parameters
  have no static value. Constants restate the source, the pattern appears
  inconsistently, and a learner cannot explain the inconsistency without scope
  and closure rules they are still learning. Values stay a runtime observation.
- **Test-case inference**: signatures give arity, not domains; "valid" is
  undecidable. The learner writes the case.
- **A REPL / scratchpad**: out of scope by design. The `;;[trace]` marker gives
  runtime evidence without one.
- **A static call graph**: prototyped, showed self and mutual recursion without
  running anything, but it cannot say which branch ran, depth, arguments or
  results — the trace is the useful artifact.

## Next steps

Two slices, in order, then a backlog.

**Slice A — evaluator gaps, cheap part.** Builtins `1+`, `1-`, `MAX`, `MIN`,
`COUNT`, `BUTLAST`, `SCHAR`, `CHAR`, `CHAR=`, `CHAR-UPCASE`, `ERROR`; special
forms `DO`/`DO*` and the `CASE` family. Corpus counts: `1+` 20 occurrences, `1-`
13, `MAX` 4, `SCHAR` 6, `CHAR=` 3, `ERROR` 11, `CASE` 3, `DO` 2. About 150 lines
and 30 tests. `DEFSTRUCT` stays out — it needs its own slice.

**Slice B — `defstruct` for the evaluator.** A struct value (new `LispValue`
kind with type name and slots), the special form defining constructor, predicate,
copier and accessors, printing as `#S(NAME :SLOT value …)`, and equality. Touches
`values.ts`, `interpreter.ts`, `print.ts`, equality paths. This is what makes the
binary-tree labs traceable.

Backlog, in rough value order:

1. Trace render fix: move `=> result` onto an exit line after the subtree,
   optionally adopt SBCL's depth-numbered layout.
2. The approved-but-unimplemented trace display limit (`[trace:N]`,
   `[trace:all]`, per-level 10, hidden count, always show the last entry;
   clamp N to the 1,000-frame cap).
3. `FORMAT` (18 occurrences, mostly test harnesses) — a `~a ~s ~% ~d` subset.
4. `GETF`, `SORT`, hash tables, multiple values, `WITH-OUTPUT-TO-STRING`, `LOAD`.
5. `LOOP` evaluation — its own milestone-sized item.
6. Decode remaining opaque forms only if learner code uses them.
7. Unused bindings, type inference, call-site positions in traces, a counting
   mode for very large call trees.
8. M6: extension shell + diagnostics, then hints, then trace surfaces. The
   extension lives in this repo, not a separate package.

## How to check the corpus

There is no committed script. After `npm run build`, walk
`lisp_test_files/` and `G:\My Drive\Labs\CPS305` for `*.lisp`/`*.lsp`, then for
each file run `analyze` from `dist/src/core/analyze.js` (and, when relevant,
`checkNames`, `collectHints`, or `traceCases`). Report counts by code and file.
Reads from `G:` work under the sandbox; nothing is written.

`test/reader.test.ts` asserts that `lisp_test_files/reader_smoke.lisp` parses to
exactly 6 forms and inspects form 2, and other tests assert form counts on
`recursion_nested_lists.lisp`. Editing those fixtures means updating the tests;
new fixtures for diagnostics or traces belong in new files rather than in the
reader fixtures.
