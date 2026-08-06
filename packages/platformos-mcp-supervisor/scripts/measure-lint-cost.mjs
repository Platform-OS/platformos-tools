#!/usr/bin/env node
/**
 * Measure what a lint actually costs, so `LINT_MS_PER_KIB` is a number someone read off
 * a machine rather than one that sounded right.
 *
 * WHY THIS IS A SCRIPT AND NOT A TEST. Every bound in `cost-model.ts` is derived from
 * that one constant, so it has to be re-measurable — but a wall-clock assertion in CI is
 * a flake generator: it fails on a busy runner and passes on a fast one, and the only
 * way to make it stable is to loosen it until it no longer says anything. The ARITHMETIC
 * relationships are asserted in `cost-model.spec.ts`, which is hermetic and exact. This
 * script supplies the empirical input to that arithmetic, by hand, on a known machine.
 *
 * WHAT IT MEASURES, and why the shapes are what they are:
 *
 *   clean     realistic markup with no offenses      — the common case
 *   dense     markup where every line is an offense  — the case the bounds must survive
 *
 * Both matter, and only the second one sizes a ceiling. Diagnostic production is real
 * work: each offense is mapped to a line/character position, so a buffer with 4 000
 * findings costs materially more than a clean buffer of the same size. Sizing the
 * constant on clean markup would under-count exactly the request these bounds exist to
 * contain — which is the same mistake as sizing on the single-buffer rate instead of the
 * batch rate, recorded in `cost-model.ts`.
 *
 * THERE IS DELIBERATELY NO PER-CHECK ATTRIBUTION HERE, and it is worth knowing why before
 * adding one. A `--attribute` mode existed, timing the dense shape with one check disabled
 * at a time. It was wrong three times, each time convincingly:
 *
 *   1. one baseline taken up front, diffed against every later run. V8's JIT warms as the
 *      process runs, so whatever executed FIRST was slowest and everything after it looked
 *      like a saving. The per-check "savings" summed to ~800% of the runtime.
 *   2. adjacent baseline/disabled pairs, with a single baseline-vs-baseline noise floor.
 *      The floor was one draw from a distribution, and eleven checks landed "above" it.
 *   3. the same, with the floor sampled five times. The samples were 13, 13, 1074, 139,
 *      34 ms — a fat tail, almost certainly GC — and one check came out at 2 864 ms of a
 *      3 786 ms lint, which is not a thing one of thirty-nine checks can cost.
 *
 * The tell each time was `JSONSyntaxError` and `YAMLSyntaxError` appearing with real
 * costs. Those are `SourceCodeType.JSON` and `SourceCodeType.YAML` checks and CANNOT touch
 * a Liquid buffer, so any cost attributed to them is a direct readout of the method's
 * error bar. It read in the hundreds of milliseconds, against per-check effects of tens.
 *
 * Wall-clock A/B does not have the resolution for this, and no amount of guarding fixes
 * that — the noise is larger than the signal. Attribution needs in-process instrumentation
 * (per-visitor CPU time), not subtraction of two noisy totals. Until someone builds that,
 * "which check is hot" is an open question rather than a number this script will invent.
 *
 * The SHAPE measurements below are a different matter and are trustworthy: they were
 * validated by running the same commit twice around a change (BASE-1 vs BASE-2 agreed to
 * within 1%), and by a cross-commit A/B whose result was internally consistent — a large
 * effect on exactly one shape and none on the other three.
 *
 * USAGE
 *
 *   node scripts/measure-lint-cost.mjs                  # synthetic project, all shapes
 *   node scripts/measure-lint-cost.mjs --runs 5         # best of N (default 3)
 *   node scripts/measure-lint-cost.mjs --project <dir>  # measure against a real project
 *
 * Run it on an IDLE machine. The numbers are meaningless otherwise, and the script says
 * so if it sees load it does not like.
 */
import { execSync } from 'node:child_process';
import { cpus, loadavg, totalmem } from 'node:os';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '..', 'dist');

const { path: pathUtils } = await import('@platformos/platformos-check-common');
const { AppCache } = await import('@platformos/platformos-check-node');
const { GraphCache } = await import(`${DIST}/graph-cache/graph-cache.js`);
const { runValidateCode } = await import(`${DIST}/transport/validate-code.js`);
const { LINT_MS_PER_KIB } = await import(`${DIST}/cost-model.js`);
const { MAX_BUFFER_BYTES } = await import(`${DIST}/adapter-input.js`);
const { MAX_BATCH_BYTES, MAX_BATCH_FILES } = await import(`${DIST}/validate/batch-bounds.js`);

