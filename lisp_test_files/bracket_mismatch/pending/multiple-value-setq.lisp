;;;; Pending bracket case: MULTIPLE-VALUE-SETQ holding a fourth form.
;;;; Today this falls back to the unclosed form's mark and the count message.
;;;; Recovered read finds: operand-count on the MULTIPLE-VALUE-SETQ.
;;;; Extension needs a MULTIPLE-VALUE-SETQ entry in the operand wording table.
(defun f (a)
  (multiple-value-setq (a) (values 1)
  (print a))
