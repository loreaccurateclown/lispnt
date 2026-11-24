;;;; Pending bracket case: a DOTIMES spec swallowing a body form.
;;;; Today this falls back to the unclosed form's mark and the count message.
;;;; Recovered read finds: iteration-spec on the DOTIMES.
;;;; Extension needs an iteration-spec handler.
(defun f ()
  (dotimes (i 3 r
    (print i)))
