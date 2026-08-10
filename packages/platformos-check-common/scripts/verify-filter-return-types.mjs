#!/usr/bin/env node
/**
 * Regenerate `src/checks/invalid-hash-assign-target/filter-return-type-oracle.ts` by
 * asking a live platformOS instance what every reporting-typed filter ACTUALLY returns,
 * and what `hash_assign` actually does to it.
 *
 * WHY THIS EXISTS. `InvalidHashAssignTarget` derives a variable's type from the docset
 * `return_type`, and it BLOCKS. Four spellings map to a reporting type — `string` (78),
 * `array` (31), `number` (17), `boolean` (14) — so 140 docset rows, 138 distinct filter
 * names, each of which can refuse a write. One wrong `return_type` among them is a
 * refusal of working code.
 *
 * SAMPLING CANNOT FIND THE WRONG ONE. Checking a dozen entries of an accepting
 * population and finding them all correct says nothing about the rest; this is the same
 * structural blindness that let twelve fictional filter names survive in
 * `undocumentedFilters` until a full sweep replaced the spot checks. So every name is
 * exercised, every time this runs.
 *
 * THE ORACLE IS THE RUNTIME, NOT THE DOCS — and specifically `liquid_exec`, not
 * `pos-cli deploy --dry-run`. A bad `hash_assign` target is a runtime raise, not a
 * converter rejection: the converter accepts every buffer below. The rule that the
 * dry-run oracle outranks the runtime one is scoped to SYNTAX, and this is semantics.
 *
 * THREE MEASUREMENTS PER FILTER, because one is not enough to tell a wrong docset entry
 * from a badly-written probe:
 *
 *   {{ x | type_of }}             what the value IS      (explains a disagreement)
 *   {% hash_assign x['k'] = … %}  what a KEY subscript does
 *   {% hash_assign x[0]   = … %}  what an INDEX subscript does
 *
 * The last two are the settlement — they are exactly what the check predicts. `type_of`
 * is the diagnosis, and the thing that distinguishes "the docset is wrong" from "my
 * invocation was".
 *
 * INVOCATIONS ARE HAND-WRITTEN, see {@link INVOCATIONS}. Deriving them from the docset's
 * `parameters[]` produces `'abc' | abs` and `'abc' | plus: 'a'`, which raise for reasons
 * that have nothing to do with the return type — and a filter that raises tells us
 * nothing about what it returns.
 *
 * NOT RUN IN CI: it needs credentials for a real instance, and two filters need freshly
 * generated key material. Run by hand and commit the result, like
 * `verify-filter-arity.mjs` and `verify-undocumented-filters.mjs`.
 *
 *   node scripts/verify-filter-return-types.mjs \
 *     --url https://your-instance.example.com --email you@example.com --token <token>
 *
 * Credentials may also come from POS_URL / POS_EMAIL / POS_TOKEN.
 */
import { generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');
const OUTPUT = resolve(
  PACKAGE_ROOT,
  'src',
  'checks',
  'invalid-hash-assign-target',
  'filter-return-type-oracle.ts',
);
const DOCS_FILTERS = resolve(
  PACKAGE_ROOT,
  '..',
  'platformos-check-docs-updater',
  'data',
  'filters.json',
);

/**
 * Docset `return_type.type` spelling -> the type the check models, mirroring
 * `DOCSET_RETURN_TYPES`. `hash` is omitted because it maps to `object`, which reports
 * nothing, and this table exists to enumerate what DOES report.
 *
 * This is a copy of a TypeScript constant, so it can drift. The sweep groups in
 * `invalid-hash-assign-target/index.spec.ts` import the real `DOCSET_RETURN_TYPES` and
 * `variableTypeOf` and assert every row against them, so drift fails a test rather than
 * quietly narrowing the sweep.
 */
const REPORTING_SPELLINGS = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  array: 'array',

  date: 'date',
  datetime: 'time',
  time: 'time',
  'array of arrays': 'array',
};

/**
 * Filters the docset carries NO return-type data for, mirroring `DOCSET_RETURN_TYPE_GAPS`.
 * Applied only where the field is absent or empty, never over a spelling — same rule as
 * the check's `variableTypeOf`.
 */
