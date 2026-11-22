// ANSI Common Lisp names that Lispnt knows about but does not implement.
//
// Calling one of these is Lispnt's gap, not the learner's mistake, so it is
// reported with the internal "unsupported-standard" code and analyze drops it
// instead of showing a diagnostic. Anything NOT in this set that is also not
// defined in the file is a genuine "undefined function".
//
// Names are uppercase because that is how symbols are interned.
export const STANDARD_SYMBOLS: ReadonlySet<string> = new Set([
  // I/O and formatting
  "FORMAT", "PRINT", "PRIN1", "PRINC", "TERPRI", "FRESH-LINE", "WRITE", "WRITE-CHAR",
  "WRITE-LINE", "WRITE-STRING", "WRITE-TO-STRING", "PRINC-TO-STRING", "READ",
  "READ-LINE", "READ-FROM-STRING", "WITH-OUTPUT-TO-STRING", "WITH-OPEN-FILE",
  "OPEN", "CLOSE", "LOAD", "EVAL", "COMPILE", "DESCRIBE", "INSPECT",

  // sequences and higher-order functions
  "MAPCAR", "MAPC", "MAPCAN", "MAPL", "REDUCE", "REMOVE", "REMOVE-IF", "REMOVE-IF-NOT",
  "DELETE", "DELETE-IF", "FIND", "FIND-IF", "FIND-IF-NOT", "POSITION", "COUNT", "SORT",
  "STABLE-SORT", "MERGE", "CONCATENATE", "SUBSEQ", "REPLACE", "FILL", "EVERY", "SOME",
  "NOTANY", "NOTEVERY", "MEMBER", "MEMBER-IF", "ASSOC-IF", "RASSOC", "NTH", "NTHCDR",
  "POSITION-IF", "VECTOR", "MAKE-SEQUENCE", "COERCE", "CONCATENATE",

  // iteration and control macros we do not implement
  "LOOP", "DO", "DO*", "PROG", "PROG*", "TAGBODY", "GO", "BLOCK", "RETURN-FROM",
  "CATCH", "THROW", "UNWIND-PROTECT", "HANDLER-CASE", "HANDLER-BIND", "IGNORE-ERRORS",
  "CASE", "ECASE", "TYPECASE", "ETYPECASE", "COND-IF", "FLET", "LABELS", "MACROLET",
  "SYMBOL-MACROLET", "MULTIPLE-VALUE-BIND", "MULTIPLE-VALUE-CALL", "MULTIPLE-VALUE-PROG1",
  "DESTRUCTURING-BIND", "WITH-SLOTS", "WITH-ACCESSORS", "DEFSTRUCT", "DEFCLASS",
  "DEFMETHOD", "DEFGENERIC", "DEFMACRO", "DEFTYPE", "DEFVAR", "DEFCONSTANT",

  // values, operators, types
  "VALUES", "VALUES-LIST", "FUNCALL", "APPLY", "FUNCTION", "LAMBDA", "EQ", "EQL",
  "EQUALP", "TYPEP", "TYPE-OF", "TYPE-ERROR", "COERCE", "IDENTITY", "CONSTANTLY",

  // numbers
  "ABS", "MIN", "MAX", "GCD", "LCM", "ROUND", "TRUNCATE", "CEILING", "SIGNUM",
  "FLOAT", "RATIONAL", "NUMERATOR", "DENOMINATOR", "1+", "1-", "INCF", "DECF",
  "ASH", "LOG", "EXP", "SIN", "COS", "TAN", "RANDOM", "NUMBERP", "FLOATP",
  "RATIONALP", "PLUSP", "MINUSP", "ODDP", "EVENP", "ZEROP", "ZEROP",

  // strings and characters
  "MAKE-STRING", "STRING", "STRING-UPCASE", "STRING-DOWNCASE", "STRING-CAPITALIZE",
  "STRING=", "STRING<", "STRING>", "STRING-EQUAL", "STRING-TRIM", "STRING-LEFT-TRIM",
  "STRING-RIGHT-TRIM", "CHAR", "SCHAR", "CHAR=", "CHAR<", "CHAR>", "CHAR-UPCASE",
  "CHAR-DOWNCASE", "CHAR-CODE", "CODE-CHAR", "DIGIT-CHAR", "ALPHA-CHAR-P",
  "UPPER-CASE-P", "LOWER-CASE-P", "PARSE-INTEGER", "CHAR-NAME", "NAME-CHAR",

  // symbols, lists, arrays
  "SYMBOL-NAME", "SYMBOL-VALUE", "SYMBOL-FUNCTION", "SYMBOLP", "KEYWORDP", "BOUNDP",
  "FBOUNDP", "MAKE-SYMBOL", "GENSYM", "INTERN", "BUTLAST", "NBUTLAST", "LAST",
  "LDIFF", "TAILP", "LISTP", "CONSP", "ENDP", "COPY-LIST", "COPY-TREE", "ADJOIN",
  "PAIRLIS", "ACONS", "SUBST", "SUBLIS", "TREE-EQUAL", "ARRAY-DIMENSION",
  "ARRAY-DIMENSIONS", "ARRAY-TOTAL-SIZE", "ARRAY-RANK", "ARRAY-IN-BOUNDS-P",
  "MAKE-ARRAY", "VECTOR-PUSH", "VECTOR-PUSH-EXTEND", "VECTOR-POP", "ADJUST-ARRAY",

  // hash tables
  "GETHASH", "SETHASH", "REMHASH", "CLRHASH", "HASH-TABLE-COUNT", "MAKE-HASH-TABLE",
  "MAPHASH", "HASH-TABLE-P", "GETF", "REMF", "SYMBOL-PLIST",

  // misc
  "ERROR", "WARN", "ABORT", "ASSERT", "CHECK-TYPE", "SLEEP", "GC", "SAVE-LISP-AND-DIE",
]);
