;;;; Bracket case: the LET never closes, and its binding list also needs the
;;;; inner brackets around the pair.
;;;; Expected: one red mark on (let at line 7, message
;;;;   LET bindings need a pair of brackets each: write ((x 0)) so X is
;;;;   bound to 0. As written, … The LET also never closes: the file is 1
;;;;   closing parenthesis short.
(let (x 0)
