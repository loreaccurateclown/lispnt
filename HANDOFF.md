# Lispnt — handoff

Read this first in a new session. It records state, decisions, and working
conventions so nothing has to be re-derived. `ROADMAP.md` is the long-form
milestone record, including the **Agent working rules** section, which applies to
you. This file supersedes every earlier copy.

## What this is

A read-only diagnostic path for Common Lisp (SBCL), aimed at learners, as a VS
Code extension that sits alongside OLIVE/SBCL. It parses the open file with its
own TypeScript s-expression reader and never evaluates anything in a live Lisp
image.

The promise: **find the mistake before SBCL's debugger does.** Learner code is
usually a set of `defun`s loaded and compiled in the REPL, so everything static
here exists to shorten that loop.

## Status

- **M1 reader, M2 analyzer, M3 interpreter, M4 value tracking, M4-STATIC static
  checks, M5 recursion trace — complete in core.**
- **M3-EXTRA — evaluator and standard-library gaps — shipped through multiple
  values, lambda lists and builtin keyword arguments.** Nothing further planned
  in that milestone.
- **M6 — extension glue — functionally complete.** Shipped: diagnostics (6.1),
  text trace view (6.2), trace tree in the activity bar (6.3/6.4), pin + the
  focus rule (6.4a), value hints (6.5/6.5a), and tooltips on length-capped hints.
  Not shipped: a packaged `.vsix`; the extension runs via F5 only.
- **M7 formatter and the benchmark pass — not started.**

Tests: **745** across fourteen suites — 70 reader, 55 analyze, 293 interpreter,
49 print, 8 pipeline, 24 bindings, 48 scopes, 57 name-checks, 20 hints, 40 trace,
24 trace-cases, 9 trace-tree, 10 value-hints, 38 extension. `npm test` is green
at `206d06f`; the tree should be clean at the end of a slice.

Corpus: **43 files** (6 under `lisp_test_files/` and 37 under
`G:\My Drive\Labs\CPS305`; the seventh file in `lisp_test_files/` is
`backup/recursion_nested_lists.lisp`, a duplicate the check skips). `analyze`
reports **10 diagnostics** on two files only: `lab04/q1.lisp`'s undefined `PI`,
and the `sum-kids`/`depth-kids`/`kids` cluster in
`patterns_test2/list_search.lisp`. Both CPS305 `;;[trace]` markers are filled —
`lab05-assign-v4/q3.lisp` and `lab08/q1.lisp` (5 calls, max depth 2, `2`), so the
corpus carries no `trace-marker` warning. 8 of the 43 produce a trace frame (the
six repo test files, that q3 and `lab08/q1`); 13 produce a value hint once
markers run.

## Repo and toolchain

- TypeScript 7.0.2 pinned; Node 22.21.0. Branch `master`. `npm install` first if
  `node_modules/` is missing.
- `npm run build`; `npm run check`; `npm test` (builds, then runs each suite file
  explicitly — `node --test <dir>` fails in this sandbox because it spawns
  children). **Add every new suite to the `test` script.**
- `tsconfig`: `nodenext`, `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes` (omit optional properties, never assign
  `undefined`), `noImplicitOverride`.
- `.npmrc` pins the npm cache to `.npm-cache`; the global cache is outside the
  sandbox and fails with EPERM. The registry is a mirror; the lockfile resolves
  through it.
- `@types/vscode` is pinned exactly at **1.146.0**; `engines.vscode` is
  **^1.147.0** (the installed editor). Types must stay at or below the engines
  floor. No tsconfig change is needed: `"types": ["node"]` only restricts globals,
  and `import ... from "vscode"` still resolves.
- `extension-test.code-workspace` is the user's scratch workspace for running the
  extension against the corpus; it is **gitignored and worth keeping on disk**.
- `userdocs/` is the user's own notes on Lisp — leave it alone.

## Layout

