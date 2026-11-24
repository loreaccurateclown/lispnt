;;;; Bracket case: a deleted closer leaves the DOTIMES spec swallowing a form.
;;;; Expected: one red mark on the DOTIMES at line 6, message
;;;;   Bracket mismatch at line 6: the DOTIMES spec read a body form as part
;;;;   of it; it takes (variable count [result]). Check the DOTIMES form …
(defun f ()
  (dotimes (i 3 r
    (print i)))
