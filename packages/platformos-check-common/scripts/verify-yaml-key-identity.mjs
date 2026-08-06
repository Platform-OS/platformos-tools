#!/usr/bin/env node
/**
 * Regenerate `src/yaml/psych-key-identity.ts` by asking **Ruby Psych** how it resolves
 * YAML scalar keys — the only authority on which two keys collide on the platform.
 *
 * WHY THIS EXISTS. `check-common` parses YAML with npm `yaml`, which implements YAML
 * **1.2**. The platform parses with Psych/libyaml, which implements YAML **1.1**. The
 * duplicate-key check has to answer "does the platform see one key here or two", and
 * neither the npm parser nor the YAML 1.1 spec answers it reliably:
 *
 *   - npm 1.2 says `yes` is a string, Psych says boolean `true` -> a real duplicate,
 *     with a value silently discarded, went unreported.
 *   - npm (either version) cannot distinguish `1` from `1.0` — both are JS `number` 1 —
 *     while Psych keeps `Integer(1)` and `Float(1.0)` as two keys. That was a FALSE
 *     POSITIVE on legal input.
 *   - npm's 1.1 mode is not Psych either: it resolves `y`/`n` as booleans where Psych
 *     leaves them strings, and disagrees about sexagesimals (`1:30` -> 90 vs 5400).
 *
 * So the spec is not the oracle and neither parser is the oracle. Ruby is.
 *
 * NOT RUN IN CI: it needs a `ruby` on PATH, which CI is not guaranteed to have. Run it
 * by hand and commit the result, exactly like `verify-filter-arity.mjs` and
 * `verify-undocumented-filters.mjs` do with a live instance.
 *
 *   node scripts/verify-yaml-key-identity.mjs
 *
 * The generated file is consumed ONLY by `yaml/duplicate-keys.spec.ts`, which asserts
 * that the implementation's equivalence classes match Psych's for every token below.
 * It is not shipped: the check itself carries the rules, and this proves them.
 */
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(HERE, '..', 'src', 'yaml', 'psych-key-identity.ts');

/**
 * Scalar key tokens to resolve, chosen to cover every place YAML 1.1 and 1.2 disagree
 * plus the shapes a real translations or schema file actually contains.
 *
 * Written as SOURCE TEXT, because that is what the question is about: two different
 * spellings that may or may not become the same Ruby object.
 */
const TOKENS = [
  // booleans — the 1.1/1.2 fault line
  'true', 'True', 'TRUE', 'false', 'False', 'FALSE',
  'yes', 'Yes', 'YES', 'no', 'No', 'NO',
  'on', 'On', 'ON', 'off', 'Off', 'OFF',
  'y', 'Y', 'n', 'N',

  // integers, and the forms that alias onto them
  '0', '1', '12', '16', '1000', '5400',
  '+1', '-1', '0x10', '0X10', '014', '0o14', '1_000',

  // floats — distinct from integers to Ruby even at the same numeric value
  '1.0', '1.00', '-1.0', '1e3', '1.5', '.inf', '-.inf', '.nan',

  // SIGNED ZERO. Added because the spec's own collision predicate got this backwards: it
  // compared `inspect` strings, under which "-0.0" != "0.0", while a Ruby Hash collapses
  // them because `(-0.0).eql?(0.0)` is true. The flaw was latent purely because no signed
  // zero was in the corpus, so it is in the corpus now.
  '-0.0', '0.0', '+0.0',

  // ODD-CASED spellings. Psych's boolean and float resolution is case-insensitive well
  // beyond the three spellings the 1.1 spec lists, and npm's 1.1 mode is not: it leaves
  // these as strings. Probed because the final eval found them collapsing in Psych.
  'TrUe', 'oN', 'yEs', '.Inf', '.NaN',

  // sexagesimal, a 1.1-only form
  '1:30', '90',

  // nulls
  'null', 'Null', 'NULL', '~', 'nil',

  // quoted — always strings, and the control for every unquoted case above. The QUOTED
  // spellings of uncomparable tokens are here on purpose: `source` excludes the delimiters,
  // so nothing but the scalar's TYPE distinguishes `".inf"` from `.inf`, and those are a
  // String and a Float to Psych. Without these in the corpus that stayed a latent false
  // positive.
  "'true'", "'yes'", "'1'", '"1"', '"yes"', '"null"',
  '".inf"', '"0X10"', '"1e3"', '"y"', '"1:30"', '"TrUe"',

  // timestamps and ordinary strings
  '2026-01-01', 'abc', 'a b', 'title', 'en',
];

