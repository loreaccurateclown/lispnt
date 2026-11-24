;;;; Lispnt diagnostic showcase: the shape of a definition.
;;;; Expected: six red marks, in file order —
;;;;   defun-name, defun-arglist, lambda-arglist,
;;;;   local-definitions, local-definition, let-bindings
;;;; plus one yellow warning for X in the last form: the broken binding list is
;;;; skipped, so the body's X looks like a name from outside the file.

(defun 5 (x) x)

(defun f)

(lambda 1 2)

(labels 1 2)

(labels (1) 2)

(let 5 x)
