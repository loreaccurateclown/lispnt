;;;; reader_smoke.lisp
;;;; Smoke test for the Lispnt reader. Every construct below is supported:
;;;; symbols, numbers, strings with escapes, line comments, nested block
;;;; comments, and quote shorthand.

#| Block comments nest, per the Common Lisp standard:
#| this inner block must not end the outer one |#
and the outer comment ends at the marker after this line. |#

(defun greet (name)
  "Return a friendly greeting. Docstrings are ordinary strings."
  (format t "hello, ~a~%" name))

(defvar *answer* 42 "The answer to everything.")

(defun describe-point (x y)
  "Signed decimals are numbers; escaped quotes and backslashes decode."
  (list x
        y
        -3.5
        "a quoted word: \"yes\""
        "a windows path: C:\\temp"
        #(4 5 6)))

(setf *primes* '(2 3 5 7))
(setf *symbol-quoted* 'alpha)

(defun pair-sum (pairs)
  "Recursion over a quoted list of pairs."
  (if (null pairs)
      0
      (+ (first (first pairs))
         (second (first pairs))
         (pair-sum (rest pairs)))))

;;[trace] (PAIR-SUM '((1 2) (3 4)))
