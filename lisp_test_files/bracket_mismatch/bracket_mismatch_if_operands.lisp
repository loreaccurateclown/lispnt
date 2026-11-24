;;;; Lispnt fixture: one closer deleted, so the form below becomes a fourth
;;;; part of the IF. The red mark is expected. With the missing closer
;;;; supplied at the end, the recovered parse finds an operand-count
;;;; complaint on line 6: IF takes a test, a then-branch and an optional else.
(defun classify (x)
  (if (> x 0)
      1
      2
  (print x))
