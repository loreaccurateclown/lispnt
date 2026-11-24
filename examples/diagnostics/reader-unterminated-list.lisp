;;;; Lispnt diagnostic showcase: a list that is never closed.
;;;; Expected: one red mark above, code unterminated-list.

(defun double (n)
  (* n 2)
