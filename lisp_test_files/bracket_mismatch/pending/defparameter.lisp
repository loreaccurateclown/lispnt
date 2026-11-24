;;;; Pending bracket case: a top-level DEFPARAMETER swallowing the next definition.
;;;; Today this falls back to the unclosed form's mark and the count message.
;;;; Recovered read finds: operand-count on the DEFPARAMETER.
;;;; Extension needs a DEFPARAMETER entry, and a candidate filter that accepts a complaint at the unclosed form itself.
(defparameter *x* 1 "doc"
(defparameter *y* 2)
