;;;; Bracket case: a deleted closer leaves the DOLIST spec swallowing a form.
;;;; Expected: one red mark on the DOLIST at line 6, message
;;;;   Bracket mismatch at line 6: the DOLIST spec read a body form as part
;;;;   of it; it takes (variable list [result]). Check the DOLIST form …
(defun f (xs r)
  (dolist (x xs r
    (print x)))