const RETURN_TYPE_GAPS = {
  array_index_of: 'number',
  new_line_to_br: 'string',
  nl2br: 'string',
};

/** True when the docset simply has nothing to say about this filter's return type. */
function hasNoReturnTypeData(returnType) {
  if (!returnType || returnType.length === 0) return true;
  return returnType.length === 1 && returnType[0].type === '';
}

/** How the docset spells this filter's return type, with the two empty shapes named. */
function spellingOf(returnType) {
  if (!returnType || returnType.length === 0) return '(absent)';
  if (returnType.length > 1) return '(several)';
  return returnType[0].type;
}

/** How many probes are in flight at once. Three requests per filter, 138 filters. */
const CONCURRENCY = 6;

/**
 * Key material for the two filters that will not run without it.
 *
 * GENERATED PER RUN AND NEVER WRITTEN OUT. Embedding a private key in the repository
 * — even a throwaway one — is a thing secret scanners are right to complain about, and
 * the committed record needs the OUTCOME, not the input that produced it. The spec that
 * consumes the record does not need them at all: the check reads the filter NAME off the
 * last filter in the pipeline and never evaluates its arguments.
 */
function ephemeralKeys() {
  const ec = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'sec1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const rsa = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return {
    ecPrivate: ec.privateKey.trim(),
    ecPublic: ec.publicKey.trim(),
    rsaPublic: rsa.publicKey.trim(),
  };
}

/**
 * Values the invocations draw on, so an argument can be an Array, a Hash, or an Array of
 * Arrays. Prepended to every probe.
 */
const PREAMBLE = [
  `{% assign arr = 'a,b,c' | split: ',' %}`,
  `{% parse_json nums %}[3, 1, 2]{% endparse_json %}`,
  `{% parse_json h %}{"a": 1, "b": 2}{% endparse_json %}`,
  `{% parse_json objs %}[{"n": 2}, {"n": 1}]{% endparse_json %}`,
  `{% parse_json cond %}{"n": 1}{% endparse_json %}`,
  `{% parse_json rows %}[["a","b"],["c","d"]]{% endparse_json %}`,
  `{% assign t = '2026-01-01 10:00:00' | to_time %}`,
].join('');

/** A 32-byte key, which is what `encrypt`'s aes-256 modes insist on. */
const KEY32 = `'0123456789abcdef0123456789abcdef'`;

/**
 * One WELL-FORMED call per reporting-typed filter, keyed by name.
 *
 * "Well-formed" means the runtime renders it. A call that raises produces no value, and
 * a probe with no value cannot distinguish a wrong docset entry from a wrong probe — so
 * every entry here was iterated against the instance until it rendered, and the ones
 * that still cannot are recorded as unmeasured rather than assumed.
 *
 * The generator REFUSES TO RUN if this table and the docset disagree about which filters
 * report. That is deliberate: a docset update that adds a reporting filter should stop
 * the sweep and demand an invocation, not quietly leave a name unswept.
 */
