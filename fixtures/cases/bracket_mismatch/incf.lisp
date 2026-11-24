;;;; Bracket case: a deleted closer leaves INCF holding three forms.
;;;; Expected: one red mark on the INCF at line 6, message
;;;;   Bracket mismatch at line 6: INCF was given 3 forms; it takes a place
;;;;   and an optional amount. Check the INCF form for a missing closing bracket.
(defun f (n)
  (incf n 2
  (print n))
