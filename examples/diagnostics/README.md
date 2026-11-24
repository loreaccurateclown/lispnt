# Diagnostic showcase

Open this folder in VS Code with Lispnt running (F5 from the repository root
starts an Extension Development Host) and each file puts marks in the Problems
panel. Each file's header comment says what to expect.

- **Red** means the mistake fails when the code reaches it.
- **Yellow** means the name may come from another file, so load that first.
- **Nothing** is a result too: a standard Common Lisp form Lispnt has not built
  is Lispnt's gap, and blaming the learner for it would be a lie. `quiet.lisp`
  is the file that demonstrates that.

One reader mistake currently produces no mark at all: an unclosed `#|` block
comment throws out of the reader instead of being reported, so there is no file
for it here until that is fixed.

The files are outside `lisp_test_files/` and the CPS305 corpus on purpose, so
they do not change the corpus diagnostics count.