| file | role |
|---|---|
| `src/core/reader.ts` | cursor factory, `parse`/`parseAll`, AST, `#\` chars, `#(` vectors, comments as trivia |
| `src/core/errors.ts` | `ReaderError`, `LispEvalError`, `EvalErrorCode` |
| `src/core/values.ts` | `LispValue` union (symbol, number, string, char, nil, cons, array, struct, hash, stream, values, function, builtin), `NIL`, `Env`, `Place`, `intern`, `arrayLength` |
| `src/core/builtins.ts` | builtin table, `applyBuiltIn`, `expect*`, `parseKeywords`, hash-key canonicalisation, `listFrom` |
| `src/core/interpreter.ts` | evaluator, special forms, `callValue`, `SPECIAL_FORMS`, budget, places, LOOP executor, multiple values, lambda-list parsing/binding, `sort`/`count`/`maphash`/`with-hash-table-iterator` |
| `src/core/loop.ts` | LOOP clause types and parser only |
| `src/core/standard-symbols.ts` | ANSI names Lispnt knows but does not implement — keep it true (171 names) |
| `src/core/print.ts` | `printValue`, `princ` mode, `#S(…)`, `#<hash-table …>`, fill-pointer printing |
| `src/core/bindings.ts` | `recordBindings(source, calls?)`/`snapshotAt` |
| `src/core/hints.ts` | `collectHints(source, {calls})`, `formatHint`/`formatLine` |
| `src/core/scopes.ts` | scope model, file symbol table, `walkWithScopes`, `OPAQUE_FORMS`, defstruct/mv-setq decoding |
| `src/core/name-checks.ts` | undefined/unbound/variable-as-function/arity checks |
| `src/core/checks.ts` | AST shape checks |
| `src/core/diagnostics.ts` | `Diagnostic`, message tables, error→diagnostic |
| `src/core/analyze.ts` | parse → shape checks → evaluation → name checks → trace-marker warnings |
| `src/core/trace.ts` | `traceCalls`/`traceFormIn`, `renderTrace`, `traceSummary`, `EXPLAIN_TRACE`, `TraceFrame` |
| `src/core/trace-cases.ts` | `traceCases`, `traceExpressions`, `emptyTraceMarkers`, the `;;[trace]` grammar |
| `src/extension.ts` | the only file importing `vscode` for value: builds the API adapter |
| `src/extension/api.ts` | the seam: every editor capability Lispnt uses, declared here |
| `src/extension/activate.ts` | all wiring; a test enforces that it never imports `vscode` |
| `src/extension/present.ts` | `Diagnostic[]` → editor-shaped problems (whole-line ranges) |
| `src/extension/trace-report.ts` | `formatTraceReport` for the text view |
| `src/extension/trace-tree.ts` | pure trace tree model |
| `src/extension/value-hints.ts` | shared hint run cache, end-of-line inlay provider, hover provider |
| `media/lispnt.svg` | activity-bar icon: lambda outline traced from Cascadia Code (SIL OFL) |
| `examples/diagnostics/` | one file per mark the extension can show, plus a lock test |
| `lisp_test_files/` | repo corpus, each file now carrying one working `;;[trace]` marker |

Layering: `reader/values/errors → builtins → interpreter`, then consumers above
it (`bindings`, `hints`, `scopes`, `trace`, `trace-cases`), `name-checks` above
`scopes`, `analyze` on top, and the extension above everything.

**Hard rules:** `builtins.ts` must not import `interpreter.ts` — that is why
`APPLY`, `FUNCALL`, `MAPHASH`, `SORT`, `COUNT` and the `with-hash-table-iterator`
closure live in the interpreter. `loop.ts` imports neither. Only
`src/extension.ts` may import `vscode` for value; `activate.ts` and the rest take
the seam in `src/extension/api.ts`, and a test walks `src/` to keep it so.

## Decisions worth not rediscovering

**Value kinds.** Characters (`{kind:"char"}`), structures (`#S(…)`, identity
equality), hash tables (`#<hash-table :count n>`, insertion order), string output
streams, and multiple-value bundles are each their own kind. A values bundle never
reaches a single-value context: `evaluate` takes the primary. `equalp` is treated
as `equal` (recorded divergence).