/**
 * Ask Ruby for the class and value of each token used as a mapping key.
 *
 * One `ruby` process for the whole corpus rather than one per token: the question is
 * about resolution, which has no cross-token state, and 60 process spawns to learn 60
 * independent facts is just slow.
 *
 * `YAML.load` is Ruby's SAFE loader in modern versions, which refuses to instantiate a
 * Date. That is recorded as `ERROR` rather than worked around — see the note on
 * timestamps in `duplicate-keys.ts`. Guessing which loader the platform uses would be
 * exactly the kind of assumption this generator exists to remove.
 */
function resolveWithPsych(tokens) {
  // Built by CONCATENATION, never by interpolation. A first version wrote the document
  // with Ruby string interpolation nested inside a JS template literal; the `#{...}`
  // was consumed by the wrong language and every token silently resolved to the literal
  // text `#{tok}`. All 61 answers came back identical, which is the only reason it was
  // noticed at all.
  // TWO questions are asked, and the second one is the one that matters.
  //
  // The RESOLUTION (class + inspect) is kept for diagnostics only — it makes a failing
  // assertion readable.
  //
  // The COLLISION GROUP is measured by loading an actual two-key document and asking whether
  // the Hash collapsed, which is literally the question the check has to answer. It replaces
  // a predicate in the spec that compared class + `inspect` and got signed zero backwards.
  //
  // Object identity would NOT be a safe proxy here, which is why this is measured per pair
  // rather than derived: two separately-parsed NaN objects are not `eql?`, yet
  // `.nan: x\n.nan: y` collapses to one key. The proxy and the reality disagree, so only the
  // reality is recorded.
  //
  // Groups are built by scanning for the first EARLIER token a token collides with, then the
  // result is checked for transitivity — if collision were not transitive, group ids would be
  // a lie and the generator fails loudly rather than emitting one.
  const script = `
    require 'yaml'
    require 'json'

    def resolve(tok)
      h = YAML.load(tok + ": v\\n")
      if h.is_a?(Hash) && h.size == 1
        k = h.keys.first
        { 'klass' => k.class.name, 'value' => k.inspect }
      else
        { 'klass' => 'UNEXPECTED', 'value' => h.inspect }
      end
    rescue => e
      { 'klass' => 'ERROR', 'value' => e.class.name }
    end

    def collides?(a, b)
      h = YAML.load(a + ": x\\n" + b + ": y\\n")
      h.is_a?(Hash) && h.size == 1
    rescue
      nil
    end

    out = {}
    TOKENS.each { |tok| out[tok] = resolve(tok) }

    comparable = TOKENS.reject { |t| %w[ERROR UNEXPECTED].include?(out[t]['klass']) }

    # first earlier token each one collides with, else itself
    rep = {}
    comparable.each_with_index do |tok, i|
      rep[tok] = tok
      comparable[0...i].each do |earlier|
        if collides?(earlier, tok)
          rep[tok] = rep[earlier]
          break
        end
      end
    end

    # TRANSITIVITY CHECK. Same group must imply collision and vice versa, or the group ids
    # do not describe what was measured.
    violations = []
    comparable.combination(2) do |a, b|
      measured = collides?(a, b)
      grouped = rep[a] == rep[b]
      violations << [a, b, measured, grouped] if measured != grouped
    end

    ids = {}
    comparable.each { |tok| ids[rep[tok]] ||= ids.size }
    comparable.each { |tok| out[tok]['group'] = ids[rep[tok]] }

    puts JSON.generate({ 'tokens' => out, 'violations' => violations })
  `;

  const preamble = `TOKENS = ${JSON.stringify(tokens)}\n`;
  const stdout = execFileSync('ruby', ['-e', preamble + script], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const { tokens: resolved, violations } = JSON.parse(stdout);

  if (violations.length > 0) {
    console.error(
      'Psych collision is NOT transitive over this corpus, so a per-token group id cannot\n' +
        'describe it. Refusing to emit a misleading oracle. Disagreeing pairs:\n' +
        violations
          .map(([a, b, measured, grouped]) => `  ${a} + ${b}: measured=${measured} grouped=${grouped}`)
          .join('\n'),
    );
    process.exit(1);
  }

  return resolved;
}

function rubyVersion() {
  return execFileSync('ruby', ['-ryaml', '-e', 'print "ruby #{RUBY_VERSION}, psych #{Psych::VERSION}"'], {
    encoding: 'utf8',
  });
}

function renderModule(resolved, version, generatedAt) {
  const entries = Object.entries(resolved)
    .map(([token, { klass, value, group }]) => {
      // `group` is the MEASURED equivalence class: two tokens share one iff a document
      // containing both as keys collapses to a single entry. `klass` and `value` are carried
      // for diagnostics only — deriving collision from them is what got signed zero wrong.
      const fields =
        `klass: ${JSON.stringify(klass)}, value: ${JSON.stringify(value)}` +
        (group === undefined ? '' : `, group: ${group}`);
      return `  ${JSON.stringify(token)}: { ${fields} },`;
    })
    .join('\n');

  return `// WARNING:
// This file was generated by "scripts/verify-yaml-key-identity.mjs".
// Do not modify manually. Your changes will be overwritten.
//
// How Ruby Psych — the platform's YAML parser — resolves each scalar token when it is
// used as a mapping key. Two keys collide on the platform iff their class AND value
// match, because that is what Ruby's Hash uses (\`eql?\`, not \`==\`).
//
// Measured with: ${version}
// Generated: ${generatedAt}

/** What Psych resolved one key token to. */
export interface PsychKeyIdentity {
  /** Ruby class name, e.g. \`Integer\`, \`Float\`, \`String\`, \`TrueClass\`, \`NilClass\`. */
  klass: string;
  /** \`inspect\` output, so \`1\` and \`1.0\` are distinguishable and quoting is visible. */
  value: string;
  /**
   * MEASURED equivalence class. Two tokens share a group iff Ruby collapses a document that
   * uses both as keys into a single entry — which is the question the duplicate-key check
   * has to answer, asked directly rather than derived from \`klass\`/\`value\`.
   *
   * Absent when Ruby refused the token, since an unresolvable key has no class to be in.
   */
  group?: number;
}

/**
 * Every probed token, keyed by its SOURCE TEXT.
 *
 * Consumed by \`duplicate-keys.spec.ts\`, which groups these into equivalence classes and
 * asserts the check agrees with every one — both where it must report a duplicate and
 * where it must stay silent.
 *
 * \`klass: 'ERROR'\` means Ruby's safe loader refused the token (timestamps), which is a
 * fact about the loader rather than about key identity; the spec treats those as
 * uncomparable rather than pretending to know.
 */
export const PSYCH_KEY_IDENTITY: Readonly<Record<string, PsychKeyIdentity>> = {
${entries}
};
`;
}

try {
  execFileSync('ruby', ['--version'], { stdio: 'ignore' });
} catch {
  console.error(
    'No `ruby` on PATH. This generator asks Psych directly because neither the YAML 1.1\n' +
      'spec nor the npm parser predicts what the platform does. Install ruby and re-run.',
  );
  process.exit(1);
}

const version = rubyVersion();
const resolved = resolveWithPsych(TOKENS);

const missing = TOKENS.filter((token) => !(token in resolved));
if (missing.length) {
  console.error(`Ruby did not answer for: ${missing.join(', ')}`);
  process.exit(1);
}

const source = renderModule(resolved, version, new Date().toISOString().slice(0, 10));
const prettier = await import('prettier');
const options = (await prettier.resolveConfig(OUTPUT)) ?? {};
await writeFile(OUTPUT, await prettier.format(source, { ...options, filepath: OUTPUT }), 'utf8');

for (const [token, { klass, value }] of Object.entries(resolved)) {
  console.log(`${token.padEnd(14)} ${klass.padEnd(12)} ${value}`);
}
console.log(`\nWrote ${TOKENS.length} token identities (${version}) to ${OUTPUT}`);
