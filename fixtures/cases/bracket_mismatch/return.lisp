;;;; Bracket case: a deleted closer leaves RETURN holding two forms.
;;;; Expected: one red mark on the RETURN at line 6, message
;;;;   Bracket mismatch at line 6: RETURN was given 2 forms; it takes at most
;;;;   one value. Check the RETURN form for a missing closing bracket.
(defun f (x)
  (return x
  (print x))
