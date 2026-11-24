# Lispnt — handoff

Read this first in a new session. It records state, decisions, and working
conventions so nothing has to be re-derived. `ROADMAP.md` is the long-form
milestone record, including the **Agent working rules** section, which applies
to you.

Rewritten 2026-11-23 after the M3-EXTRA evaluator-gap work. Supersedes every
earlier copy.

## What this is

A read-only diagnostic path for Common Lisp (SBCL), aimed at learners, as a VS
Code extension that sits alongside OLIVE/SBCL. It parses the open file with its
own TypeScript s-expression reader and never evaluates anything in a live Lisp
image.

The promise: **find the mistake before SBCL's debugger does.** Learners write a
file, load and compile it in the REPL, and only at the third step discover
something is wrong. Everything static here exists to shorten that.

## Status

- **M1 reader, M2 analyzer, M3 interpreter, M4 value tracking, M4-STATIC static
  checks, M5 recursion trace — complete in core.**
- **M3-EXTRA — evaluator and standard-library gaps — shipped through multiple
  values**, with two slices planned and recorded in `ROADMAP.md`: lambda lists,
  then builtin keyword arguments. Read that section before starting work.
- **M6 extension glue — not started.** `activate()`, a diagnostics provider, a
  view; the only layer importing `vscode`.
- **M7 formatter / benchmarks — optional, after M6.**

Tests: **633** across eleven suites — 69 reader, 48 analyze, 259 interpreter,
48 print, 8 pipeline, 24 bindings, 44 scopes, 51 name-checks, 19 hints, 40
trace, 21 trace-cases. `npm test` is green at `ea87860`; the tree should be
clean at the end of a slice.

Corpus: **40 files** (4 in `lisp_test_files/`, 36 under `G:\My Drive\Labs\CPS305`,
outside the repo; reads work under the sandbox, nothing is written).
`analyze` reports **10 diagnostics on 2 files**, all genuine: `PI` never
defined in `lab04/q1.lisp`, and the `sum-kids`/`depth-kids`/`kids` mistakes in
`patterns_test2/list_search.lisp`. That number has not moved through any of the
M3-EXTRA work.

## Repo and toolchain

- TypeScript 7.0.2 pinned; Node 22.21.0. Branch `master`. Run `npm install`
  first if `node_modules/` is missing.
- `npm run build`; `npm run check`; `npm test` (builds, then runs each suite
  file explicitly — `node --test <dir>` fails in this sandbox because it spawns
  children). **Add every new suite to the `test` script.**
- `tsconfig`: `nodenext` module/resolution, `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (omit optional
  properties rather than assigning `undefined`), `noImplicitOverride`.
- `.npmrc` pins the npm cache to `.npm-cache`; the global cache is outside the
  sandbox and fails with EPERM.
- `userdocs/` is the user's own notes on Lisp — not project material, leave it
  alone unless asked.

## Layout

| file | role |
|---|---|
| `reader.ts` | cursor factory, `parse`/`parseAll`, AST (`AtomNode`, `ListNode`, `QuoteNode`), `#\` characters, `#(` vectors, comments as trivia |
| `errors.ts` | `ReaderError`, `LispEvalError`, `EvalErrorCode` |
| `values.ts` | `LispValue` union (`symbol`, `number`, `string`, `char`, `nil`, `cons`, `array`, `struct`, `hash`, `stream`, `values`, `function`, `builtin`), `NIL`, `Env`, `Place`, `intern` |
| `builtins.ts` | builtin table, `applyBuiltIn`, `expect*` helpers, hash-key canonicalisation |
| `interpreter.ts` | `evaluate`/`evaluateRaw`, special forms, `callValue`, `SPECIAL_FORMS`, budget, places, LOOP executor, multiple-value forms, `sort`/`maphash`/`apply`/`funcall` |
| `loop.ts` | LOOP clause types and parser only; executor lives in `interpreter.ts` |
| `standard-symbols.ts` | ANSI names Lispnt knows but does not implement — keep it true |
| `print.ts` | `printValue` with `princ` mode, `#S(…)`, `#<hash-table …>`, truncation |
| `bindings.ts` | `recordBindings`/`snapshotAt` |
| `hints.ts` | `collectHints`, `formatHint`/`formatLine` |
| `scopes.ts` | scope model, file symbol table, `walkWithScopes`, `OPAQUE_FORMS`, `symbolWord` |
| `name-checks.ts` | undefined/unbound/variable-as-function/arity checks |
| `checks.ts` | AST shape checks |
| `diagnostics.ts` | `Diagnostic`, message tables, error→diagnostic |
| `analyze.ts` | entry point: parse → shape checks → evaluation → static name checks |
| `trace.ts` | `traceCalls`/`traceFormIn`, `renderTrace`, `EXPLAIN_TRACE`, `TraceFrame` |
| `trace-cases.ts` | `traceCases` — the `;;[trace]` / `;;[trace:N]` marker |

