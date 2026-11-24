;;;; Pending bracket case: a LET body read as another binding entry.
;;;; Today this falls back to the unclosed form's mark and the count message.
;;;; Recovered read finds: let-binding on the LET.
;;;; Extension needs a let-binding handler.
(defun f (y)
  (let ((y 1)
    (setf y 2)))
