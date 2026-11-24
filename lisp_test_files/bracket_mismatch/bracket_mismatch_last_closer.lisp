;;;; Lispnt fixture: nothing but the defun's final closer is missing, so the
;;;; recovered read is clean. Expected mark: the defun on line 5, message
;;;; "This form never closes, so the file ends 1 `)` short. Add `)` after the
;;;; last line."
(defun add1 (x)
  (+ x 1)
