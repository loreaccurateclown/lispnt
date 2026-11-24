# Bracket-mismatch fixtures

Each file here is a definition with one `)` deleted. The reader cannot close the
form, so `analyze` supplies the missing closer at the end of the file and reads
again. When that recovered read shows a form that swallowed its sibling, the mark
moves there and the message names the line, the form and what it takes; when
nothing was swallowed, the unclosed `defun` is marked and the message counts the
missing closer (`bracket_mismatch_last_closer.lisp`).

| recovered read finds | files |
|---|---|
| `arity` on a call | `bracket_mismatch_arity.lisp` |
| `operand-count` on IF / SETQ | `bracket_mismatch_if_operands.lisp`, `bracket_mismatch_setq_operands.lisp` |
| `operand-count` on SETF / RETURN / PUSH / POP / INCF | `setf.lisp`, `return.lisp`, `push.lisp`, `pop.lisp`, `incf.lisp` |
| `operand-count` on MULTIPLE-VALUE-SETQ / MULTIPLE-VALUE-BIND | `multiple-value-setq.lisp`, `multiple-value-bind.lisp` |
| `operand-count` on a top-level DEFPARAMETER / DEFVAR | `defparameter.lisp`, `defvar.lisp` |
| `let-binding` on a LET | `let-binding.lisp` |
| `do-binding` on a DO (the end-test complaint loses the tie) | `do-clauses.lisp` |
| `iteration-spec` on DOTIMES / DOLIST | `dotimes-spec.lisp`, `dolist-spec.lisp` |
| `local-definition` on a LABELS entry | `bracket_mismatch_labels_entry.lisp` |
| nothing — only the final closer is missing | `bracket_mismatch_last_closer.lisp` |

## Not reachable by a deleted closer

These codes cannot be produced by this mechanism, so they have no fixture and no
hint wording:

- `clause-shape` (COND/CASE): a swallowed form lands inside a clause, which is
  legal body.
- `defun-name`, `local-definitions`, `let-bindings`: a swallow inserts forms into
  an existing list and never turns a list into a non-list.
- `defun-arglist`, `lambda-arglist`: the shape check only requires a list, and a
  swallowed body form still leaves one.
- `WHEN`/`UNLESS`: they require a test and accept any body, so a swallow cannot
  violate their operand rule.

## Deliberately excluded

- Name complaints (`undefined-function`, `unbound-variable`): these are the
  warnings the truncation manufactures, which analysis already suppresses.
- Evaluation complaints (`type-error`, `division-by-zero`, …): the recovered read
  is parsed and checked but never evaluated.
