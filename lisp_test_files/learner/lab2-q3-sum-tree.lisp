(defun SUM-TREE (lst &optional (acc 0)) ;;not initializing acc at 0 really makes the compiler cranky when you + (car lst) to it. Maybe Lisp isn't dynamically typed like I thought?
  (cond                                 ;;the weird thing is, it loads and compiles fine. and this should be linted right? 
    ((null lst) acc)
    ((typep (car lst) 'number) (SUM-TREE (cdr lst) (+ (car lst) acc)))
    ((typep (car lst) 'list) (+ (SUM-TREE (car lst) acc) (SUM-TREE (cdr lst)))) ;;that's a load-bearing acc on the first SUM-TREE call. This setup is how you keep the rest of the list when moving into nested lists.
    (t acc) ;;unnecessary but I'm sentimental
    )
  )
;;[trace] (SUM-TREE '(1 (2 3) 4))
