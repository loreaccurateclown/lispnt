;;;; Bracket case: a deleted closer leaves DO reading its bindings wrongly.
;;;; Expected: one red mark on the DO at line 6, message
;;;;   Bracket mismatch at line 6: the DO binding list read the form below it
;;;;   as a binding; each DO binding is a name or (name init step). Check …
(defun f ()
  (do ((i 0)
      ((> i 2) i)
    (print i)))