const INVOCATIONS = (keys) => ({
  // ── number ────────────────────────────────────────────────────────────────
  abs: `-5 | abs`,
  amount_to_fractional: `'10.00' | amount_to_fractional: 'USD'`,
  array_sum: `nums | array_sum`,
  at_least: `5 | at_least: 10`,
  at_most: `5 | at_most: 3`,
  ceil: `1.2 | ceil`,
  divided_by: `10 | divided_by: 2`,
  floor: `1.8 | floor`,
  fractional_to_amount: `1000 | fractional_to_amount: 'USD'`,
  minus: `10 | minus: 2`,
  modulo: `10 | modulo: 3`,
  plus: `10 | plus: 2`,
  round: `1.234 | round: 2`,
  size: `'abc' | size`,
  time_diff: `'2026-01-01' | time_diff: '2026-01-02', 'days'`,
  times: `10 | times: 2`,
  to_positive_integer: `'5' | to_positive_integer: 1`,

  // ── boolean ───────────────────────────────────────────────────────────────
  array_any: `arr | array_any: 'a'`,
  array_include: `arr | array_include: 'a'`,
  end_with: `'abc' | end_with: 'c'`,
  hcaptcha: `h | hcaptcha`,
  is_date_before: `'2026-01-01' | is_date_before: '2026-01-02'`,
  is_date_in_past: `'2020-01-01' | is_date_in_past`,
  is_email_valid: `'a@b.com' | is_email_valid`,
  is_gpg_valid: `'not-a-key' | is_gpg_valid`,
  is_json_valid: `'{}' | is_json_valid`,
  is_parsable_date: `'2026-01-01' | is_parsable_date`,
  is_token_valid: `'token' | is_token_valid: 1`,
  matches: `'abc' | matches: 'b'`,
  start_with: `'abc' | start_with: 'a'`,
  verify_access_key: `'key' | verify_access_key`,

  // ── array ─────────────────────────────────────────────────────────────────
  array_add: `arr | array_add: 'd'`,
  array_compact: `arr | array_compact`,
  array_delete: `arr | array_delete: 'a'`,
  array_delete_at: `arr | array_delete_at: 0`,
  array_find_index: `objs | array_find_index: cond`,
  array_flatten: `arr | array_flatten`,
  array_in_groups_of: `arr | array_in_groups_of: 2`,
  array_intersect: `arr | array_intersect: arr`,
  array_limit: `arr | array_limit: 2`,
  array_map: `objs | array_map: 'n'`,
  array_prepend: `arr | array_prepend: 'z'`,
  array_reject: `objs | array_reject: cond`,
  array_rotate: `arr | array_rotate: 1`,
  array_select: `objs | array_select: cond`,
  array_shuffle: `arr | array_shuffle`,
  array_sort_by: `objs | array_sort_by: 'n'`,
  array_subtract: `arr | array_subtract: arr`,
  array_uniq: `arr | array_uniq`,
  concat: `arr | concat: arr`,
  hash_diff: `h | hash_diff: h`,
  hash_keys: `h | hash_keys`,
  hash_values: `h | hash_values`,
  map: `objs | map: 'n'`,
  regex_matches: `'abc' | regex_matches: 'b'`,
  reverse: `arr | reverse`,
  sort: `arr | sort`,
  sort_natural: `arr | sort_natural`,
  split: `'a,b' | split: ','`,
  uniq: `arr | uniq`,

  // ── string ────────────────────────────────────────────────────────────────
  advanced_format: `5 | advanced_format: '%.2f'`,
  append: `'abc' | append: 'd'`,
  asset_name_to_raw_url: `'a.png' | asset_name_to_raw_url`,
  asset_path: `'a.png' | asset_path`,
  asset_url: `'a.png' | asset_url`,
  base64_decode: `'YWJj' | base64_decode`,
  base64_encode: `'abc' | base64_encode`,
  capitalize: `'abc' | capitalize`,
  compute_hmac: `'data' | compute_hmac: 'secret'`,
  date: `'2026-01-01' | date: '%Y'`,
  // Round-trips its own ciphertext: a literal payload is rejected as invalid base64,
  // and hard-coding one would rot the moment the key or mode changed.
  decrypt: `'abc' | encrypt: 'aes-256-cbc', ${KEY32} | decrypt: 'aes-256-cbc', ${KEY32}`,
  digest: `'abc' | digest`,
  downcase: `'ABC' | downcase`,
  // Reaches the public internet FROM THE INSTANCE. Recorded unmeasured rather than
  // retried if that is unavailable — see the `unmeasured` handling below.
  download_file: `'https://www.example.com' | download_file`,
  ecdh_compute: `'${keys.ecPrivate}' | ecdh_compute: '${keys.ecPublic}'`,
  encode: `'abc' | encode: 'UTF-8', 'UTF-8'`,
  encoding: `'abc' | encoding`,
  encrypt: `'abc' | encrypt: 'aes-256-cbc', ${KEY32}`,
  escape: `'<a>' | escape`,
  escape_javascript: `'a"b' | escape_javascript`,
  expand_url_template: `'http://x/{a}' | expand_url_template: h`,
  force_encoding: `'abc' | force_encoding: 'UTF-8'`,
  format_number: `5 | format_number`,
  gzip_compress: `'abc' | gzip_compress`,
  gzip_decompress: `'abc' | gzip_compress | gzip_decompress`,
  hkdf: `'ikm' | hkdf`,
  html_safe: `'<b>x</b>' | html_safe`,
  html_to_text: `'<b>x</b>' | html_to_text`,
  humanize: `'some_key' | humanize`,
  join: `arr | join: ','`,
  json: `h | json`,
  jwe_encode: `'{}' | jwe_encode: '${keys.rsaPublic}', 'RSA-OAEP', 'A128GCM'`,
  jwt_encode: `h | jwt_encode: 'HS256', 'secret'`,
  lstrip: `'  a' | lstrip`,
  markdown: `'# a' | markdown`,
  newline_to_br: `'a<br>b' | newline_to_br`,
  pad_left: `'a' | pad_left: 3`,
  parameterize: `'A B' | parameterize`,
  pluralize: `'item' | pluralize`,
  prepend: `'abc' | prepend: 'z'`,
  pricify: `10 | pricify`,
  pricify_cents: `1000 | pricify_cents`,
  querify: `h | querify`,
  random_string: `5 | random_string`,
  raw_escape_string: `'a b' | raw_escape_string`,
  remove: `'abc' | remove: 'b'`,
  remove_first: `'abc' | remove_first: 'b'`,
  replace: `'abc' | replace: 'b', 'z'`,
  replace_first: `'abc' | replace_first: 'b', 'z'`,
  replace_regex: `'abc' | replace_regex: 'b', 'z'`,
  rstrip: `'a  ' | rstrip`,
  sanitize: `'<b>x</b>' | sanitize`,
  scrub: `'abc' | scrub`,
  sha1: `'abc' | sha1`,
  slice: `'abcdef' | slice: 1, 2`,
  slugify: `'A B' | slugify`,
  strftime: `t | strftime: '%Y'`,
  strip: `' a ' | strip`,
  strip_html: `'<b>x</b>' | strip_html`,
  strip_liquid: `'{{ x }}' | strip_liquid`,
  strip_newlines: `'abc' | strip_newlines`,
  titleize: `'a b' | titleize`,
  to_csv: `rows | to_csv`,
  to_mobile_number: `'123456789' | to_mobile_number: 'US'`,
  to_xml: `h | to_xml`,
  translate: `'some.key' | translate`,
  translate_escape: `'some.key' | translate_escape`,
  truncate: `'abcdef' | truncate: 3`,
  truncatewords: `'a b c' | truncatewords: 2`,
  type_of: `'abc' | type_of`,
  unescape_javascript: `'a' | unescape_javascript`,
  upcase: `'abc' | upcase`,
  url_decode: `'a%20b' | url_decode`,
  url_encode: `'a b' | url_encode`,
  url_to_qrcode_svg: `'https://example.com' | url_to_qrcode_svg`,
  uuid: `'' | uuid`,
  videoify: `'https://www.youtube.com/watch?v=abc' | videoify`,
  www_form_encode: `h | www_form_encode`,

  // ── date / datetime / time ────────────────────────────────────────────────
  // The unit argument is PLURAL. `'day'` and `'hour'` are both rejected with "third
  // argument must be valid unit", which renders nothing and would make these rows
  // uninterpretable — the mistake that produced the first draft of this table.
  to_date: `'2026-01-01' | to_date`,
  date_add: `'2026-01-01' | to_date | date_add: 1, 'days'`,
  to_time: `'2026-01-01 10:00:00' | to_time`,
  add_to_time: `'2026-01-01 10:00:00' | to_time | add_to_time: 1, 'hours'`,

  // ── array of arrays ───────────────────────────────────────────────────────
  parse_csv: `'a,b\nc,d' | parse_csv`,

  // ── the two docset holes ──────────────────────────────────────────────────
  // No `return_type` to read, so these are typed by measurement alone. That makes their
  // rows the ONLY justification `DOCSET_RETURN_TYPE_GAPS` has, and the reason the sweep
  // covers them rather than trusting the table.
  array_index_of: `arr | array_index_of: 'b'`,
  new_line_to_br: `'a<br>b' | new_line_to_br`,
});

