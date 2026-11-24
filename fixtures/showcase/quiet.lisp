;;;; Lispnt diagnostic showcase: things it knows it does not implement.
;;;; Expected: no marks at all.
;;;; A standard Common Lisp form Lispnt has not built is Lispnt's gap, not the
;;;; learner's mistake, so it stays silent. LOAD is deliberately out of scope;
;;;; HANDLER-CASE, MAPCAR and PRINT likewise have not been built. The last line
;;;; is a keyword argument Lispnt does not model — real CL, so no report.

(load "other-file.lisp")

(handler-case (error "x") (error (c) c))

(mapcar #'car '((1) (2)))

(print 1)

(make-array 3 :element-type 'fixnum)
