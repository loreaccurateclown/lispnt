;;;; Pending bracket case: a DOLIST spec swallowing a body form.
;;;; Today this falls back to the unclosed form's mark and the count message.
;;;; Recovered read finds: iteration-spec on the DOLIST.
;;;; Extension needs an iteration-spec handler.
(defun f (xs r)
  (dolist (x xs r
    (print x)))
