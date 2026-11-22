# Lispnt — handoff

Read this first in a new session. It records state, decisions, and working
conventions so nothing has to be re-derived.

## What this is

A read-only diagnostic path for Common Lisp (SBCL), aimed at learners, as a
VS Code extension that sits alongside OLIVE/SBCL. It parses the open file with
its own TypeScript s-expression reader and never evaluates anything in a live
Lisp image.

## Status

- **M1 reader — complete.** M2 analyzer — complete. M3 interpreter — complete.
- 270 tests: 62 reader, 42 analyze, 119 interpreter, 39 print, 8 pipeline
  (`npm test`).
- 38 real `.lisp` files produce **zero diagnostics**: 4 in `lisp_test_files/`,
  34 in `G:\My Drive\Labs\CPS305` (outside the repo). To re-check after a build,
  walk both trees for `*.lisp`/`*.lsp`, `readFileSync` each and pass it to
  `analyze` from `dist/src/core/analyze.js`, count the files that report
  anything. Reads from `G:` work under this sandbox; nothing is written. No
  script for this is committed.
- In progress: M4 value tracking — 4.1 `printValue` complete; the value run and
  hint layer are next. Not started: M5 recursion trace, M6 extension glue.
- Optional last: M7 Prettier-style Lisp formatter; a benchmark pass.
- Long-form plan and milestone history: `ROADMAP.md`. Keep its test counts in
  step with this file.

## Repo and toolchain

- TypeScript 7.0.2 pinned in `devDependencies`; a global 7.0.2 also exists.
- Build with `npm run build`, check with `npm run check`, test with `npm test`
  (builds, then runs each suite file explicitly — `node --test <dir>` fails in
  this sandbox because it spawns children).
- `dist/test/*.js` is a copy of `test/*.ts`; add new suites to the `test`
  script in `package.json`.
- Tests use `node:test` with `node:assert/strict`. Blocks written by the agent
  are marked `//LLM-written tests`; new suites follow both.
- No git commits without explicit permission, each time.

## Layout

| file | role |
|---|---|
| `src/core/reader.ts` | cursor factory, `parse`/`parseAll`/`next`, AST types |
| `src/core/errors.ts` | `ReaderError`, `LispEvalError`, code unions |
| `src/core/diagnostics.ts` | `Diagnostic`, message tables, error→diagnostic |
| `src/core/checks.ts` | AST shape checks (`defun`, `lambda`, `let`, `labels`, `flet`) |
| `src/core/analyze.ts` | entry point: parse → shape checks → evaluate uncovered forms |
| `src/core/values.ts` | `LispValue` union, `NIL`, `Env`, `Place`, `intern` |
| `src/core/builtins.ts` | builtin table and `applyBuiltIn` |
| `src/core/interpreter.ts` | `evaluate`, special forms, `callValue`, observer hooks |
| `src/core/standard-symbols.ts` | ANSI names we do not implement (silently skipped) |

Layering: `values → builtins → interpreter → analyze`. `builtins.ts` must not
import `interpreter.ts`; that is why `APPLY`/`FUNCALL` are registered in
`interpreter.ts` where `callValue` lives.

`userdocs/` is the user's own notes on Lisp and CL — not project material. Leave
it alone unless asked.

## Conventions that matter

**Outlines.** `Changes` is a map only (files, order, decisions needed). The
**pseudocode is the complete implementation spec** — exports shown, modified
existing declarations shown with the change, imports as a one-line note, one
scope header per block. Nothing implementation-critical may live only in prose;
the user codes from the pseudocode almost exclusively.

**Working style.** No code without an explicit instruction. If an instruction
is vague, stop and ask. No commits or repo-mutating actions without permission
for that specific action. Prefer short answers; avoid unsolicited justification
of shapes (explain only when asked).

**Naming.** Prefix exported types/classes (`LispValue`, `ReaderError`,
`LispEvalError`) — JS/DOM globals include `EvalError`, `Node`, `Element`,
`Event`, `Text`, `Range`, `File`, and `EvalError` caused a real bug. TypeScript
7's npm package ships no `lib.*.d.ts`, so the global list cannot be grepped
locally: just always prefix.

## Locked decisions

