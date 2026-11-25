# Lispnt — handoff

Read this first. It records the state of the project, the decisions that shaped
it and the places to look. `ROADMAP.md` is the long-form milestone record,
including the **Agent working rules** section, which applies to you. This file
supersedes earlier copies; when it disagrees with `ROADMAP.md`, this file is
current.

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
  checks, M5 recursion trace, M6 extension glue — complete.** M6 is through
  slice 6.5a (tree view, pin, value hints, tooltips).
- **Benchmarks — shipped** (`npm run bench`, `bench/run.mjs`).
- **Repo and packaging.** Public at
  https://github.com/loreaccurateclown/lispnt, branch `main`; publisher id
  `SK-Clownsoft`; CI runs `npm test` on every push. `vsce package` produces a
  `.vsix`; no Marketplace release is published yet (that needs a Trusted
  Publishing policy and the OIDC workflow).
- **M7 formatter — not started,** optional.
- The user has run the extension in a real editor and reported diagnostics,
  squiggles, messages, the trace view and the value hints working there.

Tests: **821** across fourteen suites — 73 reader, 101 analyze, 317 interpreter,
49 print, 8 pipeline, 24 bindings, 48 scopes, 59 name-checks, 20 hints, 40
trace, 24 trace-cases, 9 trace-tree, 10 value-hints, 39 extension.

Corpus (the manual check, no committed script): **63 files**, 26 under
`fixtures/cases/` and 37 from a local lab corpus,
89 KB. `analyze` reports **31 diagnostics**: 10 on learner code, 2 deliberate on
`bracket_imbalance.lisp`, and 19 deliberate on the bracket-mismatch fixtures.
8 files produce a trace frame and 13 produce a value hint once the `;;[trace]`
markers run.

## Repo and toolchain

- TypeScript 7.0.2 pinned; Node 22.21.0. Branch `main`; remote `origin` is
  https://github.com/loreaccurateclown/lispnt. `npm install` first if
  `node_modules/` is missing.
- `npm run build`; `npm run check`; `npm test` (builds, then runs each suite file
  explicitly — `node --test <dir>` fails in this sandbox because it spawns
  children). **Add every new suite to the `test` script.**
- `npm run bench` times parse/analyze/hint/trace over the fixtures, the folder in
  `LISP_CORPUS` when set, and a synthetic ladder; it is not part of `npm test`.
- `tsconfig`: `nodenext`, `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes` (omit optional properties, never assign
  `undefined`), `noImplicitOverride`.
- `.npmrc` pins the npm cache to `.npm-cache`; the global cache is outside the
  sandbox and fails with EPERM.
- `@types/vscode` is pinned exactly at **1.146.0**; `engines.vscode` is
  **^1.147.0** (the installed editor). Types must stay at or below the engines
  floor.
- `extension-test.code-workspace` is the user's scratch workspace for running the
  extension against the corpus; it is gitignored and worth keeping on disk.
- `userdocs/` is the user's own notes on Lisp; it is gitignored and no longer
  tracked, but leave it alone.
- Sandbox traps met here: `vsce` spawns npm and fails under the sandbox, so
  package with `--no-dependencies`; install it with
  `npm i --no-save --no-package-lock --ignore-scripts @vscode/vsce` (its
  postinstall also spawns). The real bin is `node_modules/@vscode/vsce/vsce`.

## Layout

