;;;; Bracket case: a deleted closer leaves SETF holding a third form.
;;;; Expected: one red mark on the SETF at line 6, message
;;;;   Bracket mismatch at line 6: SETF was given 3 forms; it takes pairs: a
;;;;   place and a form. Check the SETF form for a missing closing bracket.
(defun f (x)
  (setf (car x) 1
  (print x))
