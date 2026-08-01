#!/usr/bin/env node
/**
 * Regenerate `src/filter-arity.ts` by asking a live platformOS instance how many
 * arguments each filter accepts.
 *
 * WHY THE RUNTIME AND NOT THE DOCS. `filters.json` cannot answer this. Measured:
 * of its 167 filters, 123 carry a `parameters[]` array, ZERO mark any parameter
 * `required`, and `slice`/`replace` — the two cases that motivated this — carry no
 * parameters at all. Its counts also disagree with reality: `add_to_time` lists three
 * parameters while the runtime accepts `1..3`. Deriving a write-gate signal from that
 * would repeat the `undocumentedFilters` failure of shipping confident wrong answers.
 *
 * The runtime states it exactly, and in a machine-readable field:
 *
 *     { "type": "Liquid::ArgumentError",
 *       "message": "wrong number of arguments (given 1, expected 2..3)" }
 *
 * So each filter is called with an absurd number of arguments and the accepted range
 * is read out of the complaint.
 *
 * HOW ARGUMENTS ARE COUNTED — established by probe, not assumption, because getting
 * this wrong turns every correct call into an offense:
 *
 *     {{ 'abc'    | upcase: a: 1, b: 2, c: 3 }}  -> given 2   (input + ONE hash)
 *     {{ 'abc'    | upcase: 1, 2 }}              -> given 3   (input + 2 positional)
 *     {{ 'abcdef' | slice: 1, 2, extra: 9 }}     -> given 4   (input + 2 + one hash)
 *
 *     given = 1 (the piped input) + positional count + (1 if any named argument)
 *
 * A whole group of named arguments collapses into a single trailing hash. `filter-arity.ts`
 * repeats this rule for the check that consumes it; the two must not drift.
 *
 * NOT RUN IN CI: it needs credentials for a real instance. Run by hand and commit the
 * result, like `verify-undocumented-filters.mjs` and check-node's factory configs.
 *
 *   node scripts/verify-filter-arity.mjs \
 *     --url https://your-instance.example.com --email you@example.com --token <token>
 *
 * Credentials may also come from POS_URL / POS_EMAIL / POS_TOKEN.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');
const OUTPUT = resolve(PACKAGE_ROOT, 'src', 'filter-arity.ts');
const DOCS_FILTERS = resolve(
  PACKAGE_ROOT,
  '..',
  'platformos-check-docs-updater',
  'data',
  'filters.json',
);
const UNDOCUMENTED = resolve(PACKAGE_ROOT, 'src', 'undocumented-filters.ts');

/**
 * Arguments to overflow a filter with. High enough that no real filter accepts this
 * many, so the runtime answers with its true range instead of succeeding.
 *
 * The value is echoed back as `given N`, and the generator asserts that echo matches,
 * so a filter that somehow accepts them all is recorded as unknown rather than guessed.
 */
const OVERFLOW_ARGS = 12;

function credentials() {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 2) {
    args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
  }
  const url = args.get('url') ?? process.env.POS_URL;
  const email = args.get('email') ?? process.env.POS_EMAIL;
  const token = args.get('token') ?? process.env.POS_TOKEN;

  if (!url || !email || !token) {
    console.error(
      'Need an instance to ask. Pass --url/--email/--token, or set POS_URL/POS_EMAIL/POS_TOKEN.',
    );
    process.exit(1);
  }
  return { url: url.replace(/\/+$/, ''), email, token };
}

async function render({ url, email, token }, content) {
  const response = await fetch(`${url}/api/app_builder/liquid_exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token token=${token}, email=${email}`,
    },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) throw new Error(`instance returned HTTP ${response.status}`);
  return response.json();
}

/**
 * The accepted argument range for one filter, or `null` when it cannot be determined.
 *
 * Returning `null` is a first-class outcome, not a failure: a filter whose range we
 * cannot read must produce NO offense downstream. Guessing here is precisely how a
 * gate starts refusing working code.
 */
