# Lispnt

A read-only diagnostic path for Common Lisp, aimed at learners on SBCL, as a VS
Code extension that sits alongside OLIVE/SBCL.

The promise: **find the mistake before SBCL's debugger does.** Learner code is
usually a set of `defun`s loaded and compiled in the REPL, so everything here
exists to shorten that loop — without a live Lisp image. Lispnt parses the open
file with its own TypeScript s-expression reader and never evaluates anything in
SBCL. It is a linter, not an implementation.

## What it reports

| mark | meaning |
|---|---|
| red | the mistake fails when the code reaches it |
| yellow | the name may come from another file, so load that file first |

Messages are written as repairs rather than verdicts. Where SBCL says
`0 is not a symbol and cannot be used as a local variable`, Lispnt says:

> LET bindings need a pair of brackets each: write `((x 0))` so `X` is bound to
> `0`. As written, LET reads `X`, then takes `0` as a second binding, which
> fails.

What it finds today:

- **Broken brackets.** A stray `)` is marked where it sits. A list that never
  closes says how much is missing and where the first closer belongs — "3 lists
  are still open, so the file ends 3 `)` short. Add `)))` after the last line;
  the outermost opened on line 1" — and it underlines `(+` rather than a single
  character. When one closer was deleted and it made a form swallow the form
  below it, the mark moves to that form and says which line is off: "Bracket
  mismatch at line 9: COUNT-ZEROS was given 3 arguments; it takes 1 to 2. Check
  the COUNT-ZEROS form for a missing closing bracket." A missing closer also
  swallows the rest of the file, so names defined after it would look undefined;
  those warnings are dropped when the file's own recovered text defines the
  name, while warnings the file really has stay.
- **Malformed shapes.** `defun`, `lambda`, `let`/`let*` and `flet`/`labels`
  forms whose parts are missing or in the wrong place, each saying where the
  missing piece belongs.
- **Names.** Undefined functions, unbound variables, a variable called as a
  function, and argument counts — over every body in the file, whether or not
  anything calls it.
- **Runtime mistakes the file reaches,** such as a type error, an index out of
  range, or a division by zero.
- **Reader mistakes:** unterminated strings, block comments and dotted pairs.

An unimplemented standard form is always silent. A gap in Lispnt is never the
learner's mistake, so `unsupported-standard` never produces a mark.

## Value hints and the trace view

Hovering a name shows its value, `X = 5`, whenever the file's evaluation gave it
one. A `;;[trace]` comment above a definition names a call to follow:

```lisp
;;[trace] (fact 4)
(defun fact (n) (if (zerop n) 1 (* n (fact (1- n)))))
```

The activity-bar trace view runs that call and shows `FACT(4) => 24` with each
recursive call beneath its caller, the deepest level labelled, and a summary of
the call count, depth and final value. End-of-line value hints are off by
default and switched on per file from the trace view; nothing is written to
settings.

## Requirements and install

- VS Code `^1.147.0`.
- No SBCL and no OLIVE installation is required; it is read-only and offline.

Build a `.vsix` and install it with **Extensions → … → Install from VSIX**:

```
npm install
npm run build
npx @vscode/vsce package --no-dependencies
```

## Development

```
npm install
npm run build      # tsc
npm run check      # typecheck only
npm test           # builds, then runs each suite in turn
npm run bench      # timings over the corpus and a synthetic size ladder
```

`npm test` runs fourteen suites — 762 tests — in a couple of seconds. F5 from
this folder starts an Extension Development Host with Lispnt loaded
(`.vscode/launch.json`).

Measured on a 44-file corpus (80.8 KB): parsing takes 1.7 ms, analysis 7.5 ms,
value hints 10.8 ms and tracing 0.6 ms in total. The largest file, 19.6 KB,
analyses in 1.9 ms. Hint runs are the part that does not scale linearly — 1.3 ms
at 5.8 KB, 12 ms at 30 KB, 135 ms at 123 KB — because each finished form copies
the binding map, so the extension caches one run per document version.

## Layout

| file | role |
|---|---|
| `src/core/` | reader, values, interpreter, checks, diagnostics, trace, hints — no `vscode` import |
| `src/extension/api.ts` | the seam: every editor capability Lispnt uses, declared here |
| `src/extension.ts` | the one file that imports `vscode` for value |
| `src/extension/` | wiring, diagnostics presentation, trace view model, hint providers |
| `examples/diagnostics/` | one file per mark the extension can show |
| `lisp_test_files/` | fixtures, including the manual bracket test bed |
| `bench/` | the timings above |

The core is testable in plain Node, which is why the editor is behind that seam.

## Not implemented in this version

Lispnt is a deliberate subset of Common Lisp. Unsupported standard syntax fails
loudly inside Lispnt and silently for the learner: an unimplemented standard name
is never reported as the learner's mistake. What is absent, by choice:

- **Reader** — backquote/unquote/splice, `#+`/`#-`, unknown `#\` names (kept as
  symbols), and ratios (`1/2` reads as a symbol).
- **Checker** — `handler-case`; `defclass`, `defgeneric`, `defmethod`,
  `defmacro`, `deftype`, `defpackage`, `with-slots`, `with-accessors`,
  `handler-bind`, `restart-case`, `macrolet` and `symbol-macrolet`, whose bodies
  are recognised only as opaque syntax; unused bindings; type inference; the
  LOOP walk outside the clauses it decodes; and names defined in another file.
- **Evaluator** — full LOOP syntax (an unhandled clause is an error rather than a
  guess), `format` beyond `~a ~s ~d ~% ~~ ~&`, `defstruct`'s `:include` and slot
  options such as `:type`, and `LOAD`.
- **Trace** — a counting mode for calls too large to record, markers spanning
  several comment lines, markers that are not line comments, and call-site
  positions.
- **Editor** — navigation from the trace tree to the call site.

## Limits and known divergences

- **No ratios.** Integers and floats are distinguished (`1` is an integer, `1.0`
  a float), but a division CL would answer as a fraction is a float here:
  `(/ 1 2)` is `0.5`, not `1/2`.
- **One float type, JavaScript numbers underneath.** Integers beyond 2^53 lose
  precision (CL has bignums), and a float is single-float-shaped but printed as
  SBCL prints one, `1.0`.
- **No console.** `(format t …)` returns NIL after discarding its text.
- **`LOAD` is not followed.** A name defined in another file is a yellow mark,
  not a red one.

## License

MIT. See [LICENSE](LICENSE).

The activity-bar icon is the λ glyph outline traced from Cascadia Code, which is
licensed under the SIL Open Font License; the SVG's comment records the
provenance.


