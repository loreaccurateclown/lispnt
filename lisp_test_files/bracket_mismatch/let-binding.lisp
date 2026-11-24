;;;; Bracket case: a deleted closer leaves a LET body read as a binding.
;;;; Expected: one red mark on the LET at line 6, message
;;;;   Bracket mismatch at line 6: the LET binding list read a body form as a
;;;;   binding; each binding is a name or a (name value) pair. Check the LET form …
(defun f (y)
  (let ((y 1)
    (setf y 2)))