const KIB = 1024;

function options() {
  const argv = process.argv.slice(2);
  const value = (name, fallback) => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? fallback : argv[at + 1];
  };
  return {
    runs: Number(value('runs', 3)),
    project: value('project', undefined),
  };
}

/**
 * A realistic partial body, repeated to fill a buffer.
 *
 * NOT one repeated character, and the difference is not cosmetic: `cost-model.ts` records
 * that 127 KiB of a single character validates roughly 3x faster than 127 KiB of real
 * markup, because cost tracks parse and check work rather than bytes. A benchmark built
 * on filler measures the wrong thing and reports a comfortable number.
 */
const CLEAN_UNIT = `{% doc %}
  @param title [String] Heading text.
{% enddoc %}
<section class="card">
  <h2>{{ title | upcase | truncate: 40 }}</h2>
  {% assign items = 'a,b,c' | split: ',' %}
  {% for item in items %}
    <li data-k="{{ forloop.index }}">{{ item | strip | append: '!' }}</li>
  {% endfor %}
  {% if title %}<p>{{ title | escape }}</p>{% endif %}
</section>
`;

/**
 * Markup where every line produces an offense.
 *
 * `no_such_filter_xyz` is not a real filter, so `UnknownFilter` fires per line without
 * any line being a SYNTAX error — a syntax error short-circuits the other checks and
 * collapses the diagnostic count to one, which measures nothing. That was a fixture bug
 * in an earlier round and is worth not repeating.
 */
const DENSE_UNIT = `{{ 'a' | no_such_filter_xyz }}\n`;

/** Exactly `bytes` of `unit`, padded with spaces so no tag is cut in half. */
const buffer = (unit, bytes) => {
  const whole = unit.repeat(Math.floor(bytes / unit.length));
  return whole + ' '.repeat(bytes - whole.length);
};

/**
 * A project to lint against, created fresh unless one was named.
 *
 * The synthetic default exists so the measurement is reproducible on any machine. Real
 * projects differ by several times — more files means more references to resolve — so the
 * composition is fixed here and reported alongside the numbers rather than left implicit.
 */
function makeProject(files = 40) {
  const dir = mkdtempSync(join(tmpdir(), 'lint-cost-'));
  mkdirSync(join(dir, '.git'));
  mkdirSync(join(dir, 'app', 'views', 'partials'), { recursive: true });
  mkdirSync(join(dir, 'app', 'views', 'pages'), { recursive: true });

  for (let i = 0; i < files; i++) {
    writeFileSync(
      join(dir, 'app', 'views', 'partials', `p${i}.liquid`),
      `<div class="p${i}">{{ 'x' | upcase }}</div>\n`,
    );
  }
  return dir;
}

/** The default config for the synthetic project: every recommended check enabled. */
function writeConfig(dir) {
  writeFileSync(join(dir, '.platformos-check.yml'), `root: .\n`);
}

const ctxFor = (projectDir) => ({
  projectDir,
  graphCache: new GraphCache({ rootUri: pathUtils.toUri(projectDir) }),
  appCache: new AppCache(),
  log: () => {},
});

/**
 * Best-of-N wall clock for one request shape.
 *
 * BEST, not mean: the fastest run is the one least polluted by whatever else the machine
 * was doing, and this is a measurement of the code rather than of the scheduler. A warm-up
 * pass runs first — the first call also builds the app, loads the config and reconciles
 * the graph, which `MIN_LINT_DEADLINE_MS` covers separately and which would otherwise be
 * charged to per-KiB throughput.
 */
async function timed(projectDir, params, runs) {
  const ctx = ctxFor(projectDir);
  await runValidateCode(ctx, params);

  let best = Infinity;
  let diagnostics = 0;
  for (let i = 0; i < runs; i++) {
    const started = process.hrtime.bigint();
    const result = await runValidateCode(ctx, params);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (ms < best) {
      best = ms;
      diagnostics = countDiagnostics(result);
    }
  }
  return { ms: best, diagnostics };
}

/**
 * How many diagnostics the lint PRODUCED, not how many came back.
 *
 * The response budget caps what a result carries, so counting the returned arrays reports
 * ~200 for a buffer that generated four thousand — which would make the dense shape look
 * like it did almost no work. `truncated` holds the true per-bucket total, and that is the
 * number that explains the timing.
 */
