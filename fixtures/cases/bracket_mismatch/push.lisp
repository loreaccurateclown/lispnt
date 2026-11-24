;;;; Bracket case: a deleted closer leaves PUSH holding three forms.
;;;; Expected: one red mark on the PUSH at line 6, message
;;;;   Bracket mismatch at line 6: PUSH was given 3 forms; it takes a value
;;;;   and a place. Check the PUSH form for a missing closing bracket.
(defun f (stack)
  (push 1 stack
  (print stack))
