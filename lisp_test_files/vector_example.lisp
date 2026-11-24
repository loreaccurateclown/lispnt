(defun NEW-STACK (size)
  (vector (make-array size :initial-element nil) -1 size))
;Defines a vector that has an array in index 0, -1 for top index in index 1, and the max size in index 2
(defun IS-EMPTY-P (stk)
  (= (aref stk 1) -1))
;just checks for the index value
;;[trace] (IS-EMPTY-P (NEW-STACK 3))
