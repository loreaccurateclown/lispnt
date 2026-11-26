# Fixtures

Lisp files the project reads but does not ship. `vsce` excludes this whole tree.

- **`cases/`** — what the test suites read. The top level holds the reader and
  evaluation cases; `learner/` holds the three lab files; `bracket_mismatch/`
  holds the deliberate one-closer-missing files, each header naming the mark and
  message it should produce.
- **`constants/`** — `sbcl-constants.lisp`, every public SBCL constant referenced
  once; it compiles clean in SBCL and analyses clean in Lispnt, and is the spec
  for the constants support.
- **`showcase/`** — the folder to open in VS Code with Lispnt running (F5) to see
  every mark in the Problems panel. Each file's header says what to expect, and a
  test locks the codes they produce.