Layering: `reader/values/errors → builtins → interpreter`, then consumers above
it (`bindings`, `hints`, `scopes`, `trace`, `trace-cases`), `name-checks` above
`scopes`, `analyze` on top.

**Hard rules:** `builtins.ts` must not import `interpreter.ts` — that is why
`APPLY`, `FUNCALL`, `MAPHASH` and `SORT` are registered in `interpreter.ts`
where `callValue` lives. `loop.ts` imports neither; it is pure parsing.

## Decisions worth not rediscovering

**Characters.** A character is its own value kind (`{ kind: "char" }`); it is
not a string and not a number (`(equal #\a "a")` is NIL, `(typep #\a
'character)` is T). Case is part of the value; character names are
case-insensitive (`#\Space` is `#\space`). Prints as `#\a`, `#\A`,
`#\Newline`, `#\Tab`; the space character prints as `#\Space` where SBCL prints
`#\` plus an invisible space. `eq` compares characters by code, as SBCL answers.

**Structures.** `DEFSTRUCT` is evaluated: `{ kind: "struct"; type; slots }`,
slots in definition order. Generates the keyword constructor `MAKE-NAME`, the
predicate `NAME-P`, the copier `COPY-NAME`, and one accessor per slot, with
`:conc-name nil` giving bare slot names. Accessors are `setf` places. `:include`,
other defstruct options, and slot options such as `:type` are
`unsupported-standard`. Prints `#S(NAME :SLOT value …)`, compares by identity
(`equal` does not descend; `equalp` here does not either — a recorded
divergence), and answers `TYPEP` once defined. Keyword arguments in constructors
only for now; lambda lists are the next slice.

**LOOP — a deliberate subset, and it fails loudly.** Implemented:
`(loop form…)`; `for`/`as` with `in`, `on`, `across`, and numeric
`from`/`to`/`below`/`above`/`by`; `while`, `until`, `repeat`; `do`,
`collect`, `append`, `sum`, `count`, `maximize`, `minimize`, each with `into`;
`initially`, `finally`, `return`; `if`/`when`/`unless` with `else`, `and`,
`end`. Any other clause word — `named`, `with`, `thereis`, `always`, `never`,
`nconc`, `being`, `using` — is `unsupported-standard`, never silently skipped.
Semantics: drivers step in parallel and bind before the termination test;
`into` leaves the loop's value NIL unless a `finally` returns; `finally` does
not run when `return` exits; clauses sharing an implicit accumulator of the same
kind share one value, while two different kinds are an error — all verified
against SBCL. Shape rules enforced as SBCL does: a driver may not follow a main
clause or sit inside a conditional body, and `do`/`initially`/`finally` take
compound forms. **Full LOOP syntax was rejected**: measured demand is 9 forms in
5 files and four of those need hash tables, multiple values or defstruct.

**Hash tables.** `{ kind: "hash"; test; entries }`. `:test` is one of `eq`,
`eql`, `equal`, `equalp`; a key is found again through a canonical form chosen
by the test — atoms by value, `eq`/`eql` cons/array/struct keys by identity,
`equal`/`equalp` by full printed form (not the truncated REPL form). `equalp`
is treated as `equal`. Printing is `#<hash-table :count n>`; iteration order is
insertion order, which CL leaves unspecified. `LOOP`'s hash drivers walk it.

