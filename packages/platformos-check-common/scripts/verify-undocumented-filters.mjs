#!/usr/bin/env node
/**
 * Regenerate `src/undocumented-filters.ts` by asking a live platformOS instance
 * which candidate filters actually exist.
 *
 * WHY THIS EXISTS. The list it generates used to be hand-typed, and hand-typing is
 * unverifiable: when it was finally probed, 12 of its 13 entries did not exist. Every
 * one of those was a FALSE APPROVAL — `UnknownFilter` stays silent for a name on the
 * list, so `{{ 'a' | push: 1 }}` passed validation and then raised
 * `Liquid::UndefinedFilter` at runtime.
 *
 * WHAT THE SOURCE OF TRUTH IS. Not the docs API: `filters.json` carries 167 filters
 * and is demonstrably incomplete — `sum`, `where`, `find`, `find_index`, `has` and `h`
 * are all absent from it yet all work. The only authority on whether a filter exists
 * is the runtime, so this asks the runtime.
 *
 * THE SAFETY PROPERTY. Candidates below are allowed to be wrong. A candidate reaches
 * the generated file only if the instance proves it exists AND the docs do not already
 * document it. So a mistaken guess is dropped silently instead of shipping as a false
 * approval — which is exactly the failure this replaces. Adding a name here can no
 * longer break the write gate; it can only fail to help.
 *
 * NOT RUN IN CI, deliberately: it needs credentials for a real instance. Run it by
 * hand when a filter is suspected missing, and commit the regenerated file — the same
 * arrangement as check-node's generated factory configs.
 *
 *   node scripts/verify-undocumented-filters.mjs \
 *     --url https://your-instance.example.com \
 *     --email you@example.com \
 *     --token <api-token>
 *
 * Credentials may also come from POS_URL / POS_EMAIL / POS_TOKEN.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');
const OUTPUT = resolve(PACKAGE_ROOT, 'src', 'undocumented-filters.ts');
const DOCS_FILTERS = resolve(
  PACKAGE_ROOT,
  '..',
  'platformos-check-docs-updater',
  'data',
  'filters.json',
);

/**
 * Names to ASK the instance about, each with a template that exercises it.
 *
 * Being wrong here is safe and expected — see the safety property above. A template
 * only has to reach the filter; it does not have to succeed, because a filter that
 * exists but rejects these arguments reports a DIFFERENT error than an undefined one.
 *
 * The 13 entries that were previously hardcoded are all kept as candidates so that
 * regenerating reproduces (and re-proves) their removal rather than quietly forgetting
 * they were ever claimed.
 */
const CANDIDATES = {
  // Previously hardcoded. Only `h` survived the first probe, 2026-08-01.
  debug: `{{ 'abc' | debug }}`,
  distance_from: `{{ 10 | distance_from: 5 }}`,
  encode_url_component: `{{ 'a b' | encode_url_component }}`,
  excerpt: `{{ 'hello world foo' | excerpt: 'world' }}`,
  format_code: `{{ 'x' | format_code }}`,
  h: `{{ 'abc' | h }}`,
  handle_from: `{{ 'Hello World' | handle_from }}`,
  pad_spaces: `{{ 'x' | pad_spaces: 3 }}`,
  paragraphize: `{{ 'x' | paragraphize }}`,
  push: `{% assign a = [1,2] %}{{ a | push: 3 }}`,
  sentence: `{{ 'x' | sentence }}`,
  unit: `{{ 5 | unit: 'kg' }}`,
  weight: `{{ 5 | weight }}`,

  // Real filters an evaluation found the gate REFUSING, because they are absent from
  // the docs and were absent here too — the opposite failure, a false block.
  sum: `{% assign a = [1,2,3] %}{{ a | sum }}`,
  where: `{% parse_json a %}[{"k":1},{"k":2}]{% endparse_json %}{{ a | where: 'k', 1 | json }}`,
  find: `{% parse_json a %}[{"k":1},{"k":2}]{% endparse_json %}{{ a | find: 'k', 2 | json }}`,
  find_index: `{% parse_json a %}[{"k":1},{"k":2}]{% endparse_json %}{{ a | find_index: 'k', 2 }}`,
  has: `{% parse_json a %}[{"k":1},{"k":2}]{% endparse_json %}{{ a | has: 'k', 2 }}`,
};

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

/**
 * Ask the instance to render `content`.
 *
 * The discriminator is the structured `diagnostic.type`, not the prose: a filter that
 * exists but dislikes these arguments raises something else entirely, and must be
 * recorded as EXISTING. Only `Liquid::UndefinedFilter` naming this filter proves
 * absence.
 */
async function probe({ url, email, token }, name, content) {
  const response = await fetch(`${url}/api/app_builder/liquid_exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token token=${token}, email=${email}`,
    },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    throw new Error(`${name}: instance returned HTTP ${response.status}`);
  }

  const body = await response.json();
  const undefinedFilter =
    body?.diagnostic?.type === 'Liquid::UndefinedFilter' &&
    body?.diagnostic?.message === `undefined filter ${name}`;

  return {
    exists: !undefinedFilter,
    evidence: undefinedFilter ? body.diagnostic.message : `rendered ${JSON.stringify(body.result)}`,
  };
}

const documentedNames = async () => {
  const docs = JSON.parse(await readFile(DOCS_FILTERS, 'utf8'));
  return new Set(docs.map((filter) => filter.name));
};

function render(verified, { url }, generatedAt) {
  const entries = verified
    .map(({ name, evidence }) => `  // ${evidence}\n  '${name}',`)
    .join('\n');

  return `// WARNING:
// This file was generated by "scripts/verify-undocumented-filters.mjs".
// Do not modify manually. Your changes will be overwritten.
//
// Every name below was PROVEN to exist by rendering it on a real platformOS instance,
// and proven absent from the docs API's \`filters.json\`. The comment on each line is
// what the instance actually returned.
//
// Instance:  ${url}
// Generated: ${generatedAt}

/**
 * Filters that work in platformOS but are missing from the official docs.
 *
 * These are injected into {@link AugmentedPlatformOSDocset} so \`UnknownFilter\` does
 * not report working code as broken. Membership therefore has real consequences in
 * BOTH directions, which is why it is generated rather than typed:
 *
 *   - a name here that does NOT exist silences \`UnknownFilter\` for it, so broken code
 *     passes the write gate and raises at runtime (this happened: 12 of 13 hand-typed
 *     entries were fictional);
 *   - a real filter MISSING from here is reported as unknown, and because the MCP
 *     supervisor treats \`UnknownFilter\` as blocking, working code is refused.
 *
 * To change this list, edit the candidates in the generator and re-run it against an
 * instance. Do not add a name by hand — an unverified entry is how this rotted.
 */
export const UNDOCUMENTED_FILTERS: readonly string[] = [
${entries}
];
`;
}

const auth = credentials();
const documented = await documentedNames();
const verified = [];

for (const [name, content] of Object.entries(CANDIDATES)) {
  if (documented.has(name)) {
    console.log(`skip     ${name} — already in filters.json`);
    continue;
  }

  const { exists, evidence } = await probe(auth, name, content);
  console.log(`${exists ? 'KEEP    ' : 'drop    '} ${name} — ${evidence}`);
  if (exists) verified.push({ name, evidence });
}

verified.sort((a, b) => a.name.localeCompare(b.name));
await writeFile(OUTPUT, render(verified, auth, new Date().toISOString().slice(0, 10)), 'utf8');
console.log(`\nWrote ${verified.length} verified filters to ${OUTPUT}`);
