;;;; Lispnt diagnostic showcase: a LET binding list missing its inner brackets.
;;;; Expected: one red mark over the whole form, code let-binding, saying that
;;;; ((x 0)) was meant and why the form as written cannot run.

(let (x 0))
