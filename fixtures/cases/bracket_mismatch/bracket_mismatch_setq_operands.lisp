;;;; Lispnt fixture: one closer deleted, so the next SETQ becomes a pair
;;;; inside the first. Expected mark: the SETQ on line 6, message "Bracket
;;;; mismatch at line 6: SETQ was given 3 forms; it takes pairs: a variable
;;;; that is set and a form representing the value to be set."
(defun set-both ()
  (setq a 1
  (setq b 2))
