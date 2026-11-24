;;;; Lispnt fixture: one closer deleted, so the LABELS body is read as
;;;; another local definition. The red mark is expected. With the missing
;;;; closer supplied at the end, the recovered parse finds a local-definition
;;;; complaint on line 7: each local function needs a name and an argument list.
(defun apply-it (x)
  (labels ((double (n) (* 2 n))
    (double x)))
