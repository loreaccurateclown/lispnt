;;;; Pending bracket case: PUSH holding three forms.
;;;; Today this falls back to the unclosed form's mark and the count message.
;;;; Recovered read finds: operand-count on the PUSH.
;;;; Extension needs a PUSH entry in the operand wording table.
(defun f (stack)
  (push 1 stack
  (print stack))
