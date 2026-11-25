# Lispnt

[![CI](https://github.com/loreaccurateclown/lispnt/actions/workflows/ci.yml/badge.svg)](https://github.com/loreaccurateclown/lispnt/actions/workflows/ci.yml)

A read-only diagnostic path for Common Lisp, aimed at learners on SBCL, as a VS
Code extension that sits alongside OLIVE/SBCL. Implements a limited subset of Common Lisp. Not meant for serious Lisp development.



## Human Summary of Project
I wrote this (or more accurately, asked an LLM to write this) because I couldn't find a learner-oriented inline linter for Common Lisp (Steel Bank Common Lisp). I am learning data structures through Lisp and generally write single files or functions that demonstrate a concept and have an execution flow of being loaded and compiled, then called directly by the function name in SBCL's REPL with a test case. This does not replace any other lisp extensions that I know of, because it does one very specific thing in the most lightweight manner possible: **Check your CL code for errors before you have to mess with the REPL.** 

### Why?
I find the `(load "filename.lisp")` -> `(compile-file "filename.lisp")` -> `(fnname (test-case))` loop to be very slow coming from modern languages like Python, Java, etc. The other issue is that even if I was okay with `Alt + Up Arrow`'ing through those three commands every time I wanted to edit something or fix a bug, or even if I wanted to prototype something or print values for manual debug, I would have to run those 3 commands. If I want to trace a function SBCL has a beautiful trace, but it requires both tracing and untracing. It is of course a programmatic macro that can be specified in the source file, but this both enables a global trace state that has to be untraced from (nonintuitive), and also I'm just honestly pretty bad at Lisp and would consider this another potential point of failure while I'm still trying to remember where my brackets broke.

Finally, I frequently just do not have any idea what SBCL's debugger is trying to communicate to me. This is absolutely a skill issue. Still, that's the exact reason Lispnt exists, to bridge that knowledge gap with learner-friendly messaging and marking of invalid syntax. 

### Lispnt's Purpose
Lispnt reads your code and tries to identify common errors a learner would make, such as broken brackets, incorrect arity (# of arguments) of functions, end of line view of value hints and two trace summary views: one as a VS Code widget and one as a simple text file, invoked in the file by placing a comment with:
`;; [trace] (test-case)`
Above or near the relevant function. None of this requires any bothering of SBCL, so you can trace without having to modify your code or clutter your REPL's command history. Hopefully it might even debug common syntax/logic errors before you go through the entire load/compile/run process in the REPL just to find out you forgot to type two brackets for that `(let)` var instead of one. 

### What it does Not do
Check the bottom of this readme in the LLM written section for a list of things not implemented. Mostly I chose not to implement things I hadn't used or didn't understand. The biggest and possibly most confusing gap is most likely our **partial implementation of the `(loop)` form/sublanguage**. It is unfortunately far too much for me to accurately supervise an LLM's implementation of that feature when I barely understand how basic `(loop)`s work. Feel free to fork your own copy, this is MIT Licensed.



# 
### Environmental Impact of LLM Use 
I used Neuralwatt's [nw-flash model](https://portal.neuralwatt.com/models/nw-flash), currently pointing to DeepSeek V4.1 Flash 1017. I moved between the flex tier (somewhat more energy efficient, cheaper) and regular nw-flash, but the majority of development was on nw-flash.
### Stats
| Energy Consumption | CO<sub>2</sub> generated (mass) |
|--------------------|---------------------------------|
| 2.70 kWh  | 1.03 kg |

In understandable terms, 1.03kg CO<sub>2</sub> is roughly 5.7km driven in a base model 2025 Hyundai Elantra using data from Open Government Canada's [2025 Fuel Consumption Ratings dataset](https://open.canada.ca/data/en/dataset/98f1a129-f628-4ce4-b24d-6f16bf24dd64/resource/d589f2bc-9a85-4f65-be2f-20f17debfcb1)
<br>

## README (LLM Written)
The promise: **find the mistake before SBCL's debugger does.** Learner code is
usually a set of `defun`s loaded and compiled in the REPL, so everything here
exists to shorten that loop — without a live Lisp image. Lispnt parses the open
file with its own TypeScript s-expression reader and never evaluates anything in
SBCL. It is a linter, not an implementation.

## What it reports

| mark | meaning |
|---|---|
| red | the mistake fails when the code reaches it |
| yellow | the name may come from another file; Lispnt reads one file at a time, so it cannot resolve it |

Messages are written as repairs rather than verdicts. Where SBCL says
`0 is not a symbol and cannot be used as a local variable`, Lispnt says:

> LET bindings need a pair of brackets each: write ((x 0)) so X is bound to 0.
> As written, LET reads X, then takes 0 as a second binding, which fails.

What it finds today:

- **Broken brackets.** A stray `)` is marked where it sits. A list that never
  closes says how much is missing and where the first closer belongs — "3 lists
  are still open, so the file is 3 closing parentheses short. Add ))) after the
  last line; the outermost opened on line 1" — and it underlines (+ rather than a
  single character. When one closer was deleted and it made a form swallow the form
  below it, the mark moves to that form and says which line is off: "Bracket
  mismatch at line 9: COUNT-ZEROS was given 3 arguments; it takes 1 to 2. Check
  the COUNT-ZEROS form for a missing closing bracket." That covers a call's
  arguments, the operand count of the common special forms, a LET binding list,
  DO clauses, DOTIMES/DOLIST specs and a LABELS entry. The mark only moves when a
  form inside the recovered complaint starts its own line — the shape a swallowed
  sibling leaves. If the unclosed form is itself a LET whose binding list is
  wrong, one message gives the double-bracket repair first and the missing closer
  after it: writing `((x 0))` in `(let (x 0)` is still the first thing to fix. A
  missing closer also
  swallows the rest of the file, so names defined after it would look undefined;
  those warnings are dropped when the file's own recovered text defines the
  name, while warnings the file really has stay.
