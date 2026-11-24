;;;; Bracket case: a deleted closer leaves MULTIPLE-VALUE-SETQ holding four.
;;;; Expected: one red mark on the MULTIPLE-VALUE-SETQ at line 6, message
;;;;   Bracket mismatch at line 6: MULTIPLE-VALUE-SETQ was given 3 forms; it
;;;;   takes a list of names and one form. Check the MULTIPLE-VALUE-SETQ form …
(defun f (a)
  (multiple-value-setq (a) (values 1)
  (print a))
