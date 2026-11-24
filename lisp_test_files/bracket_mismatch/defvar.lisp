;;;; Bracket case: a top-level DEFVAR swallows the next definition.
;;;; Expected: one red mark on the DEFVAR at line 5, message
;;;;   Bracket mismatch at line 5: DEFVAR was given 4 forms; it takes a name
;;;;   with an optional initial value and description. Check the DEFVAR form …
(defvar *x* 1 "doc"
(defvar *y* 2)