const countDiagnostics = (result) => {
  const one = (r) =>
    ['errors', 'warnings', 'infos'].reduce(
      (n, bucket) => n + (r.truncated?.[bucket]?.total ?? r[bucket]?.length ?? 0),
      0,
    );
  return result.files ? result.files.reduce((n, entry) => n + one(entry.result), 0) : one(result);
};

/** The request shapes the bounds are actually derived from. */
function shapes() {
  const single = MAX_BUFFER_BYTES;
  const batchFiles = 4;
  const perFile = Math.floor(MAX_BATCH_BYTES / batchFiles);
  const fiftyPerFile = Math.floor(MAX_BATCH_BYTES / MAX_BATCH_FILES);

  return [
    {
      name: `single ${(single / KIB).toFixed(0)} KiB clean`,
      bytes: single,
      params: (unit) => ({
        file_path: 'app/views/pages/one.liquid',
        content: buffer(unit, single),
      }),
      unit: CLEAN_UNIT,
    },
    {
      name: `single ${(single / KIB).toFixed(0)} KiB dense`,
      bytes: single,
      params: (unit) => ({
        file_path: 'app/views/pages/one.liquid',
        content: buffer(unit, single),
      }),
      unit: DENSE_UNIT,
    },
    {
      name: `worst batch ${batchFiles}x${(perFile / KIB).toFixed(0)} KiB dense`,
      bytes: perFile * batchFiles,
      params: (unit) => ({
        files: Array.from({ length: batchFiles }, (_, i) => ({
          file_path: `app/views/pages/b${i}.liquid`,
          content: buffer(unit, perFile),
        })),
      }),
      unit: DENSE_UNIT,
    },
    {
      name: `${MAX_BATCH_FILES}-file batch dense`,
      bytes: fiftyPerFile * MAX_BATCH_FILES,
      params: (unit) => ({
        files: Array.from({ length: MAX_BATCH_FILES }, (_, i) => ({
          file_path: `app/views/pages/f${i}.liquid`,
          content: buffer(unit, fiftyPerFile),
        })),
      }),
      unit: DENSE_UNIT,
    },
  ];
}

function machine() {
  let cpu = cpus()[0]?.model ?? 'unknown CPU';
  try {
    const model = execSync('lscpu 2>/dev/null | grep "Model name"', { encoding: 'utf8' });
    cpu = model.split(':')[1]?.trim() || cpu;
  } catch {
    // lscpu is Linux-only; the os.cpus() fallback above is fine everywhere else.
  }
  return `${cpu}, ${cpus().length} threads, ${(totalmem() / 1024 ** 3).toFixed(0)} GB RAM, node ${process.version}`;
}

const opts = options();
const projectDir = opts.project ? resolve(opts.project) : makeProject();
const synthetic = !opts.project;
if (synthetic) writeConfig(projectDir);

const load = loadavg()[0];
console.log(`machine:  ${machine()}`);
console.log(`project:  ${projectDir}${synthetic ? ' (synthetic, 40 partials)' : ''}`);
console.log(`load avg: ${load.toFixed(2)} over ${cpus().length} cores`);
if (load > cpus().length / 4) {
  console.log(`\n  !! LOAD IS HIGH. These numbers measure the scheduler, not the linter.`);
  console.log(`     Wait for the machine to settle and re-run.\n`);
}
console.log(`runs:     best of ${opts.runs}\n`);

const results = [];
for (const shape of shapes()) {
  const { ms, diagnostics } = await timed(projectDir, shape.params(shape.unit), opts.runs);
  const perKiB = ms / (shape.bytes / KIB);
  results.push({ ...shape, ms, perKiB, diagnostics });
  console.log(
    `${shape.name.padEnd(34)} ${ms.toFixed(0).padStart(7)} ms   ${perKiB
      .toFixed(1)
      .padStart(6)} ms/KiB   ${String(diagnostics).padStart(6)} diagnostics`,
  );
}

const worst = results.reduce((a, b) => (b.perKiB > a.perKiB ? b : a));
console.log(
  `\nslowest shape: ${worst.name} at ${worst.perKiB.toFixed(1)} ms/KiB ` +
    `(modelled ${LINT_MS_PER_KIB}, margin ${(((LINT_MS_PER_KIB - worst.perKiB) / LINT_MS_PER_KIB) * 100).toFixed(0)}%)`,
);

if (synthetic) rmSync(projectDir, { recursive: true, force: true });