- **Malformed shapes.** `defun`, `lambda`, `let`/`let*` and `flet`/`labels`
  forms whose parts are missing or in the wrong place, and the operand count of
  the common special forms, each saying where the missing piece belongs.
- **Names.** Undefined functions, unbound variables, a variable called as a
  function, and argument counts — over every body in the file, whether or not
  anything calls it. A top-level `(load …)` silences both name warnings for that
  file — undefined functions and unbound variables — because the names may come
  from the loaded file, and nothing is read from disk to check.
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

`package.json` carries the repository URL, so `vsce` resolves the README's
relative links against it; the publisher is `SK-Clownsoft`.

## Development

```
npm install
npm run build      # tsc
npm run check      # typecheck only
npm test           # builds, then runs each suite in turn
npm run bench      # timings over the fixtures, LISP_CORPUS if set, and a size ladder
```

`npm test` runs fourteen suites — 823 tests — in a couple of seconds. F5 from
this folder starts an Extension Development Host with Lispnt loaded
(`.vscode/launch.json`).

Measured with an additional folder set through `LISP_CORPUS` (63 files, 87.3 KB):
parsing takes 1.9 ms, analysis 8.8 ms,
value hints 11.4 ms and tracing 0.6 ms in total. The largest file, 19.6 KB,
analyses in 1.9 ms. Hint runs are the part that does not scale linearly — 1.2 ms
at 5.8 KB, 12.8 ms at 30 KB, 140 ms at 123 KB — because each finished form copies
the binding map, so the extension caches one run per document version. Point
`npm run bench` at your own files with `LISP_CORPUS` (`$env:LISP_CORPUS = "C:\labs"`
in PowerShell, `LISP_CORPUS=/path/to/labs` in bash).

## Layout

| file | role |
|---|---|
| `src/core/` | reader, values, interpreter, checks, diagnostics, trace, hints — no `vscode` import |
| `src/extension/api.ts` | the seam: every editor capability Lispnt uses, declared here |
| `src/extension.ts` | the one file that imports `vscode` for value |
| `src/extension/` | wiring, diagnostics presentation, trace view model, hint providers |
| `fixtures/showcase/` | one file per mark the extension can show |
| `fixtures/cases/` | fixtures the suites read; `bracket_mismatch/` holds the deliberate broken files |
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
- **`LOAD` is not followed.** A top-level `(load …)` silences both name warnings
  for the file — undefined functions and unbound variables — because the loaded
  file may define them; nothing is read from disk. Any other name from another
  file is a yellow mark, not a red one.

## License

MIT. See [LICENSE](LICENSE).

The activity-bar icon is the λ glyph outline traced from Cascadia Code, which is
licensed under the SIL Open Font License; the SVG's comment records the
provenance. Squiggles artisanally generated by the finest of fish-based Large Language Models.