async function probeArity(auth, name) {
  const args = Array.from({ length: OVERFLOW_ARGS }, (_, i) => i + 1).join(', ');
  const body = await render(auth, `{{ 'probe' | ${name}: ${args} }}`);
  const message = body?.diagnostic?.message ?? '';

  if (body?.diagnostic?.type !== 'Liquid::ArgumentError') {
    // Either it rendered, or it failed for an unrelated reason (a type error on our
    // junk arguments). Both mean "this filter tolerated 13 arguments as far as arity
    // is concerned", so there is no usable upper bound to record.
    return null;
  }

  const match = /wrong number of arguments \(given (\d+), expected (\d+)(?:\.\.(\d+))?\)/.exec(
    message,
  );
  if (!match) return null;

  const [, given, min, max] = match;
  // The echoed count must match what we sent (input + OVERFLOW_ARGS). If it does not,
  // our counting model is wrong for this filter and recording a bound would be unsafe.
  if (Number(given) !== OVERFLOW_ARGS + 1) return null;

  return { min: Number(min), max: max === undefined ? Number(min) : Number(max) };
}

const filterNames = async () => {
  const docs = JSON.parse(await readFile(DOCS_FILTERS, 'utf8'));
  const documented = docs.flatMap((filter) => [filter.name, ...(filter.aliases ?? [])]);

  // The generated undocumented list is the other half of the vocabulary the checks
  // accept, so it must be measured too — otherwise `sum`/`where`/... would be the only
  // filters with no arity data, purely because of where their names live.
  const source = await readFile(UNDOCUMENTED, 'utf8');
  const undocumented = [...source.matchAll(/^\s*'([a-z0-9_]+)',$/gim)].map((m) => m[1]);

  return [...new Set([...documented, ...undocumented])].sort();
};

function renderModule(arities, unknown, { url }, generatedAt) {
  const entries = Object.entries(arities)
    .map(([name, { min, max }]) => `  ${name}: { min: ${min}, max: ${max} },`)
    .join('\n');

  // Built outside the template below: naming the undetermined filters in the header is
  // what stops "absent" being mistaken for "arity 0".
  const unknownNote = unknown.length ? `:\n//            ${unknown.join(', ')}` : '';

  return `// WARNING:
// This file was generated by "scripts/verify-filter-arity.mjs".
// Do not modify manually. Your changes will be overwritten.
//
// Each range was read out of a live platformOS instance's own complaint when the
// filter was deliberately over-applied, so these are the runtime's numbers rather
// than the docs' (which cannot answer this — see the generator's header).
//
// Instance:  ${url}
// Generated: ${generatedAt}
// Measured:  ${Object.keys(arities).length} filters; ${unknown.length} could not be determined
//            and are deliberately ABSENT rather than guessed${unknownNote}

/** The inclusive range of arguments a filter accepts, counted as {@link FILTER_ARITY} describes. */
export interface FilterArity {
  min: number;
  max: number;
}

/**
 * How many arguments each filter accepts, INCLUDING the piped input.
 *
 * COUNTING RULE, established by probing the runtime rather than assumed:
 *
 *     given = 1 (the piped input)
 *           + the number of POSITIONAL arguments
 *           + 1 if there is at least one NAMED argument (they collapse to one hash)
 *
 * Verified: \`{{ 'abc' | upcase: a: 1, b: 2, c: 3 }}\` is "given 2", not 4 —
 * three named arguments arrive as a single trailing hash. \`{{ 'abc' | upcase: 1, 2 }}\`
 * is "given 3". Mixing them, \`{{ 'abcdef' | slice: 1, 2, extra: 9 }}\` is "given 4".
 *
 * A filter ABSENT from this map has no measurable arity and must produce NO offense.
 * That is the whole safety property: unknown stays unknown instead of becoming a
 * refusal of working code.
 */
export const FILTER_ARITY: Readonly<Record<string, FilterArity>> = {
${entries}
};
`;
}

const auth = credentials();
const names = await filterNames();
const arities = {};
const unknown = [];

for (const name of names) {
  try {
    const arity = await probeArity(auth, name);
    if (arity) {
      arities[name] = arity;
      console.log(`${String(name).padEnd(28)} ${arity.min}..${arity.max}`);
    } else {
      unknown.push(name);
      console.log(`${String(name).padEnd(28)} (undetermined — omitted)`);
    }
  } catch (error) {
    unknown.push(name);
    console.log(`${String(name).padEnd(28)} (probe failed: ${error.message} — omitted)`);
  }
}

await writeFile(
  OUTPUT,
  renderModule(arities, unknown, auth, new Date().toISOString().slice(0, 10)),
  'utf8',
);
console.log(
  `\nWrote ${Object.keys(arities).length} arities (${unknown.length} undetermined) to ${OUTPUT}`,
);
