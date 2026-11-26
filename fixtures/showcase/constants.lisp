;;;; Lispnt diagnostic showcase: constants.
;;;; Expected: no marks. Hover a constant to see its value; end-of-line hints
;;;; show the bound values once switched on from the trace view.

(defparameter *radius* 2)
(defparameter *area* (* pi *radius* *radius*))
(defparameter *xor-mask* boole-xor)
(defparameter *char-ceiling* char-code-limit)
(defparameter *fixnum-ceiling* most-positive-fixnum)
(defparameter *infinity* sb-ext:double-float-positive-infinity)

(defun circumference (r)
  (* 2 pi r))
