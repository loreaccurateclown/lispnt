;;;; Lispnt diagnostic showcase: names.
;;;; Expected: two yellow warnings and one red.
;;;;   unbound-variable  (warning) — MISSING-NAME has no value in this file
;;;;   undefined-function (warning) — NOT-DEFINED-ANYWHERE is not defined
;;;;   variable-as-function (error) — F is a parameter, so it cannot be called
;;;; Yellow means "this may come from another file"; Lispnt reads one file at a
;;;; time, so the mark stays. A top-level (load ...) would silence the
;;;; undefined-function warning; red means "this fails when it runs".

(defun greet (name)
  (format nil "Hello, ~a" name))

(defun bad-body ()
  (greet missing-name))

(defun call-missing ()
  (not-defined-anywhere))

(defun call-the-variable (f)
  (f 1))
