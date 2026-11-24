;;;; Lispnt diagnostic showcase: a ')' with nothing open.
;;;; Expected: one red mark on the last line, code stray-closer.

(defun double (n)
  (* n 2))
)
