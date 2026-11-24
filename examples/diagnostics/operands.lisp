;;;; Lispnt diagnostic showcase: a special form with the wrong number of parts.
;;;; Expected: two red marks, both code operand-count —
;;;;   IF needs a test and its branches; SETQ needs a name and a value.

(if (> 3 1))

(setq *counter*)