**Lambda lists.** Parsed once at definition into `LambdaList`; required, optional
(default + supplied-p), rest/body, keys (default, supplied-p,
`((:kw var) …)`), aux. Defaults and aux initialisers run in the call's scope,
left to right. `&allow-other-keys` is `unsupported-standard`; out-of-order
markers and duplicate names are `malformed-form`. DEFSTRUCT constructors use the
same keyword binder.

**Builtin keywords.** One `parseKeywords` in `builtins.ts`: unknown key
`unsupported-standard`, odd count `malformed-form`, non-keyword in a key position
`type-error`, first duplicate wins. `MAKE-ARRAY`, `MAKE-STRING`,
`MAKE-HASH-TABLE` take theirs there; `SORT :key` and `COUNT :test/:key` live in
the interpreter because they call functions. `COUNT` defaults to EQL. Vectors
carry an optional fill pointer: `length` and printing honour it, `aref` stays
capacity-bounded (as SBCL answers), `vector-push` without one is a `type-error`.

**LOOP is a deliberate subset and fails loudly.** in/on/across, numeric drivers,
while/until/repeat, do/collect/append/sum/count/max/min with `into`,
initially/finally/return, if/when/unless. Every other clause word is
`unsupported-standard`. Full LOOP syntax was rejected with measured demand.

**FORMAT's two-tier failure.** ANSI-defined-but-unbuilt (`~b`, `~x`, `~p`, `~t`,
iteration/justification, parameters) is `unsupported-standard`; a character that
is not a directive at all (`~q`) is `malformed-form`.

**Trace markers.** `;;[trace] (call)` on its own comment line; `;;[trace:N]` /
`;;[trace:all]` limit calls per level. Each case reloads the whole file in a fresh
environment, so marker position is cosmetic and cases cannot see each other's
mutations. The renderer keeps one line per call (`NAME(args) => result`), labels
`root: 0:` and `max depth: n:`, and ends with a summary from `traceSummary` —
shared with the tree view so they cannot disagree. An empty marker is the
`trace-marker` warning, emitted after evaluation so it cannot suppress a
definition's evaluation.

**Trace tree.** One root per marked call, frames as children, `!! code` on a
frame that threw, a truncated leaf when the recorder stopped. It lives in the
activity bar (`navigation@1` trace button, `@2` pin, `@3` value hints — explicit
orders, so swapped icon pairs never move). It remembers the file it shows and
only retargets when a Lisp document becomes active; focusing the generated trace
document does nothing. Pin is per session and widget-only; closing the traced
file clears or falls back.

**Value hints.** Two surfaces over one cached hint run (per document version,
and the run evaluates the `;;[trace]` calls too, so a traced body has values):
hovering a name always shows `X = 5`; end-of-line hints are off by default,
switched on per file from the trace view, held in a session set — **no settings
are written**. One hint per line with values joined. The editor caps a line's
hint text at `editor.inlayHints.maximumLength` (default 43, 0 = unlimited) and
drops later hints on that line; when our label exceeds the cap the hint carries a
markdown tooltip listing every binding, built with `appendText` so Lisp names are
not eaten by markdown. The cap is read per request; a language-scoped override is
not read.

**Diagnostics.** Severity describes execution, not SBCL compile status: red
means "fails when reached", yellow "may come from another file". `analyze` drops
the evaluator's `undefined-function`, `unbound-variable` and `arity`; the static
checker owns those. `unsupported-standard` is always silent — a gap in Lispnt is
never the learner's mistake. Ranges are whole-line because the core carries one
position.

**The checker's opaque forms** are now `defclass`, `defgeneric`, `defmethod`,
`defmacro`, `deftype`, `defpackage`, `with-slots`, `with-accessors`,
`handler-bind`, `restart-case`, `macrolet`, `symbol-macrolet`. `DEFSTRUCT` and
`MULTIPLE-VALUE-SETQ` were removed from that set: defstruct walks its slot
defaults in the enclosing scope (header names are names, not code), and
multiple-value-setq walks its targets as uses and its value form as code, so its
value form is checked and its targets behave like SETQ's.

