;;;; Lispnt diagnostic showcase: a dotted pair with too many forms after the dot.
;;;; Expected: two marks on the same line — dotted-tail-extra-form, then a
;;;; stray-closer from the reader recovering. One mistake, and the second mark is
;;;; the recovery rather than a second mistake.

'(1 . 2 3)
