;;;; Lispnt diagnostic showcase: mistakes that only appear when the code runs.
;;;; Expected: seven red marks —
;;;;   arity, type-error, index-error, division-by-zero,
;;;;   not-a-place, malformed-form, signalled-error
;;;; The last one wears the learner's own message, because (error "…") is how
;;;; you signal one.

(defun double (n) (* n 2))

(double)

(+ 1 "two")

(aref #(1 2 3) 5)

(/ 1 0)

(setf 5 1)

(defstruct 5)

(error "This message is mine: the learner wrote it.")
