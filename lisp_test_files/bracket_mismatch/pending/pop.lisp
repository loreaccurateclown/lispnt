;;;; Pending bracket case: POP holding two forms.
;;;; Today this falls back to the unclosed form's mark and the count message.
;;;; Recovered read finds: operand-count on the POP.
;;;; Extension needs a POP entry in the operand wording table.
(defun f (stack)
  (pop stack
  (print stack))
