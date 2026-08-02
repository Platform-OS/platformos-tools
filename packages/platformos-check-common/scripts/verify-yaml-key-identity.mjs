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

  // sexagesimal, a 1.1-only form
  '1:30', '90',

  // nulls
  'null', 'Null', 'NULL', '~', 'nil',

  // quoted — always strings, and the control for every unquoted case above
  "'true'", "'yes'", "'1'", '"1"', '"yes"', '"null"',

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
  const script = `
    require 'yaml'
    require 'json'
    out = {}
    TOKENS.each do |tok|
      begin
        h = YAML.load(tok + ": v\\n")
        if h.is_a?(Hash) && h.size == 1
          k = h.keys.first
          out[tok] = { 'klass' => k.class.name, 'value' => k.inspect }
        else
          out[tok] = { 'klass' => 'UNEXPECTED', 'value' => h.inspect }
        end
      rescue => e
        out[tok] = { 'klass' => 'ERROR', 'value' => e.class.name }
      end
    end
    puts JSON.generate(out)
  `;

  const preamble = `TOKENS = ${JSON.stringify(tokens)}\n`;
  const stdout = execFileSync('ruby', ['-e', preamble + script], { encoding: 'utf8' });
  return JSON.parse(stdout);
}

function rubyVersion() {
  return execFileSync('ruby', ['-ryaml', '-e', 'print "ruby #{RUBY_VERSION}, psych #{Psych::VERSION}"'], {
    encoding: 'utf8',
  });
}

function renderModule(resolved, version, generatedAt) {
  const entries = Object.entries(resolved)
    .map(([token, { klass, value }]) => {
      // The IDENTITY is class plus value: two keys collide iff Ruby produces equal
      // objects, and `1` / `1.0` are equal numerically but not `eql?`, which is what a
      // Hash uses.
      return `  ${JSON.stringify(token)}: { klass: ${JSON.stringify(klass)}, value: ${JSON.stringify(value)} },`;
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
