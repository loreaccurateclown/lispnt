;;;; Lispnt fixture: one closer deleted, so the form below becomes a fourth
;;;; part of the IF. Expected mark: the IF on line 6, message "Bracket
;;;; mismatch at line 6: IF was given 4 forms; it takes 2 or 3: a test-form, a
;;;; then-form and an optional else-form. Check the IF form for a missing bracket."
(defun classify (x)
  (if (> x 0)
      1
      2
  (print x))
