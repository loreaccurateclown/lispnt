;;;; Pending bracket case: INCF holding three forms.
;;;; Today this falls back to the unclosed form's mark and the count message.
;;;; Recovered read finds: operand-count on the INCF.
;;;; Extension needs an INCF/DECF entry in the operand wording table.
(defun f (n)
  (incf n 2
  (print n))
