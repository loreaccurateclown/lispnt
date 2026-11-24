;;;; Pending bracket case: a top-level DEFVAR swallowing the next definition.
;;;; Today this falls back to the unclosed form's mark and the count message.
;;;; Recovered read finds: operand-count on the DEFVAR.
;;;; Extension needs a DEFVAR entry, and a candidate filter that accepts a complaint at the unclosed form itself.
(defvar *x* 1 "doc"
(defvar *y* 2)
