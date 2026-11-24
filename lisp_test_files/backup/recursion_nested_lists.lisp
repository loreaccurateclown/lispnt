(defun COUNT-SINGLE-CHILD-NODES (tree)
  (labels ((COUNT-SUBTREE-SINGLE-CHILDREN (subtrees) ;finally got over my aversion to labels. It's just a lambda but it feels *weird*
    (if (null subtrees)
      0
      (+ (COUNT-SINGLE-CHILD-NODES (first subtrees))
      (COUNT-SUBTREE-SINGLE-CHILDREN (rest subtrees)))
      )))
  (if (or (null tree) (atom tree)) ;knowing that (atom tree) is possible makes this so much more comprehensible.
      0
      (+ (if (= (length (rest tree)) 1) 1 0)
         (COUNT-SUBTREE-SINGLE-CHILDREN (rest tree))
         )
      )
  ))


;;[trace] (COUNT-SINGLE-CHILD-NODES '(a (b (c)) (d e)))
