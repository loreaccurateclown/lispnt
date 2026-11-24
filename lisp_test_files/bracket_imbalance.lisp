;;;; bracket_imbalance.lisp — a manual test bed for bracket mistakes.
;;;;
;;;; Open this folder in VS Code with Lispnt running (F5 from the repository
;;;; root starts an Extension Development Host), then open this file.
;;;;
;;;; The reader stops at the first problem it meets, so only one reader case
;;;; can be visible at a time. Every reader case below is commented out with a
;;;; leading `;;`: uncomment exactly one, save, and look at where the squiggle
;;;; lands and what the hover says. Re-comment it before trying the next, and
;;;; note that an uncommented case swallows the live marks further down.
;;;;
;;;; The balanced cases at the end are live, so their marks appear as soon as
;;;; the file is opened.
;;;;
;;;; The "expect" lines describe what Lispnt does today — the starting point,
;;;; not the target. Positions are relative to the snippet, not to this file.
;;;; They are here so that a change of behaviour is visible.

;;;; CASE 1 — a closer with nothing left open.
;;;; expect: stray-closer on the `)` that closes nothing (line 1).
;;(defun stray (x) (+ x 1)))

;;;; CASE 2 — one list never closed.
;;;; expect: unterminated-list on the `(` of the defun (line 1).
;;(defun once (x)
;;  (+ x 1)

;;;; CASE 3 — three lists never closed.
;;;; expect: unterminated-list on the `(` before `g` (line 3) — the innermost
;;;; of the three. The defun and the let that contain it are also unclosed and
;;;; are not mentioned.
;;(defun nested (x)
;;  (let ((y 1))
;;    (+ x (g y)

;;;; CASE 4 — a string runs to the end of the file.
;;;; expect: unterminated-string on the opening quote (line 1).
;;(print "no closing quote)

;;;; CASE 5 — a block comment runs to the end of the file.
;;;; expect: unterminated-block-comment on `#|` (line 1).
;;#| a comment that forgets to close
;;(defun after-comment (x) x)

;;;; CASE 6 — case 3 with the innermost form closed.
;;;; expect: unterminated-list on the `(` of the let (line 2): supplying the
;;;; closer for `(g y)` moves the mark out to the next open list.
;;(defun outward (x)
;;  (let ((y 1))
;;    (+ x (g y))

;;;; ------------------------------------------------------------------
;;;; Balanced but wrongly grouped: the bracket count is right, the shape
;;;; is not. These are live. Lispnt reports the whole form today, with
;;;; "This form is missing part of its syntax."
;;;; ------------------------------------------------------------------

;;;; Meant to be: (let ((x 0)) ...) — X starting at 0.
(let (x 0))

;;;; Meant to be the same with a body: the trailing X is a body form, and the
;;;; mistake is still in the binding list.
(let (x 0) x)

;;;; For contrast: these two are correct and must stay silent.
(let ((x 0)))

(let (x) 0)