| file | role |
|---|---|
| `src/core/reader.ts` | cursor factory, AST with positions, comments as trivia, `#\` chars, `#(` vectors, error frames |
| `src/core/errors.ts` | `ReaderError` (with `openForms`), `LispEvalError`, codes |
| `src/core/diagnostics.ts` | `Diagnostic`, the reader/eval message tables, severity |
| `src/core/analyze.ts` | the pipeline: parse, shape checks, evaluation, name checks, bracket recovery, trace markers |
| `src/core/checks.ts` | AST shape and operand checks with repair messages |
| `src/core/scopes.ts` | scope walk and symbol table |
| `src/core/name-checks.ts` | undefined functions, unbound variables, arity, variable-as-function |
| `src/core/interpreter.ts` | evaluator, special forms, places, step budget, loop drivers |
| `src/core/loop.ts` | LOOP clause parser (fail-loud outside its subset) |
| `src/core/builtins.ts` | the builtin table, TYPEP, equality, hash keys |
| `src/core/values.ts` | value kinds, `numberValue`/`isFloatNumber` |
| `src/core/print.ts` | `printValue` (readable and princ modes) |
| `src/core/bindings.ts` | run the file and snapshot bindings per finished form |
| `src/core/hints.ts` | hint runs (`hintsForLine`, `hintsInLines`, `hintAt`) |
| `src/core/trace.ts` | trace recorder and renderer, caps, `EXPLAIN_TRACE` |
| `src/core/trace-cases.ts` | `;;[trace]` marker scanning and per-case runs |
| `src/extension/api.ts` | the seam: every editor capability the extension uses |
| `src/extension.ts` | the only file importing `vscode` for value; adapters |
| `src/extension/` | activation, diagnostics presentation, tree model, hint/hover providers |
| `test/` | one suite per area; `npm test` runs each file explicitly |
| `fixtures/showcase/` | one file per mark the extension can show; a test locks the codes |
| `fixtures/` | `cases/` for the suites, `showcase/` for the editor demonstration; see its README |
| `bench/run.mjs` | the timing pass |

## Core design facts

**Values.** `nil`, symbol, number, string, char, cons, array (with fill
pointer), struct (`{ kind: "struct"; type; slots }`), hash (`{ kind: "hash";
test; entries }`), stream, values bundle, function, builtin. Numbers carry a
`float?: boolean` flag set from the token (`1` integer, `1.0` float); arithmetic
is a float when any operand is, and exact integer results stay integers. There
are **no ratios**: `(/ 1 2)` is `0.5`, and a written `1/2` reads as a symbol.
`eql`/`equal` keep `1` and `1.0` apart; `=` and `equalp` do not.

**Diagnostics.** `{ code, severity, message, position, end?, name?, arityInfo? }`.
`end` is a range when the core knows the extent, else the presentation layer
underlines the whole line. Messages are **plain text** — the editor renders a
diagnostic message as text, not markdown (`microsoft/vscode#54272` is open) — so
no backticks, and a bracket is named in words ("add a closing parenthesis").
Codes fall into reader errors, shape codes, eval codes, name codes, `trace-marker`
and the synthesized `bracket-mismatch`. `unsupported-standard` is our gap and is
never shown; the fold in `analyze` drops it.

**Brackets.** `readList` records each open frame as an error unwinds (its `(` and
the position past the form head), so the message counts missing closers and an
unclosed form underlines `(let`/`(defun` rather than one character. `analyze`
re-parses with the missing closers appended. That hypothetical read is used to
(a) drop name warnings the truncation manufactured and (b) relocate the mark to a
form that swallowed its sibling, with the code `bracket-mismatch`. The relocation
needs evidence: a form inside the recovered complaint that begins its own line
(excluding the appended closers themselves). The complaint nearest EOF wins; ties
go to the more specific code. When the unclosed form is itself a LET whose binding
list is wrong, one message gives the double-bracket repair first and the missing
closer after it. With more than one open list, the count message stays.

**Shape checks.** `defun`/`lambda`/`let`/`let*`/`flet`/`labels` shapes, and the
operand counts of IF, WHEN/UNLESS, SETQ/SETF, COND/CASE clauses, DO/DO*, DOTIMES/
DOLIST, MULTIPLE-VALUE-BIND/SETQ, RETURN, PUSH, POP, INCF/DECF, DEFPARAMETER,
DEFVAR. Messages state the repair, using the learner's own text where possible. A
name warning inside a form that already carries a shape mark is suppressed: one
repair at a time.

**Name checks.** The scope walk sees every body, called or not. `name-checks`
runs after evaluation and drops the evaluator's copies of arity/unbound/undefined.
Diagnostics carry `name`, which the bracket recovery uses to tell a manufactured
warning from a real one. `standard-symbols.ts` holds ANSI names Lispnt knows but
does not implement (224 of them); two lock tests assert every listed name answers
`unsupported-standard` and that no builtin or special form is on the list.

**Evaluator limits.** A step budget: 2,000,000 backstop, 200,000 for the value
pass, scoped to the outermost evaluation. Every loop iteration charges one step
(LOOP, DO/DO*, DOTIMES, DOLIST), so a body-less loop still stops; DO rejects a
missing or empty end-test clause before looping. Evaluator errors surface as
diagnostics; `unsupported-standard` stays silent.

