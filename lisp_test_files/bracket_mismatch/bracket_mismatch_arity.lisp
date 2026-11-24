;;;; Lispnt fixture: one closer deleted, so a call swallows the form below it.
;;;; The red mark is expected: the reader cannot close the defun, so it
;;;; reports the outermost form and the file ends one ) short. With the
;;;; missing closer supplied at the end, the recovered parse finds an arity
;;;; complaint on line 10: COUNT-ZEROS is given 3 arguments, it takes 1 to 2.
(defun count-zeros (lst &optional (acc 0))
  (if (null lst)
      acc
      (if (= 0 (car lst))
          (count-zeros (cdr lst) (+ 1 acc)
          (count-zeros (cdr lst) acc))))
