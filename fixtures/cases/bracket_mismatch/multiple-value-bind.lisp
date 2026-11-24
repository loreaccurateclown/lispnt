;;;; Bracket case: a deleted closer leaves MULTIPLE-VALUE-BIND with only names.
;;;; Expected: one red mark on the MULTIPLE-VALUE-BIND at line 6, message
;;;;   Bracket mismatch at line 6: MULTIPLE-VALUE-BIND was given 1 form; it
;;;;   takes a list of names and the form that produces the values. Check …
(defun f ()
  (multiple-value-bind (a
    (values 1) a))
