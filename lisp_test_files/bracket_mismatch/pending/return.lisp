;;;; Pending bracket case: RETURN holding two forms.
;;;; Today this falls back to the unclosed form's mark and the count message.
;;;; Recovered read finds: operand-count on the RETURN.
;;;; Extension needs a RETURN entry in the operand wording table.
(defun f (x)
  (return x
  (print x))
