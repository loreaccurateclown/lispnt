;;;; Lispnt fixture: nothing but the defun's final closer is missing, so the
;;;; recovered parse is clean and the defun mark is the whole story.
(defun add1 (x)
  (+ x 1)
