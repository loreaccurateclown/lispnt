;;;; Pending bracket case: MULTIPLE-VALUE-BIND with its names list left open.
;;;; Today this falls back to the unclosed form's mark and the count message.
;;;; Recovered read finds: operand-count on the MULTIPLE-VALUE-BIND.
;;;; Extension needs a MULTIPLE-VALUE-BIND entry in the operand wording table.
(defun f ()
  (multiple-value-bind (a
    (values 1) a))
