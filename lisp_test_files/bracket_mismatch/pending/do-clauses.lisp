;;;; Pending bracket case: a DO bindings list reading the end clause and body as bindings.
;;;; Today this falls back to the unclosed form's mark and the count message.
;;;; Recovered read finds: do-binding and do-end-test on the DO.
;;;; Extension needs handlers for both, plus a precedence rule for two complaints.
(defun f ()
  (do ((i 0)
      ((> i 2) i)
    (print i)))
