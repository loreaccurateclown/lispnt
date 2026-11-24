;;;; Lispnt fixture: one closer deleted, so the next SETQ becomes a pair in
;;;; the first one and the pair count turns odd. The red mark is expected.
;;;; With the missing closer supplied at the end, the recovered parse finds
;;;; an operand-count complaint on line 6: SETQ takes pairs of name and value.
(defun set-both ()
  (setq a 1
  (setq b 2))
