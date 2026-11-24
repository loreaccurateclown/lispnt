(defun count-zeros (lst &optional (acc 0)) 
  (if (null lst)
      acc
      (if (= 0 (car lst))
          (count-zeros (cdr lst) (+ 1 acc)) ;;I kept trying to do a progn with (+ 1 acc) and then just calling (count-zeros (cdr lst) acc), but that wasn't working. Then I realized that lisp just wants more brackets. It needs them.
            (count-zeros (cdr lst) acc)
          )
      )
  )
;;[trace] (COUNT-ZEROS '(0 1 0 0))