**Trace.** A `;;[trace] (call)` line comment names one call; each marker is an
independent case in a fresh environment, so one case cannot see another's
mutations. Recorder caps: 200,000 steps, depth 64, 1,000 frames; past a cap
evaluation completes but recording stops and `truncated` says so. One line per
call (`NAME(args) => result`), `root: 0:` on the outermost, `max depth: n:` on
the deepest, and a summary with call count, depth and final value. This is a
deliberate layout difference from SBCL's entry/return pair (see ROADMAP M5).
`EXPLAIN_TRACE` is four short lines.

**Hints.** `recordBindings` runs the file and copies the binding map when each
list form finishes; a hint exists where a name is read and the run has a value.
The hint run also evaluates the `;;[trace]` calls, so uncalled functions still
show values. The extension caches one run per document version, paints one hint
per line at line end, off by default and toggled per file from the trace view
(session state, no settings write); hover always shows the value for a name, and
a hint cut by `editor.inlayHints.maximumLength` carries a tooltip listing every
binding on the line.

**Extension.** `src/extension/api.ts` declares the editor capabilities; only
`src/extension.ts` imports `vscode` for value, and a test walks `src/` to keep it
that way, so the wiring runs against a fake in plain Node. Selector: `lisp`
language or `.lisp`/`.lsp`/`.cl`/`.asd` paths; no language contribution, so OLIVE
keeps the id. Checks on open, save, debounced edits, and at activation. The trace
document is one shared read-only document on `lispnt-trace`, opened with
`preview: false`; the tree lives in the `lispnt` activity-bar container, follows
the active editor, refreshes on save and view visibility, and is pinned by
`lispnt.pinned`. Header buttons are ordered `navigation@1`/`@2`/`@3` because only
one of each swapped pair is visible.

## Working conventions

- **Permission:** no code without an explicit go. Outlines are proposals;
  commentary on a plan is not approval. When the boundary of an approved slice
  moves, say so before writing.
- **Claims:** platform behaviour gets looked up (typings, release notes, source,
  SBCL), never asserted from memory. SBCL is installed; ask it with a script file
  rather than shell quoting.
- **Halt and explain** when something goes wrong: what is known, what is not,
  what would be tried next. Do not spend turns probing without a hypothesis.
- One commit per slice, with the ROADMAP text folded into it. Doc-only commits may
  stand alone. Tree clean at slice end; paste tool output verbatim.
- Messages are plain text (see above); repair snippets are written the way a
  learner types them. Exported types get a domain prefix (`LispValue`,
  `ReaderError`, `LispEvalError`) because JS globals include `EvalError`, `Node`,
  `Element`, `Range`, `File`.
- No settings writes from toggles. `(Widget Only)` marks terse commands. The
  activity-bar icon is derived from Cascadia Code (SIL OFL) — see the SVG comment.
- Test commands run the suite files explicitly, never `node --test <dir>`.
- The `Not implemented` lists in the ROADMAP are decisions, not a backlog.

## Known divergences (deliberate)

- No ratios: division that CL answers as a fraction is a float (`0.5`).
- One float type over JavaScript numbers: integers beyond 2^53 lose precision, and
  a float prints as `1.0` like SBCL's single-float.
- No console, so `format t` discards; there is no `*standard-output*`.
- `LOAD` is not followed. A top-level `(load …)` silences undefined-function
  warnings for the file; other names from another file are at most a warning.
- A string is a vector of characters for `TYPEP`/`AREF`/`ARRAYP`/`VECTORP`, but it
  is a distinct value kind internally.

## Deferred or excluded

See the ROADMAP's Coverage section. In short: backquote/`#+`/`#-` in the reader;
`handler-case`; the opaque forms (`defclass`, `defmethod`, `defmacro`,
`with-slots`, …); unused bindings; type inference; the LOOP walk outside its
clauses; full LOOP syntax; FORMAT beyond its six directives; `defstruct`
`:include` and slot options; ratios; call-site positions; a counting trace mode;
multi-line trace markers; trace-tree navigation. M7 (formatter) is optional.

## First moves in a new session

1. `npm install` if needed, then `npm run build` and `npm test` — 821 tests,
   about two seconds.
2. Read `ROADMAP.md`'s Agent working rules before changing anything.
3. The manifest, publisher id and repository URL are set; the remaining publish
   step is a Marketplace Trusted Publishing policy plus the OIDC workflow.