**FORMAT.** `(format destination control args…)` implements `~a`, `~s`, `~d`,
`~%`, `~~`, `~&`; `nil` returns the string, `t` returns NIL and discards (no
console), a stream destination writes into the stream. **Two-tier failure:** a
directive ANSI defines but Lispnt has not built (`~b`, `~x`, `~r`, `~p`, `~c`,
`~t`, the iteration and justification clusters) is `unsupported-standard`; a
character that is not a directive at all (`~q`) is `malformed-form`. Parameters
and modifiers (`~5d`, `~:@a`) are `unsupported-standard`. `~a` is princ-style —
a `princ` option on `printValue`.

**Streams.** `with-output-to-string` binds a string output stream and returns
what was written; `write-char`, `write-string`, `princ`, `prin1` append and
return their object; `princ-to-string`/`prin1-to-string` return text. With no
stream argument text is discarded — there is no `*standard-output*`, the same
divergence as `format t`. `typep` answers `stream`.

**Sequences.** `car`/`cdr` of NIL are NIL; any other non-list is a
`type-error`. `length` and `elt` read strings (a string is a sequence of
characters). `getf` has a default and is a `setf` place (update in place, or
cons a new pair on the front); a non-list plist is a `type-error` and a lone
trailing indicator is `malformed-form`. `sort` takes two arguments, covers
lists, vectors and strings, **copies** rather than mutating (so a recorded
snapshot cannot change under a hint) and is stable (a harmless superset of CL).
`string<` compares string designators. The `gethash` place honours its default,
which is what lets `(incf (gethash k table 0))` start from zero.

**Multiple values.** A values bundle exists internally but never reaches a
single-value context: `evaluate` takes the primary. `multiple-value-bind`,
`multiple-value-list` and `multiple-value-setq` are special forms (CL has them
as macros) because each needs its operand unevaluated; missing values bind to
NIL. `gethash` answers present-p and `floor` its remainder. The trace prints
every value a call returned (`F() => 1 2`), matching SBCL's trace; the call
observer receives the body's raw result while callers get the primary.

**Budgets.** `HARD_STEP_CEILING = 2_000_000` is a never-exceeded backstop.
`withStepCeiling` takes a per-pass ceiling in `1 … HARD`, refuses a second open
pass, and restores state in `finally`. The counter is **scoped to the outermost
evaluation when no pass is open**, so a budget error thrown outside a pass
cannot leave it above the ceiling and disable every later evaluation — a bug
that once turned one stale test into twenty-six failures. **LOOP charges one
step per iteration**, so a loop whose body evaluates nothing still stops; before
that, `(loop)` was uninterruptible and hung a test run for half an hour.

**Diagnostics.** Severity describes the program's execution, not SBCL's compile
status — a deliberate divergence: red means "this fails when reached", yellow
means "the name may come from outside this file". `error`: `variable-as-function`,
arity against a uniquely defined name, arity against a builtin. `warning`:
`undefined-function`, `unbound-variable`, arity when a name is defined more than
once. Silent: standard-but-unimplemented names, globals called as functions,
`*special*` names, keyword arguments, `(load …)` files. `analyze` drops the
evaluator's own `undefined-function`, `unbound-variable` and `arity`; the static
checker owns those. Runtime-only codes stay with evaluation.

**Opaque forms (checker-side).** `defclass`, `defgeneric`, `defmethod`,
`defmacro`, `deftype`, `defpackage`, `with-slots`, `with-accessors`,
`handler-bind`, `restart-case`, `macrolet`, `symbol-macrolet`. The walk stops at
them, so their contents are unchecked rather than misreported.

**`STANDARD_SYMBOLS` must stay true.** 189 names now. Implemented names were
removed across several slices; `WRITE-CHAR` and `SORT` are the two known
leftovers, recorded in the planned cleanup. A name in the list is silent when
called, so leaving an implemented one there hides arity checks.

**Rejected, with reasons (do not re-propose without new evidence):** a static
value tier; test-case inference; a REPL/scratchpad; a static call graph; full
LOOP clause syntax; `LOAD` (harness-only corpus use, and it needs a path on
`analyze`/`trace-cases`, a separate budget, a load-cycle guard, and a file field
on `Diagnostic` that does not exist).

## Working conventions

