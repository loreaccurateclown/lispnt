;;;; Lispnt diagnostic showcase: a ;;[trace] marker with no call after it.
;;;; Expected: one yellow warning, code trace-marker.
;;;; The marker names the call to follow; on its own it does nothing, which is
;;;; why the editor underlines it and the hover says so.

(defun double (n) (* n 2))

;;[trace]
