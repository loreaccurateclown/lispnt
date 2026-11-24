;;;; Bracket case: a top-level DEFPARAMETER swallows the next definition.
;;;; Expected: one red mark on the DEFPARAMETER at line 5, message
;;;;   Bracket mismatch at line 5: DEFPARAMETER was given 4 forms; it takes a
;;;;   name, an initial value and an optional description. Check the form …
(defparameter *x* 1 "doc"
(defparameter *y* 2)