function credentials() {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 2) {
    args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
  }
  const url = args.get('url') ?? process.env.POS_URL;
  const email = args.get('email') ?? process.env.POS_EMAIL;
  const token = args.get('token') ?? process.env.POS_TOKEN;

  if (!url || !token) {
    console.error('Need an instance to ask. Pass --url/--token, or set POS_URL/POS_TOKEN.');
    process.exit(1);
  }
  return { url: url.replace(/\/+$/, ''), email, token };
}

/**
 * Render one template and classify the outcome.
 *
 * ANY NON-2xx IS `unmeasured`, NOT `rendered`. Measured the hard way: `gzip_compress`
 * returns binary, the runtime's complaint quotes the offending value back, and the
 * resulting response is an HTTP 406 with no body. An earlier version of this classifier
 * only treated 5xx as a failure, so that 406 read as "rendered" — which is to say, as a
 * FALSE BLOCK by the check. It was a hole in the probe. A transport that cannot carry
 * the answer must say so rather than supply one.
 */
async function render({ url, email, token }, content) {
  const response = await fetch(`${url}/api/app_builder/liquid_exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      InstanceDomain: url,
      Authorization: email ? `Token token=${token}, email=${email}` : `Token ${token}`,
    },
    body: JSON.stringify({ content }),
  });

  if (response.status !== 200) {
    return { outcome: 'unmeasured', detail: `HTTP ${response.status}` };
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    return { outcome: 'unmeasured', detail: `unparseable response: ${error.message}` };
  }

  if (body?.error) return { outcome: 'raised', detail: String(body.error) };
  return { outcome: 'rendered', detail: String(body?.result ?? '') };
}

/**
 * Every filter NAME the check can report on, mapped to the spelling that makes it do so.
 *
 * ALIASES COUNT, AND THAT IS NOT A DETAIL. `AugmentedPlatformOSDocset.expandAliases`
 * re-emits each entry under every one of its aliases, `return_type` and all, so the check
 * reports on `to_json`, `t`, `select`, `sort_by` and 21 more names that appear nowhere in
 * `filters.json` as filters in their own right. A sweep over the raw docset would cover
 * 138 names and silently miss 25 — including `map_attributes`, one of the four filters
 * whose arity the runtime could not even be made to state.
 *
 * The order below mirrors the augmentation exactly (official, then aliases), because the
 * check builds a Map keyed by name and the LAST entry wins. `map` and `split` are each
 * listed twice in the docset for the same reason.
 */
function reportingFilters(docs) {
  const byName = new Map();
  for (const filter of [...docs, ...docs.flatMap(aliasEntries)]) {
    const returnType = filter.return_type;
    const spelling = spellingOf(returnType);

    // Mirrors `variableTypeOf`: the gap table answers ONLY where the docset has no data,
    // never over a spelling it declines to interpret.
    const modelled = hasNoReturnTypeData(returnType)
      ? RETURN_TYPE_GAPS[filter.name]
      : REPORTING_SPELLINGS[spelling];

    if (!modelled) continue;
    byName.set(filter.name, { spelling, modelled });
  }
  return byName;
}

/** One entry per alias, carrying the parent's return type — as the augmentation does. */
function aliasEntries(filter) {
  return (filter.aliases ?? []).map((alias) => ({ ...filter, name: alias, aliasOf: filter.name }));
}

/**
 * An alias's invocation, derived from its parent's by swapping the filter name.
 *
 * DERIVED RATHER THAN DUPLICATED so the two cannot drift: an alias is the same underlying
 * filter, so it takes the same arguments, and writing 25 more calls by hand would mean 25
 * more chances to fix one and forget the other. The substitution is asserted to have
 * changed something — a silent no-op would sweep the parent twice and report full
 * coverage.
 */
function aliasInvocation(invocations, alias, parent) {
  const parentCall = invocations[parent];
  if (!parentCall) return null;
  const swapped = parentCall.replace(new RegExp(`\\| ${parent}\\b`), `| ${alias}`);
  return swapped === parentCall ? null : swapped;
}

/**
 * The filters that report NOTHING, split by WHY they are silent.
 *
 * The two reasons are not the same fact and must not be recorded as one. `hash` is a
 * spelling the check RECOGNISES: it maps to `object`, and a Hash is a legitimate
 * `hash_assign` target, so silence there is a correct verdict. Everything else is a
 * spelling the check REFUSES to interpret, so it maps to `untyped` and the silence is an
 * admission of ignorance — safe, because an unrecognised return type costs a missed
 * detection rather than a false block, but not the same thing at all.
 *
 * Recorded so both populations are VISIBLE. "Which filters does this check say nothing
 * about, and why" was otherwise answerable only by re-deriving it from `filters.json` by
 * hand, which is how a new spelling gets added and nobody notices the check went blind
 * to a whole group.
 */
function silentFilters(docs, reporting) {
  const untypedBySpelling = new Map();
  const hashFilters = new Set();

  // Aliases included for the same reason the reporting set includes them: the check sees
  // `nl2br`, `to_hash` and `dig` as filters, so a listing of what it says nothing about
  // is incomplete without them.
  for (const filter of [...docs, ...docs.flatMap(aliasEntries)]) {
    const returnType = filter.return_type;
    const spelling = spellingOf(returnType);

    if (reporting.has(filter.name)) continue;
    if (spelling === 'hash') {
      hashFilters.add(filter.name);
      continue;
    }
    if (!untypedBySpelling.has(spelling)) untypedBySpelling.set(spelling, new Set());
    untypedBySpelling.get(spelling).add(filter.name);
  }

  return { untypedBySpelling, hashFilters };
}

async function probe(auth, name, expression) {
  const assign = `${PREAMBLE}{% assign x = ${expression} %}`;
  const typeOf = await render(auth, `${assign}[{{ x | type_of }}]`);
  const key = await render(auth, `${assign}{% hash_assign x['k'] = 'v' %}OK`);
  const index = await render(auth, `${assign}{% hash_assign x[0] = 'v' %}OK`);

  return {
    name,
    // `null` when the invocation itself failed, which makes the row's other
    // measurements uninterpretable and is reported as such.
    runtime_type:
      typeOf.outcome === 'rendered' ? (typeOf.detail.match(/^\[(.*)\]$/)?.[1] ?? null) : null,
    invocation_error: typeOf.outcome === 'rendered' ? null : typeOf.detail.slice(0, 200),
    key_assign: key.outcome,
    index_assign: index.outcome,
  };
}

function renderModule({ rows, silent, reporting, aliasOf, url, generatedAt }) {
  const entries = rows
    .map(
      (row) =>
        `  {\n` +
        `    name: '${row.name}',\n` +
        (aliasOf.has(row.name) ? `    aliasOf: '${aliasOf.get(row.name)}',\n` : '') +
        `    docsetSpelling: ${JSON.stringify(reporting.get(row.name).spelling)},\n` +
        `    modelled: '${reporting.get(row.name).modelled}',\n` +
        `    runtimeType: ${row.runtime_type === null ? 'null' : `'${row.runtime_type}'`},\n` +
        `    keyAssign: '${row.key_assign}',\n` +
        `    indexAssign: '${row.index_assign}',\n` +
        `  },`,
    )
    .join('\n');

  const untypedEntries = [...silent.untypedBySpelling.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([spelling, names]) =>
        `  ${JSON.stringify(spelling)}: [${[...names]
          .sort()
          .map((n) => `'${n}'`)
          .join(', ')}],`,
    )
    .join('\n');

  const hashEntries = [...silent.hashFilters]
    .sort()
    .map((name) => `  '${name}',`)
    .join('\n');

  const unmeasured = rows.filter(
    (row) => row.key_assign === 'unmeasured' || row.index_assign === 'unmeasured',
  );
  const unmeasuredNote = unmeasured.length
    ? `:\n//            ${unmeasured.map((row) => row.name).join(', ')}`
    : '';

  return `// WARNING:
// This file was generated by "scripts/verify-filter-return-types.mjs".
// Do not modify manually. Your changes will be overwritten.
//
// Every filter whose docset return_type makes InvalidHashAssignTarget willing to REPORT,
// measured against a live platformOS instance: what the value actually is, and what
// hash_assign actually does to it with each kind of subscript.
//
// Instance:  ${url}
// Generated: ${generatedAt}
// Measured:  ${rows.length} filters; ${unmeasured.length} could not be measured
//            through the transport${unmeasuredNote}

/** What a probe found, or \`unmeasured\` when the transport could not carry the answer. */
export type RuntimeOutcome = 'raised' | 'rendered' | 'unmeasured';

/** One filter's measured behaviour as a \`hash_assign\` target. */
export interface FilterReturnTypeMeasurement {
  /** Filter name, as the check reads it off the last filter in a pipeline. */
  name: string;
  /**
   * Set when this name exists only because \`AugmentedPlatformOSDocset.expandAliases\`
   * re-emitted a docset entry under it — naming the entry it was copied from.
   *
   * These names appear NOWHERE in \`filters.json\` as filters of their own, and the check
   * reports on every one of them. Sweeping only the raw docset would cover 138 names and
   * miss 25, so the distinction is recorded rather than left to be rediscovered.
   */
  aliasOf?: string;
  /**
   * How the docset spells this filter's return type.
   *
   * \`"(absent)"\` and \`""\` are the two DATA HOLES — \`new_line_to_br\` carries no
   * \`return_type\` and \`array_index_of\` carries one whose \`type\` is empty. Those rows are
   * typed by measurement alone, through \`DOCSET_RETURN_TYPE_GAPS\`, and are the only
   * evidence that table has.
   */
  docsetSpelling: string;
  /** The type \`variableTypeOf\` derives from that spelling — what the check acts on. */
  modelled: 'string' | 'array' | 'number' | 'boolean' | 'date' | 'time';
  /**
   * What \`{{ x | type_of }}\` reported, or null if the invocation did not render.
   *
   * A DIAGNOSIS, NOT THE VERDICT. Several of these are not the plain class the docset
   * names — \`ActiveSupport::SafeBuffer\` for the html-producing string filters,
   * \`JOSE::EncryptedBinary\` for jwe_encode, \`Float\` where the docset says number — and
   * every one of them still behaves exactly as its docset spelling predicts. The
   * settlement is {@link keyAssign} / {@link indexAssign}; this field is here to explain
   * a disagreement, not to decide one.
   */
  runtimeType: string | null;
  /** What \`{% hash_assign x['k'] = … %}\` did. */
  keyAssign: RuntimeOutcome;
  /** What \`{% hash_assign x[0] = … %}\` did. */
  indexAssign: RuntimeOutcome;
}

/**
 * The sweep, one row per filter, sorted by name.
 *
 * Consumed by \`index.spec.ts\`'s sweep groups, which run the real check over the
 * real docset and assert that its verdict matches these measurements for every row. A
 * docset update that changes a return_type therefore fails a test instead of silently
 * changing what the server refuses to write.
 */
export const FILTER_RETURN_TYPE_ORACLE: readonly FilterReturnTypeMeasurement[] = [
${entries}
];

/**
 * The filters the check treats as UNTYPED, grouped by the docset spelling it refused to
 * interpret.
 *
 * These are the deliberately-blind population: nothing is ever reported for them, no
 * matter what the target turns out to be. That is the safe direction — an unrecognised
 * return type costs a missed detection, never a false block — but it should be VISIBLE.
 * A NEW SPELLING APPEARING HERE IS A GROUP OF FILTERS THE CHECK JUST WENT BLIND TO, and
 * the spec pins this map so that arrives as a failure rather than as silence.
 */
export const UNTYPED_RETURN_TYPE_SPELLINGS: Readonly<Record<string, readonly string[]>> = {
${untypedEntries}
};

/**
 * Filters the docset types as \`hash\`, which the check maps to \`object\`.
 *
 * Silent for the OPPOSITE reason to {@link UNTYPED_RETURN_TYPE_SPELLINGS}: a Hash is a
 * legitimate \`hash_assign\` target, so saying nothing about these is a correct verdict
 * rather than an admission of ignorance. Listed separately so the two are never read as
 * one population.
 */
export const HASH_RETURN_TYPE_FILTERS: readonly string[] = [
${hashEntries}
];
`;
}

const auth = credentials();
const docs = JSON.parse(await readFile(DOCS_FILTERS, 'utf8'));
const reporting = reportingFilters(docs);
const silent = silentFilters(docs, reporting);
const invocations = INVOCATIONS(ephemeralKeys());

// Aliases are filled in from their parents before the coverage gate runs, so the gate
// only ever complains about a name nothing can supply a call for.
const aliasOf = new Map();
for (const filter of docs) {
  for (const alias of filter.aliases ?? []) {
    if (!reporting.has(alias)) continue;
    aliasOf.set(alias, filter.name);
    if (alias in invocations) continue;
    const derived = aliasInvocation(invocations, alias, filter.name);
    if (derived) invocations[alias] = derived;
  }
}

const missing = [...reporting.keys()].filter((name) => !(name in invocations));
const extra = Object.keys(invocations).filter((name) => !reporting.has(name));
if (missing.length || extra.length) {
  console.error('The invocation table and the docset disagree about which filters report.');
  if (missing.length) console.error(`  no invocation for: ${missing.join(', ')}`);
  if (extra.length) console.error(`  no longer reporting: ${extra.join(', ')}`);
  console.error('\nFix INVOCATIONS in this script and re-run. Nothing was written.');
  process.exit(1);
}

const names = [...reporting.keys()].sort();
console.log(`sweeping ${names.length} reporting filters against ${auth.url}\n`);

const rows = new Array(names.length);
let cursor = 0;
async function worker() {
  while (cursor < names.length) {
    const index = cursor++;
    const name = names[index];
    try {
      rows[index] = await probe(auth, name, invocations[name]);
    } catch (error) {
      rows[index] = {
        name,
        runtime_type: null,
        invocation_error: `probe failed: ${error.message}`,
        key_assign: 'unmeasured',
        index_assign: 'unmeasured',
      };
    }
    const row = rows[index];
    console.log(
      `${row.invocation_error ? '!! ' : '   '}${name.padEnd(24)} ${reporting
        .get(name)
        .spelling.padEnd(16)} -> ${reporting.get(name).modelled.padEnd(8)} runtime=${String(
        row.runtime_type,
      ).padEnd(26)} key=${row.key_assign.padEnd(10)} index=${row.index_assign.padEnd(10)} ${(
        row.invocation_error ?? ''
      )
        .replace(/\s+/g, ' ')
        .slice(0, 90)}`,
    );
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const broken = rows.filter((row) => row.invocation_error);
if (broken.length) {
  console.error(
    `\n${broken.length} invocation(s) did not render, so their rows are not interpretable:`,
  );
  for (const row of broken) console.error(`  ${row.name}: ${row.invocation_error}`);
  console.error('\nFix INVOCATIONS in this script and re-run. Nothing was written.');
  process.exit(1);
}

// Formatted before it is written, not after. A generated file that only becomes
// committable once someone remembers to run the formatter shows up as a dirty tree on
// every regeneration, and `format:check` fails in CI for a file nobody edited.
const source = renderModule({
  rows,
  silent,
  reporting,
  aliasOf,
  url: auth.url,
  generatedAt: new Date().toISOString().slice(0, 10),
});
const prettier = await import('prettier');
const options = (await prettier.resolveConfig(OUTPUT)) ?? {};
await writeFile(OUTPUT, await prettier.format(source, { ...options, filepath: OUTPUT }), 'utf8');

const unmeasured = rows.filter(
  (row) => row.key_assign === 'unmeasured' || row.index_assign === 'unmeasured',
);
console.log(
  `\nWrote ${rows.length} measurements (${unmeasured.length} unmeasured through the transport) to ${OUTPUT}`,
);