**Permission.** No code without an explicit instruction; "go ahead" is one. If a
slice is proposed, it gets an outline and waits for approval. If something goes
wrong mid-work, **halt and explain the problem** — see the Agent working rules
in `ROADMAP.md`, which include the time bounds for runaway commands.

**Commits.** One commit per completed slice, with `ROADMAP.md` text describing
that slice folded in. Doc-only edits (this file, corrections) may stand alone. A
roadmap note about unshipped work waits for the next code commit — that is the
only reason the roadmap is ever dirty. Record shipped items under M3-EXTRA's
`Shipped` and move them out of `Planned` in the same commit.

**Outlines.** The user does not write the code. Preferred outline: changes per
file, genuine decisions, test list, sizes. Do not pad a decision list with
choices where one option is plainly correct; state the call and move on.

**Output honesty.** Paste test and tool output verbatim. Short outputs in full,
never abbreviated; only genuinely large ones get a labelled head/tail excerpt.

**Naming.** Do not invent shorthand without asking. Prefix exported types and
classes (`LispValue`, `ReaderError`, `LispEvalError`) because JS/DOM globals
include `EvalError`, `Node`, `Element`, `Event`, `Text`, `Range`, `File`.

## Next steps

Both are recorded in `ROADMAP.md` under M3-EXTRA `Planned`; start with the first.

1. **Lambda lists.** `&optional` (defaults, supplied-p), `&rest`/`&body`, `&key`
   (defaults, supplied-p, `((:kw name) …)`), `&aux`; `&allow-other-keys` out.
   The checker's arity rule must follow: `min` = required count, `max` unbounded
   once `&key`/`&rest` appears, or keyword calls become false arity reports.
2. **Builtin keyword arguments.** One shared parser (unknown key
   `unsupported-standard`, odd count `malformed-form`, non-keyword `type-error`):
   `sort :key`; `count :test`/`:key`; `make-array :initial-element`,
   `:initial-contents`, `:adjustable`, `:fill-pointer` (`:element-type`
   refused); `make-hash-table :size` and the rehash hints accepted as hints
   because CL gives them no observable effect; `vector-push`,
   `vector-push-extend`, `make-string`. The array gains an optional fill pointer:
   `length` honours it, `aref` stays capacity-bounded, printing shows the filled
   part. Plus `with-hash-table-iterator` (needs multiple values, which exist) and
   the `WRITE-CHAR`/`SORT` silent-list cleanup.
3. **M6**, the extension shell.

## How to check the corpus

No committed script. After `npm run build`, walk `lisp_test_files/` and
`G:\My Drive\Labs\CPS305` for `*.lisp`/`*.lsp` (skip `backup`), and for each file
run `analyze` from `dist/src/core/analyze.js`; report counts by code and file.
Expected: 40 files, 10 diagnostics, as above.

Trace spot-checks that should hold (all verified against SBCL):

| file | call | result |
|---|---|---|
| `patterns_test2/list_search.lisp` | `(LEVEL-ORDER '(1 (2 (3)) 4))` | `(1 2 4 3)` |
| `lisp/patterns.lisp` | `(LEVEL-ORDER '(1 (2 (3)) 4))` | `(1 2 4 3)` |
| `lisp/practicum2-all-topics.lisp` | `(AVERAGE-LIST-LOOP '(1 2 3 4))` | `2.5` |
| `lab08-practice/q4.lisp` | `(BTREE-COLLECT-BFS …)` | `(1 2 3)` |
| `lab08-practice/q3.lisp` | `(BTREE-HEIGHT …)` | `2` |
| `lisp/patterns.lisp` | `(TABLE-SUM *t*)` over `("a" 1) ("b" 2)` | `3` |
| `lisp/patterns.lisp` | `(TABLE-KEYS *t*)` | `("a" "b")` |
| `lisp/patterns.lisp` | `(UPPER-STRING "abc")` | `"ABC"` |
| `lisp/practicum2-all-topics.lisp` | `(GRADE-LETTERS #(90 45 72 88))` | `"AFBA"` |

The last one matters: the file's own comment says `"ACBA"`, and SBCL agrees with
`"AFBA"` — the comment is the bug, not the evaluation. `print-pairs-do` still
stops at `with-hash-table-iterator`; that is planned, not a regression.
