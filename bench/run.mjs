// A measurement pass, not a test: it answers "how long does Lispnt take on real
// files?" with numbers instead of an impression. Run it with `npm run bench`.
//
// The corpus walk is the same one the roadmap's counts use: the files under
// fixtures/cases/ plus, if LISP_CORPUS names a folder, that folder too, with
// backup/ skipped and only *.lisp/*.lsp read. Set LISP_CORPUS to your own lab
// files to measure against code you care about; nothing here is packaged.
//
//   PowerShell:  $env:LISP_CORPUS = "C:\path\to\your\lisp"; npm run bench
//   bash:        LISP_CORPUS=/path/to/your/lisp npm run bench
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { analyze } from "../dist/src/core/analyze.js";
import { createReader } from "../dist/src/core/reader.js";
import { collectHints } from "../dist/src/core/hints.js";
import { traceCases, traceExpressions } from "../dist/src/core/trace-cases.js";

const extraCorpus = process.env.LISP_CORPUS;
if (extraCorpus !== undefined && !existsSync(extraCorpus)) {
  console.log(`LISP_CORPUS is set but not found: ${extraCorpus} — measuring fixtures/cases only.`);
}
const ROOTS = [
  ...new Set(
    ["fixtures/cases", ...(extraCorpus !== undefined && existsSync(extraCorpus) ? [extraCorpus] : [])].map(
      (root) => resolve(root),
    ),
  ),
];
const RUNS = 5;

function walk(directory, into) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.toLowerCase() !== "backup") walk(path, into);
    } else if (/\.lisp$/i.test(entry.name)) {
      into.push(path);
    }
  }
}

// The fastest of several runs: an outlier from GC or antivirus only ever makes a
// run slower, so the minimum is the closest estimate of the work itself.
function fastest(run) {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    run();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

function parseOnly(source) {
  const reader = createReader(source);
  for (;;) {
    if (reader.next().kind === "end") return;
  }
}

function row(name, bytes, parse, analyse, hints, trace) {
  const kb = bytes / 1024;
  return [
    name.padEnd(38).slice(0, 38),
    `${kb.toFixed(1)} KB`.padStart(9),
    `${parse.toFixed(2)} ms`.padStart(10),
    `${analyse.toFixed(2)} ms`.padStart(10),
    `${hints.toFixed(2)} ms`.padStart(10),
    `${trace.toFixed(2)} ms`.padStart(10),
  ].join(" ");
}

const files = [];
for (const root of ROOTS) {
  try {
    walk(root, files);
  } catch {
    process.stderr.write(`skipping ${root}: not readable\n`);
  }
}

function header() {
  return ["file".padEnd(38), "size".padStart(9), "parse".padStart(10), "analyze".padStart(10), "hints".padStart(10), "trace".padStart(10)].join(" ");
}

console.log(header());

const totals = { bytes: 0, parse: 0, analyse: 0, hints: 0, trace: 0 };
for (const path of files) {
  const source = readFileSync(path, "utf8");
  const bytes = statSync(path).size;
  const parse = fastest(() => parseOnly(source));
  const analyse = fastest(() => analyze(source));
  const hints = fastest(() => {
    const run = collectHints(source, { calls: traceExpressions(source) });
    // Ask for every line the file has: the provider does this per viewport, and
    // walking a fixed 100 000 lines would measure the walk instead.
    const lineCount = source.split("\n").length;
    run.hintsInLines(1, lineCount);
  });
  const trace = fastest(() => traceCases(source));
  totals.bytes += bytes;
  totals.parse += parse;
  totals.analyse += analyse;
  totals.hints += hints;
  totals.trace += trace;
  console.log(row(relative(process.cwd(), path), bytes, parse, analyse, hints, trace));
}

console.log(
  row(
    `${files.length} files, total`,
    totals.bytes,
    totals.parse,
    totals.analyse,
    totals.hints,
    totals.trace,
  ),
);

// Size scaling, so the table above can be read as a rate rather than a list.
function defuns(count) {
  const parts = [];
  for (let i = 0; i < count; i += 1) {
    parts.push(`(defun f${i} (n) (cond ((zerop n) 0) (t (+ n (f${i} (1- n))))))`);
  }
  return parts.join("\n") + "\n";
}

console.log("");
for (const count of [100, 500, 2000, 5000]) {
  const source = defuns(count);
  const bytes = Buffer.byteLength(source);
  const lineCount = source.split("\n").length;
  const parse = fastest(() => parseOnly(source));
  const analyse = fastest(() => analyze(source));
  const hints = fastest(() => {
    const run = collectHints(source);
    run.hintsInLines(1, lineCount);
  });
  console.log(row(`${count} defuns`, bytes, parse, analyse, hints, Number.NaN).replace(/ NaN ms/g, "      —"));
}
