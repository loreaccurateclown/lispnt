# Pending bracket-mismatch cases

Each file here is a definition with one `)` deleted: a swallow the current
bracket-mismatch hint does not cover. Open one and it shows today's fallback —
the unclosed form is marked and the message counts the missing closer — while the
header names what the recovered read finds. That recovered complaint is the
material for extending the hint.

| file | recovered read finds | what extending needs |
|---|---|---|
| `setf.lisp` | `operand-count` on the SETF | a SETF entry in the wording table |
| `return.lisp` | `operand-count` on the RETURN | a RETURN entry |
| `push.lisp` | `operand-count` on the PUSH | a PUSH entry |
| `pop.lisp` | `operand-count` on the POP | a POP entry |
| `incf.lisp` | `operand-count` on the INCF | an INCF/DECF entry |
| `multiple-value-setq.lisp` | `operand-count` on the MULTIPLE-VALUE-SETQ | an entry |
| `multiple-value-bind.lisp` | `operand-count` on the MULTIPLE-VALUE-BIND | an entry |
| `let-binding.lisp` | `let-binding` on the LET | a handler and span |
| `do-clauses.lisp` | `do-binding` *and* `do-end-test` on the DO | two handlers and a precedence rule |
| `dotimes-spec.lisp` | `iteration-spec` on the DOTIMES | a handler and span |
| `dolist-spec.lisp` | `iteration-spec` on the DOLIST | a handler and span |
| `defparameter.lisp` | `operand-count` on the top-level DEFPARAMETER | an entry, and a filter that accepts a complaint at the unclosed form |
| `defvar.lisp` | `operand-count` on the top-level DEFVAR | the same |

The two definition files are a special case: the recovered complaint starts at
the same offset as the unclosed form itself, so the current candidate filter
(`position > the unclosed opener`) would skip it even once the wording exists.

## Not reachable by a deleted closer

These hint codes cannot be produced by this mechanism, so wording for them would
never run:

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
