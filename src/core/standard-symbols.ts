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
  "PRINT", "TERPRI", "FRESH-LINE", "WRITE",
  "WRITE-LINE", "WRITE-TO-STRING", "READ",
  "READ-LINE", "READ-FROM-STRING", "WITH-INPUT-FROM-STRING",
  "WITH-OPEN-FILE", "WITH-OPEN-STREAM",
  "OPEN", "CLOSE", "LOAD", "EVAL", "COMPILE", "DESCRIBE", "INSPECT",

  // sequences and higher-order functions
  "MAPCAR", "MAPC", "MAPCAN", "MAPL", "REDUCE", "REMOVE", "REMOVE-IF", "REMOVE-IF-NOT",
  "DELETE", "DELETE-IF", "FIND", "FIND-IF", "FIND-IF-NOT", "POSITION",
  "STABLE-SORT", "MERGE", "CONCATENATE", "SUBSEQ", "REPLACE", "FILL", "EVERY", "SOME",
  "NOTANY", "NOTEVERY", "MEMBER", "MEMBER-IF", "ASSOC-IF", "RASSOC", "NTH", "NTHCDR",
  "POSITION-IF", "MAKE-SEQUENCE", "COERCE", "CONCATENATE",

  // iteration and control macros we do not implement
  "PROG", "PROG*", "TAGBODY", "GO", "BLOCK", "RETURN-FROM",
  "CATCH", "THROW", "UNWIND-PROTECT", "HANDLER-CASE", "HANDLER-BIND", "IGNORE-ERRORS",
  "TYPECASE", "ETYPECASE", "COND-IF", "MACROLET",
  "SYMBOL-MACROLET", "MULTIPLE-VALUE-CALL", "MULTIPLE-VALUE-PROG1",
  "DESTRUCTURING-BIND", "WITH-SLOTS", "WITH-ACCESSORS", "DEFCLASS",
  "DEFMETHOD", "DEFGENERIC", "DEFMACRO", "DEFTYPE", "DEFCONSTANT",

  // values, operators, types
  "VALUES-LIST", "TYPE-OF", "TYPE-ERROR", "COERCE", "IDENTITY", "CONSTANTLY",

  // numbers
  "ABS", "GCD", "LCM", "ROUND", "TRUNCATE", "CEILING", "SIGNUM",
  "FLOAT", "RATIONAL", "NUMERATOR", "DENOMINATOR",
  "ASH", "LOG", "EXP", "SIN", "COS", "TAN", "RANDOM", "FLOATP",
  "RATIONALP", "PLUSP", "MINUSP",

  // strings and characters
  "STRING", "STRING-UPCASE", "STRING-DOWNCASE", "STRING-CAPITALIZE",
  "STRING=", "STRING>", "STRING-EQUAL", "STRING-TRIM", "STRING-LEFT-TRIM",
  "STRING-RIGHT-TRIM",
  "CHAR-DOWNCASE", "CHAR-CODE", "CODE-CHAR", "DIGIT-CHAR", "ALPHA-CHAR-P",
  "UPPER-CASE-P", "LOWER-CASE-P", "PARSE-INTEGER", "CHAR-NAME", "NAME-CHAR",

  // symbols, lists, arrays
  "SYMBOL-NAME", "SYMBOL-VALUE", "SYMBOL-FUNCTION", "SYMBOLP", "KEYWORDP", "BOUNDP",
  "FBOUNDP", "MAKE-SYMBOL", "GENSYM", "INTERN", "NBUTLAST", "LAST",
  "LDIFF", "TAILP", "LISTP", "CONSP", "ENDP", "COPY-LIST", "COPY-TREE", "ADJOIN",
  "PAIRLIS", "ACONS", "SUBST", "SUBLIS", "TREE-EQUAL", "ARRAY-DIMENSION",
  "ARRAY-DIMENSIONS", "ARRAY-TOTAL-SIZE", "ARRAY-RANK", "ARRAY-IN-BOUNDS-P",
  "VECTOR-POP", "ADJUST-ARRAY",

  // hash tables
  "SETHASH",
  "REMF", "SYMBOL-PLIST",

  // misc
  "WARN", "ABORT", "ASSERT", "CHECK-TYPE", "SLEEP", "GC", "SAVE-LISP-AND-DIE",

  // Names a sweep found missing: calling one of these was reported as an
  // undefined function, which blames the learner for Lispnt's gap. The sweep
  // called every name below with no arguments and took the ones that answered
  // "undefined function" instead of "unsupported standard".
  "CHARACTERP", "CHAR-INT", "DIGIT-CHAR-P", "ALPHANUMERICP", "BOTH-CASE-P",
  "GRAPHIC-CHAR-P", "STANDARD-CHAR-P", "CHAR<=", "CHAR>=", "CHAR-NOT-EQUAL",
  "CHAR-NOT-LESSP", "CHAR-NOT-GREATERP", "STRING/=", "STRING<=", "STRING>=",
  "STRING-NOT-EQUAL", "STRING-LESSP", "STRING-GREATERP",
  "LIST*", "MAKE-LIST", "NCONC", "REVAPPEND", "RASSOC-IF", "UNION", "INTERSECTION",
  "SET-DIFFERENCE", "SET-EXCLUSIVE-OR", "SUBSETP", "MAP", "MAPCON", "MAP-INTO",
  "DELETE-IF-NOT", "REMOVE-DUPLICATES", "DELETE-DUPLICATES", "COUNT-IF",
  "SEARCH", "MISMATCH", "SVREF", "VECTORP", "ARRAY", "ARRAYP", "FILL-POINTER",
  "GENTEMP", "COPY-SYMBOL", "FMAKUNBOUND", "MAKUNBOUND", "REMPROP", "GET",
  "SXHASH", "ONEP", "ISQRT", "REM", "RANDOM-STATE", "COMPLEXP", "FUNCTIONP",
  "COMPILED-FUNCTION-P", "MACROEXPAND", "MACROEXPAND-1", "HASH-TABLE-SIZE",
]);






