(defun PAIRWISE-PRODUCT (lstA lstB)
  (if (or (null lstA) (null lstB))
    nil
    (cons (* (first lstA) (first lstB)) (pairwise-product (cdr lstA) (cdr lstB))))  
  ;;; PUT IT INSIDE THE CONS HOMIE. I N S I D E 
  )