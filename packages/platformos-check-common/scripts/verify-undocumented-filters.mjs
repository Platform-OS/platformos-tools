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

/**
 * Values a type probe can draw on, prepended to every measurement template.
 */
const TYPE_PROBE_PREAMBLE =
  `{% parse_json objs %}[{"k":1},{"k":2}]{% endparse_json %}` +
  `{% parse_json nums %}[1,2,3]{% endparse_json %}`;

/**
 * A WELL-FORMED call per candidate, used to measure what the filter RETURNS.
 *
 * Separate from {@link CANDIDATES} on purpose, and the distinction matters. A candidate
 * template only has to REACH the filter — it is allowed to raise, because a filter that
 * exists and dislikes its arguments still proves existence. A type probe has the
 * opposite requirement: it must RENDER, because a call that raises produces no value and
 * a probe with no value cannot tell a wrong answer from a wrong probe.
 *
 * A verified filter with no entry here is recorded as UNMEASURED rather than guessed, and
 * the generator says so loudly — an unmeasured filter simply stays untyped downstream,
 * which is the same safe silence it has today.
 */
const TYPE_PROBES = {
  find: `objs | find: 'k', 2`,
  find_index: `objs | find_index: 'k', 2`,
  h: `'abc' | h`,
  has: `objs | has: 'k', 1`,
  sum: `nums | sum`,
  where: `objs | where: 'k', 1`,
};

/**
 * Runtime class -> the docset spelling that describes it.
 *
 * Only consulted to NAME a scalar for the message an author reads; the verdict itself
 * comes from behaviour (below), never from this table. Derived from the 173 measured
 * rows in `filter-return-type-oracle.ts`, where every `number` row is an Integer or a
 * Float, every `boolean` row a Boolean, and the `string` rows include String and its
 * subclasses.
 */
const SCALAR_SPELLINGS = {
  String: 'string',
  Integer: 'number',
  Float: 'number',
  Boolean: 'boolean',
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

/** Render one template and say whether it produced output or raised. */
async function render1({ url, email, token }, content) {
  const response = await fetch(`${url}/api/app_builder/liquid_exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Token token=${token}, email=${email}`,
    },
    body: JSON.stringify({ content }),
  });

  // Any non-200 is UNMEASURED, never "rendered". Measured the hard way in the sibling
  // generator: a filter returning binary makes the runtime's own complaint unencodable
  // and the response comes back 406 with no body, which a `>= 500` test reads as success.
  if (response.status !== 200) return { outcome: 'unmeasured', detail: `HTTP ${response.status}` };

  const body = await response.json();
  if (body?.error) return { outcome: 'raised', detail: String(body.error) };
  return { outcome: 'rendered', detail: String(body?.result ?? '') };
}

/**
 * What `hash_assign` does to this filter's return value, and therefore what type the
 * check should model it as.
 *
 * THE VERDICT COMES FROM BEHAVIOUR, NOT FROM THE CLASS NAME. `type_of` is asked too, but
 * only to pick the noun in the author-facing message. The reason is that the runtime
 * class is frequently not the plain thing the docs would call it —
 * `ActiveSupport::SafeBuffer` for html-producing string filters, `JOSE::EncryptedBinary`
 * for jwe_encode, `Float` where the docs say number — while the BEHAVIOUR is exactly what
 * `InvalidHashAssignTarget` acts on:
 *
 *   key raises, index renders   -> array   (an Array wants a numeric index)
 *   key renders, index renders  -> hash    (a Hash is a valid target; check stays silent)
 *   key raises,  index raises   -> scalar  (neither Hash nor Array; type_of names it)
 *
 * Anything else is recorded as unmeasured rather than forced into one of those.
 */
