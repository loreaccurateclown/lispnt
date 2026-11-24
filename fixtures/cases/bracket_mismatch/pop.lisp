;;;; Bracket case: a deleted closer leaves POP holding two forms.
;;;; Expected: one red mark on the POP at line 6, message
;;;;   Bracket mismatch at line 6: POP was given 2 forms; it takes a place.
;;;;   Check the POP form for a missing closing bracket.
(defun f (stack)
  (pop stack
  (print stack))
