import { cons, intern, NIL, numberValue, type LispValue } from "./values";

// The constants SBCL 2.6.8 exposes beyond keywords: the 62 ANSI CL constants
// (T and NIL are already literal atoms in createEnv) and the 9 SB-EXT ones.
// Values were read from the running image with (symbol-value ...), not typed by
// hand; fixtures/constants/sbcl-constants.lisp lists every name and compiles
// clean in SBCL, and test/constants.test.ts evaluates them here.
//
// Two divergences come from the value model: JavaScript numbers are doubles, so
// most-positive-fixnum, most-negative-fixnum and most-positive-word are
// approximate above 2^53, and there is one float type, so the short/single float
// constants carry their double value.

function list(...items: LispValue[]): LispValue {
  return items.reduceRight<LispValue>((cdr, car) => cons(car, cdr), NIL);
}

export const CONSTANTS: ReadonlyMap<string, LispValue> = new Map<
  string,
  LispValue
>([
  ["ARRAY-DIMENSION-LIMIT", numberValue(35184372088832)],
  ["ARRAY-RANK-LIMIT", numberValue(129)],
  ["ARRAY-TOTAL-SIZE-LIMIT", numberValue(35184372088832)],
  ["BOOLE-1", numberValue(2)],
  ["BOOLE-2", numberValue(3)],
  ["BOOLE-AND", numberValue(6)],
  ["BOOLE-ANDC1", numberValue(12)],
  ["BOOLE-ANDC2", numberValue(13)],
  ["BOOLE-C1", numberValue(4)],
  ["BOOLE-C2", numberValue(5)],
  ["BOOLE-CLR", numberValue(0)],
  ["BOOLE-EQV", numberValue(9)],
  ["BOOLE-IOR", numberValue(7)],
  ["BOOLE-NAND", numberValue(10)],
  ["BOOLE-NOR", numberValue(11)],
  ["BOOLE-ORC1", numberValue(14)],
  ["BOOLE-ORC2", numberValue(15)],
  ["BOOLE-SET", numberValue(1)],
  ["BOOLE-XOR", numberValue(8)],
  ["CALL-ARGUMENTS-LIMIT", numberValue(1073741824)],
  ["CHAR-CODE-LIMIT", numberValue(1114112)],
  ["INTERNAL-TIME-UNITS-PER-SECOND", numberValue(1000000)],
  ["LAMBDA-LIST-KEYWORDS", list(intern("&ALLOW-OTHER-KEYS"), intern("&AUX"), intern("&BODY"), intern("&ENVIRONMENT"), intern("&KEY"), intern("SB-INT:&MORE"), intern("&OPTIONAL"), intern("&REST"), intern("&WHOLE"))],
  ["LAMBDA-PARAMETERS-LIMIT", numberValue(1073741824)],
  ["MULTIPLE-VALUES-LIMIT", numberValue(1073741824)],
  ["MOST-POSITIVE-FIXNUM", numberValue(4611686018427387903)],
  ["MOST-NEGATIVE-FIXNUM", numberValue(-4611686018427387904)],
  ["DOUBLE-FLOAT-EPSILON", numberValue(1.11022302462515680e-16, true)],
  ["DOUBLE-FLOAT-NEGATIVE-EPSILON", numberValue(5.55111512312578400e-17, true)],
  ["LONG-FLOAT-EPSILON", numberValue(1.11022302462515680e-16, true)],
  ["LONG-FLOAT-NEGATIVE-EPSILON", numberValue(5.55111512312578400e-17, true)],
  ["SHORT-FLOAT-EPSILON", numberValue(5.96046500000000000e-8, true)],
  ["SHORT-FLOAT-NEGATIVE-EPSILON", numberValue(2.98023260000000000e-8, true)],
  ["SINGLE-FLOAT-EPSILON", numberValue(5.96046500000000000e-8, true)],
  ["SINGLE-FLOAT-NEGATIVE-EPSILON", numberValue(2.98023260000000000e-8, true)],
  ["LEAST-NEGATIVE-DOUBLE-FLOAT", numberValue(-4.94065645841246540e-324, true)],
  ["LEAST-NEGATIVE-LONG-FLOAT", numberValue(-4.94065645841246540e-324, true)],
  ["LEAST-NEGATIVE-NORMALIZED-DOUBLE-FLOAT", numberValue(-2.22507385850720140e-308, true)],
  ["LEAST-NEGATIVE-NORMALIZED-LONG-FLOAT", numberValue(-2.22507385850720140e-308, true)],
  ["LEAST-NEGATIVE-NORMALIZED-SHORT-FLOAT", numberValue(-1.17549440000000000e-38, true)],
  ["LEAST-NEGATIVE-NORMALIZED-SINGLE-FLOAT", numberValue(-1.17549440000000000e-38, true)],
  ["LEAST-NEGATIVE-SHORT-FLOAT", numberValue(-1.40129850000000000e-45, true)],
  ["LEAST-NEGATIVE-SINGLE-FLOAT", numberValue(-1.40129850000000000e-45, true)],
  ["LEAST-POSITIVE-DOUBLE-FLOAT", numberValue(4.94065645841246540e-324, true)],
  ["LEAST-POSITIVE-LONG-FLOAT", numberValue(4.94065645841246540e-324, true)],
  ["LEAST-POSITIVE-NORMALIZED-DOUBLE-FLOAT", numberValue(2.22507385850720140e-308, true)],
  ["LEAST-POSITIVE-NORMALIZED-LONG-FLOAT", numberValue(2.22507385850720140e-308, true)],
  ["LEAST-POSITIVE-NORMALIZED-SHORT-FLOAT", numberValue(1.17549440000000000e-38, true)],
  ["LEAST-POSITIVE-NORMALIZED-SINGLE-FLOAT", numberValue(1.17549440000000000e-38, true)],
  ["LEAST-POSITIVE-SHORT-FLOAT", numberValue(1.40129850000000000e-45, true)],
  ["LEAST-POSITIVE-SINGLE-FLOAT", numberValue(1.40129850000000000e-45, true)],
  ["MOST-POSITIVE-DOUBLE-FLOAT", numberValue(1.79769313486231570e+308, true)],
  ["MOST-POSITIVE-LONG-FLOAT", numberValue(1.79769313486231570e+308, true)],
  ["MOST-POSITIVE-SHORT-FLOAT", numberValue(3.40282350000000000e+38, true)],
  ["MOST-POSITIVE-SINGLE-FLOAT", numberValue(3.40282350000000000e+38, true)],
  ["MOST-NEGATIVE-DOUBLE-FLOAT", numberValue(-1.79769313486231570e+308, true)],
  ["MOST-NEGATIVE-LONG-FLOAT", numberValue(-1.79769313486231570e+308, true)],
  ["MOST-NEGATIVE-SHORT-FLOAT", numberValue(-3.40282350000000000e+38, true)],
  ["MOST-NEGATIVE-SINGLE-FLOAT", numberValue(-3.40282350000000000e+38, true)],
  ["PI", numberValue(3.14159265358979300e+0, true)],
  ["SB-EXT:DOUBLE-FLOAT-POSITIVE-INFINITY", numberValue(Infinity, true)],
  ["SB-EXT:DOUBLE-FLOAT-NEGATIVE-INFINITY", numberValue(-Infinity, true)],
  ["SB-EXT:LONG-FLOAT-POSITIVE-INFINITY", numberValue(Infinity, true)],
  ["SB-EXT:LONG-FLOAT-NEGATIVE-INFINITY", numberValue(-Infinity, true)],
  ["SB-EXT:SHORT-FLOAT-POSITIVE-INFINITY", numberValue(Infinity, true)],
  ["SB-EXT:SHORT-FLOAT-NEGATIVE-INFINITY", numberValue(-Infinity, true)],
  ["SB-EXT:SINGLE-FLOAT-POSITIVE-INFINITY", numberValue(Infinity, true)],
  ["SB-EXT:SINGLE-FLOAT-NEGATIVE-INFINITY", numberValue(-Infinity, true)],
  ["SB-EXT:MOST-POSITIVE-WORD", numberValue(18446744073709551615)],
]);
