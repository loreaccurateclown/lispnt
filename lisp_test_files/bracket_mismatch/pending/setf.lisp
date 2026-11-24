;;;; Pending bracket case: SETF holding a third form.
;;;; Today this falls back to the unclosed form's mark and the count message.
;;;; Recovered read finds: operand-count on the SETF.
;;;; Extension needs a SETF entry in the operand wording table.
(defun f (x)
  (setf (car x) 1
  (print x))