async function measureReturnType(auth, name, expression) {
  const assign = `${TYPE_PROBE_PREAMBLE}{% assign x = ${expression} %}`;

  const typeOf = await render1(auth, `${assign}[{{ x | type_of }}]`);
  if (typeOf.outcome !== 'rendered') {
    return { spelling: undefined, note: `invocation did not render (${typeOf.detail.slice(0, 90)})` };
  }
  const runtimeType = typeOf.detail.match(/^\[(.*)\]$/)?.[1] ?? '?';

  const key = await render1(auth, `${assign}{% hash_assign x['k'] = 'v' %}OK`);
  const index = await render1(auth, `${assign}{% hash_assign x[0] = 'v' %}OK`);

  if (key.outcome === 'raised' && index.outcome === 'rendered') {
    return { spelling: 'array', note: `${runtimeType}; key raises, index renders` };
  }
  if (key.outcome === 'rendered' && index.outcome === 'rendered') {
    return { spelling: 'hash', note: `${runtimeType}; accepts both subscripts` };
  }
  if (key.outcome === 'raised' && index.outcome === 'raised') {
    const spelling = SCALAR_SPELLINGS[runtimeType];
    return spelling
      ? { spelling, note: `${runtimeType}; both subscripts raise` }
      : { spelling: undefined, note: `unrecognised scalar class ${runtimeType}` };
  }

  return {
    spelling: undefined,
    note: `inconclusive (key=${key.outcome}, index=${index.outcome})`,
  };
}

/**
 * Every name the docs already cover: top-level entries AND the aliases they declare.
 *
 * Aliases must be in here. They are not top-level entries in `filters.json`, but
 * `expandAliases` promotes each one to a real filter entry, so a candidate matching an
 * alias is already handled and would be dead weight here. Excluding only `name` let
 * such a candidate through the generator and straight into a spec that rejects it —
 * the generator would have produced output its own test fails.
 */
const documentedNames = async () => {
  const docs = JSON.parse(await readFile(DOCS_FILTERS, 'utf8'));
  return new Set(docs.flatMap((filter) => [filter.name, ...(filter.aliases ?? [])]));
};

function render(verified, { url }, generatedAt) {
  const entries = verified
    .map(({ name, evidence }) => `  // ${evidence}\n  '${name}',`)
    .join('\n');

  const typeEntries = verified
    .filter(({ returnType }) => returnType.spelling)
    .map(({ name, returnType }) => `  // ${returnType.note}\n  ${name}: '${returnType.spelling}',`)
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

/**
 * What each undocumented filter RETURNS, in the docset's own spelling.
 *
 * WHY THIS IS A SECOND EXPORT AND NOT A FIELD ON THE LIST ABOVE. The list is fed to
 * {@link AugmentedPlatformOSDocset} as bare \`{ name }\` entries, and that docset is built
 * by the LANGUAGE SERVER too (\`startServer.ts\`). Attaching \`return_type\` there would
 * retype these filters for LSP completions and hover — from the \`'string'\` default that
 * \`docsetEntryReturnType\` currently applies, to their real types. That is probably an
 * improvement, but the language server's own tests inject a MOCK docset and would not
 * catch a regression, so the change cannot be verified where it lands.
 *
 * Keeping the list byte-identical means the LSP delta is provably zero rather than
 * probably fine: same code path, same input. Improving LSP typing from this data is
 * worth doing on its own terms, with tests that drive the real augmented docset.
 *
 * Consumed only by \`InvalidHashAssignTarget\`, which resolves it exactly like
 * \`DOCSET_RETURN_TYPE_GAPS\`: only where the docset has no data of its own, never over a
 * spelling it has declined to interpret.
 *
 * MEASURED BY BEHAVIOUR. Each spelling was chosen from what \`hash_assign\` actually did
 * to the value — a key subscript, then an index — because that is what the check acts on.
 * The runtime class only names the scalar; it is frequently not the plain thing the docs
 * would call it.
 *
 * A filter ABSENT from this map is untyped downstream and produces no diagnostic, which
 * is exactly the silence it had before this map existed.
 */
export const UNDOCUMENTED_FILTER_RETURN_TYPES: Readonly<Record<string, string>> = {
${typeEntries}
};
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
  if (!exists) continue;

  // Existence and return type are measured in the same pass so the two can never
  // disagree about which filters are covered.
  const expression = TYPE_PROBES[name];
  const returnType = expression
    ? await measureReturnType(auth, name, expression)
    : { spelling: undefined, note: 'no type probe defined' };

  console.log(
    `         ${name} -> ${returnType.spelling ?? 'UNTYPED'}  (${returnType.note})`,
  );
  verified.push({ name, evidence, returnType });
}

verified.sort((a, b) => a.name.localeCompare(b.name));
await writeFile(OUTPUT, render(verified, auth, new Date().toISOString().slice(0, 10)), 'utf8');
console.log(`\nWrote ${verified.length} verified filters to ${OUTPUT}`);