- Fidelity over desugaring: `'x` stays a `QuoteNode` (with `quoteKind`, `'` or `#'`).
- `#(…)` vector literals are `ListNode` with `prefix: "#("`, and self-evaluate.
- Dotted pairs: `ListNode.tail`, two reader codes for bad dots.
- Symbols interned uppercase (CL reader semantics); `eq` is identity plus
  number/string value comparison.
- Keywords self-evaluate (`:initial-element`).
- `setf` uses a `Place` abstraction (`get`/`set` closures over evaluated
  targets) covering symbols, `aref`, `car`, `cdr`; `push` is binary; `pop` reads.
- `labels` closes over its own scope (definitions see each other); `flet` closes
  over the outer env (no self-recursion by name).
- Evaluation errors are diagnostics with stable codes; standard-but-unimplemented
  names are silently skipped (`unsupported-standard`); `(load …)` suppresses
  `undefined-function`.
- Step budget: hard 2,000,000 (`STEP_LIMIT` in `interpreter.ts`) stops
  `analyze`; plan is a soft internal cap (~200k steps) for the value run, with
  no user-facing number until laptop testing. Budget hit must read as a
  **warning**, not an error. The counter is module-level and only `analyze`
  resets it, so a direct `evaluate` caller (M4's value run) must decide for
  itself whether to reset.
- Budget wording: "1,000+ iterations" for a loop, "1,000+ calls, N levels deep"
  for recursion, "1,000+ evaluations" otherwise. "Recursions" is not the count
  noun.

## M4 decisions so far

- Snapshot every form entry, with **copied** binding maps (env mutates as
  evaluation continues).
- Cursor → innermost snapshot containing the offset; M4 shows the **most recent**
  call; M5 owns full frames.
- Filter bindings with `value.kind === "builtin"` plus `T`/`NIL`.
- Results carry `unavailable: "evaluation-error" | "budget" | "unparsed" |
  "truncated"` rather than fake diagnostics.
- Default to **per-line hints**, with a setting to switch to cursor-position mode.
- Memory is the real constraint, not time. Snapshot-on-scope-entry (plus
  mutations) is a possible optimization; decide by measuring the simple version
  against the cap.

## 4.1 `printValue` — complete

`src/core/print.ts` (no caller yet — M4 wires it in), `test/print.test.ts` (39),
`test/pipeline.test.ts` (8); both suites run from the `test` script.

```
export interface PrintOptions { maxElements?: number; maxDepth?: number }
export function printValue(value: LispValue, options?: PrintOptions): string
```

Rendering: `42`, `"hi"` (with `\"` and `\\` escaped), `FOO`, `NIL`, `T`,
`(1 2 3)`, `(1 . 2)`, `#(1 2)`, `#<builtin CAR>`, `#<function F>`.
Defaults: 8 elements per sequence, depth 3.

Truncation markers follow SBCL: `...` for cut elements, `#` for cut depth (SBCL
prints `#` past `*print-level*` and `...` past `*print-length*`, verified on
2.6.8). `maxElements` counts values, not the marker. A cycle prints `...` too;
SBCL has no equivalent marker there.

Defaults give byte-identical output to SBCL: `(1 2 3 4 5 6 7 8 ...)` and
`(((#)))`, as does shared structure (`((2) (2))`).

**Conses are mutable, so cycles are possible** — track the cells on the current
path and print `...` instead of recursing. Shared but acyclic structure prints
in full.

The printer emits the faithful string only: no legend, no second entry point.
Explaining what `#` means to a learner is a later, unsolved problem.

`test/pipeline.test.ts` drives `parse` → `evaluate` → `printValue`, so the
strings it asserts on come from values the interpreter built rather than
literals a test constructed. Its own file because it imports the reader and
interpreter; `print.test.ts` stays at the values layer.

## Open items

- Unimplemented forms, all in `standard-symbols.ts`: `loop`, `do`, `case`,
  `defstruct`, `handler-case`, multiple values, hash tables, `#+`/`#-`,
  backquote/unquote.
- `checkForms` could validate `lambda` bodies; today it checks arglists only.
- Benchmark pass over the corpus, to put numbers on parse/evaluate cost.
