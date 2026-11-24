;;;; Lispnt fixture: one closer deleted, so a call swallows the form below it.
;;;; Expected mark: the COUNT-ZEROS call on line 9, message "Bracket mismatch at
;;;; line 9: COUNT-ZEROS was given 3 arguments; it takes 1 to 2. Check the
;;;; COUNT-ZEROS form for a missing closing bracket."
(defun count-zeros (lst &optional (acc 0))
  (if (null lst)
      acc
      (if (= 0 (car lst))
          (count-zeros (cdr lst) (+ 1 acc)
          (count-zeros (cdr lst) acc))))