**Budgets.** `HARD_STEP_CEILING = 2_000_000`; `withStepCeiling` takes a per-pass
ceiling, refuses a second open pass, restores state in `finally`. The counter is
scoped to the outermost evaluation when no pass is open — a budget error outside
a pass once left it above the ceiling and disabled every later evaluation. LOOP
charges one step per iteration so a body-less loop still stops.

**Rejected, with reasons (do not re-propose without evidence):** a static value
tier; test-case inference; a REPL/scratchpad; a static call graph; full LOOP
syntax; `LOAD` (harness-only, and it would need a path, a separate budget, a
cycle guard, and a file field on `Diagnostic`).

## Working conventions

**Permission.** No code without an explicit instruction. A plan stays a plan until
the user says go; commentary on a plan is not approval, and neither is agreement
with one part of it. When unsure, ask one short question instead of writing a
rationale.

**Claims.** Do not state platform behaviour from memory when a lookup settles it.
The inlay-hint cap was reported as "viewport clipping" and then repeated back to
the user with a screenshot in hand; it is
`editor.inlayHints.maximumLength`. Read the typings, the release notes, or the
source.

**Commits.** One commit per completed slice, with `ROADMAP.md` text describing it
folded in. Doc-only edits may stand alone. Record shipped items under M3-EXTRA's
`Shipped` (or the milestone) and move them out of `Planned` in the same commit. A
roadmap note about unshipped work waits for the next code commit.

**Outlines.** The user approves a plan before code starts; do not code from a plan. Preferred outline: changes per
file, decisions made, test list, sizes. Do not pad with choices where one option
is plainly correct; state the call.

**Output honesty.** Paste test and tool output verbatim. Short outputs in full;
only genuinely large ones get a labelled head/tail excerpt.

**Naming.** No invented shorthand without asking. Prefix exported types and
classes (`LispValue`, `ReaderError`, `LispEvalError`) because JS/DOM globals
include `EvalError`, `Node`, `Element`, `Event`, `Text`, `Range`, `File`.

## Next steps

1. **M7 — the formatter.** Optional, after M1–M6. Not started.
2. **Benchmarks.** Parse and evaluate cost against file size, to replace
   intuition with numbers.
3. **Packaging.** A `.vsix` (`vsce`) with `.vscodeignore` already in place, and a
   README for the extension. Not started.
4. **Deferred gaps,** all recorded in `ROADMAP.md`: `#+`/`#-` and backquote in
   the reader; `handler-case`; the opaque standard forms above; unused bindings;
   type inference; the unfinished LOOP walk (atoms in driver positions); call-site
   positions for tree navigation; a counting trace mode; multi-line trace markers.

Both CPS305 `;;[trace]` markers are filled, so nothing is outstanding there.

## How to check the corpus

No committed script. After `npm run build`, walk `lisp_test_files/` and
`G:\My Drive\Labs\CPS305` for `*.lisp`/`*.lsp` (skip `backup`), and for each file
run `analyze`, `collectHints(source, {calls: traceExpressions(source)})` and
`traceCases`; report diagnostics by code and file, files with a hint, files with a
frame. Expected: 43 files, 10 diagnostics, 13 files with hints, 8 with frames.

Trace spot-checks that should hold (all verified against SBCL):

| call | result |
|---|---|
| `(COUNT-SINGLE-CHILD-NODES '(a (b (c)) (d e)))` | `2` |
| `(PAIRWISE-PRODUCT '(2 3) '(4 5))` | `(8 15)` |
| `(COUNT-ZEROS '(0 1 0 0))` | `3` |
| `(SUM-TREE '(1 (2 3) 4))` | `10` |
| `(PAIR-SUM '((1 2) (3 4)))` | `10` |
| `(IS-EMPTY-P (NEW-STACK 3))` | `T` |
| `(LEVEL-ORDER '(1 (2 (3)) 4))` | `(1 2 4 3)` |
| `(AVERAGE-LIST-LOOP '(1 2 3 4))` | `2.5` |
| `(GRADE-LETTERS #(90 45 72 88))` | `"AFBA"` |

The grade-letters row matters: the file's own comment says `"ACBA"`; SBCL agrees
with `"AFBA"`, so the comment is the bug, not the evaluation.
