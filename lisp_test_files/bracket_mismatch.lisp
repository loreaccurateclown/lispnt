;;;; bracket_mismatch.lisp — what one deleted closer does to the reader.
;;;;
;;;; Every case below is a definition that has already had one `)` deleted; the
;;;; comment says which one. Each is commented out with a leading `;;`, so this
;;;; file parses clean as it stands and you can read it without any marks.
;;;;
;;;; Uncomment exactly one case and open the file: today the reader marks the
;;;; outermost form, `(defun`, and says the file ends one `)` short. The
;;;; "recovered" line beside each case is what analyze finds when the missing
;;;; closer is supplied at the end of the file — that is the material for a
;;;; "Bracket mismatch at line N" hint, and the point of this file is to show
;;;; which cases would supply an arity complaint and which would supply
;;;; something else.
;;;;
;;;; Re-comment the case before moving to the next one.

;;;; CASE A — the deleted closer ended a call, so the call swallows the form
;;;; below it.
;;;; deleted: the final `)` on the line that ends `(+ 1 acc)`.
;;;; recovered: arity, line 5 — COUNT-ZEROS is given 3 arguments; it takes 1 to 2.
;;(defun count-zeros (lst &optional (acc 0))
;;  (if (null lst)
;;      acc
;;      (if (= 0 (car lst))
;;          (count-zeros (cdr lst) (+ 1 acc)
;;          (count-zeros (cdr lst) acc))))

;;;; CASE B — the deleted closer ended an IF, so the form below it becomes a
;;;; fourth part of the IF.
;;;; deleted: the `)` that closes the IF on line 4.
;;;; recovered: operand-count, line 2 — IF takes a test, a then-branch and an
;;;; optional else-branch.
;;(defun classify (x)
;;  (if (> x 0)
;;      1
;;      2
;;  (print x))

;;;; CASE C — the deleted closer ended a SETQ, so the next SETQ becomes one of
;;;; its pairs and the pair count turns odd.
;;;; deleted: the `)` that closes the first SETQ.
;;;; recovered: operand-count, line 2 — SETQ takes pairs of a name and a value.
;;(defun set-both ()
;;  (setq a 1
;;  (setq b 2))

;;;; CASE D — the deleted closer ended the LABELS definitions list, so the
;;;; LABELS body is read as another local definition.
;;;; deleted: the `)` that closes the definitions list after `((double (n) (* 2 n))`.
;;;; recovered: local-definition, line 3 — each local function is a name and an
;;;; argument list.
;;(defun apply-it (x)
;;  (labels ((double (n) (* 2 n))
;;    (double x)))

;;;; CASE E — nothing but the final closer is missing, so the recovered parse is
;;;; clean and the defun mark is the whole story.
;;;; deleted: the `)` that closes the defun.
;;;; recovered: nothing.
;;(defun add1 (x)
;;  (+ x 1)
