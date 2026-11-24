;;;; Lispnt fixture: one closer deleted, so the LABELS body is read as another
;;;; local definition. Expected mark: the entry on line 7, message "Bracket
;;;; mismatch at line 7: a LABELS entry has no argument list; each local
;;;; function needs a name and an argument list."
(defun apply-it (x)
  (labels ((double (n) (* 2 n))
    (double x)))
