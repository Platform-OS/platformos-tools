#!/usr/bin/env node
/**
 * Regenerate `src/registered-tags.ts` from the platform's OWN Liquid tag registry.
 *
 * WHY THIS EXISTS. Our tag vocabulary came from two sources, and both are incomplete in
 * the same direction. The grammar is a fork of Shopify's, so it carries tags platformOS
 * lacks and lacks tags platformOS carries; the docs API's `tags.json` is generated from
 * `@tag_name` YARD annotations, so it lists each tag ONCE under its canonical name and
 * silently omits every alias the platform also registers. `UnknownTag` consults exactly
 * those two, which is why eight registered tags were reported as unknown — and because
 * `LiquidHTMLSyntaxError` is a BLOCKING check in the MCP supervisor, each was an
 * unappealable refusal of code the platform runs (TASK-56).
 *
 * WHAT THE SOURCE OF TRUTH IS. Not the docs, and not a probe. `config/initializers/
 * liquid_view.rb` in the platform repo is the only non-test file calling `register_tag`,
 * so it IS the vocabulary: Liquid's built-ins arrive from the gem, and every platformOS
 * addition is one line here.
 *
 * WHY IT BEATS PROBING AN INSTANCE. A probe answers one direction only. `{% x %}` coming
 * back `Unknown tag 'x'` proves the platform lacks `x`, so a probe can find tags we
 * WRONGLY ACCEPT — that is how `{% layout %}` was caught (TASK-44). It can never find a
 * tag the platform HAS and we lack, because there is nothing to enumerate. The registry
 * answers both directions at once, and the eight false blocks fell out of it immediately.
 *
 * FAITHFUL TRANSCRIPTION, NOT INTERPRETATION. This script copies out names, handler
 * classes and the comments beside them, and nothing else. Which of those are aliases,
 * which are deprecated, and which are merely undocumented is decided in
 * `AugmentedPlatformOSDocset` against the LIVE docset — deliberately, because the docset
 * is re-downloaded by the docs-updater's `postbuild` and a gap computed here would go
 * stale the next time the docs gain a tag, silently and in the dangerous direction.
 *
 * HOW A LATER PLATFORM CHANGE SURFACES. Re-running this reports the answer as a DIFF rather
 * than as a user report: a tag the platform adds appears in `src/registered-tags.ts`, and
 * `registered-tags.spec.ts` pins the name list whole, so the regeneration fails the suite
 * until someone reads what changed. A tag the platform REMOVES fails the same way. That is
 * the point of pinning a generated file rather than asserting it is non-empty.
 *
 * NOT RUN IN CI, deliberately: it needs a checkout of the platform repo. Run it by hand
 * when the platform's registry changes, and commit the regenerated file.
 *
 *   node scripts/verify-registered-tags.mjs --repo /path/to/platform-repo
 *
 * The path may also come from POS_PLATFORM_REPO.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');
const OUTPUT = resolve(PACKAGE_ROOT, 'src', 'registered-tags.ts');
const REGISTRY_RELATIVE = 'config/initializers/liquid_view.rb';

/**
 * One `register_tag` line, with the comment that annotates it.
 *
 * A trailing comment belongs to its own line. A comment on the line ABOVE is captured
 * too, because that is where the platform put the one that matters most: `render_form`'s
 * "For semi-backwards compatibility, for now..." sits above the call, and reading only
 * trailing comments would have recorded the one genuinely-superseded alias as unmarked.
 */
const REGISTER_TAG =
  /^[ \t]*Liquid::Environment\.default\.register_tag\(\s*'([^']+)'\s*,\s*([A-Za-z0-9_:]+)\s*\)[ \t]*(?:#[ \t]*(.*?))?[ \t]*$/;
const COMMENT_LINE = /^[ \t]*#[ \t]*(.*?)[ \t]*$/;

/**
 * Names that MUST come out of the registry.
 *
 * A shape assertion, not documentation. The extraction is a regex over another project's
 * source, so the realistic failure is that the platform reformats those calls and the
 * regex matches nothing or half of them — and a silently-short list is the dangerous
 * outcome, since a name missing from it goes back to being a false block with no test
 * anywhere noticing. These four are load-bearing platformOS tags; if any is absent, the
 * extraction is broken rather than the platform changed.
 */
const REQUIRED_NAMES = ['graphql', 'function', 'try', 'yield'];

/** Below this, assume the extraction broke rather than that the platform shrank. */
const MINIMUM_TAGS = 20;

/** Below this, assume every line matched the same way — a uniform, fictional answer. */
const MINIMUM_DISTINCT_HANDLERS = 15;

/** Prettier's `printWidth` for this repo. Mirrored so the output needs no reformatting. */
const PRINT_WIDTH = 100;

function repoPath() {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 2) {
    args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
  }
  const repo = args.get('repo') ?? process.env.POS_PLATFORM_REPO;

  if (!repo) {
    console.error(
      'Need a checkout of the platform repo. Pass --repo /path/to/repo, or set POS_PLATFORM_REPO.',
    );
    process.exit(1);
  }
  return resolve(repo);
}

/**
 * Pull every `register_tag` call out of the registry, in source order.
 *
 * Line-by-line rather than a global regex so the preceding comment can be attributed:
 * `lastComment` is the comment block immediately above, and it is cleared by any other
 * line so a comment three calls up is never mis-attached.
 */
function extract(source) {
  const tags = [];
  let lastComment;

  for (const line of source.split('\n')) {
    const registration = line.match(REGISTER_TAG);
    if (registration) {
      const [, name, handler, trailingComment] = registration;
      tags.push({
        name,
        handler,
        comment: trailingComment || undefined,
        precedingComment: lastComment,
      });
      lastComment = undefined;
      continue;
    }

    const comment = line.match(COMMENT_LINE);
    lastComment = comment ? comment[1] || undefined : undefined;
  }

  return tags;
}

/** Fail loudly on any answer that is plausible but not real. */
function assertShape(tags, registryFile) {
  const fail = (reason) => {
    console.error(`Refusing to write ${OUTPUT}: ${reason}`);
    console.error(`Read ${registryFile} — extraction found ${tags.length} registrations.`);
    process.exit(1);
  };

  if (tags.length === 0) fail('extracted NOTHING from the registry');
  if (tags.length < MINIMUM_TAGS) fail(`extracted only ${tags.length} tags (< ${MINIMUM_TAGS})`);

  const distinctHandlers = new Set(tags.map((tag) => tag.handler));
  if (distinctHandlers.size < MINIMUM_DISTINCT_HANDLERS) {
    fail(`only ${distinctHandlers.size} distinct handler classes (< ${MINIMUM_DISTINCT_HANDLERS})`);
  }

  const missing = REQUIRED_NAMES.filter((name) => !tags.some((tag) => tag.name === name));
  if (missing.length > 0) fail(`required tags absent: ${missing.join(', ')}`);

  const malformed = tags.filter(
    (tag) => !/^[a-z_][a-z0-9_]*$/.test(tag.name) || !/^Liquify::Tags::\w+$/.test(tag.handler),
  );
  if (malformed.length > 0) {
    fail(`malformed entries: ${malformed.map((tag) => `${tag.name}=${tag.handler}`).join(', ')}`);
  }

  const duplicated = tags.map((tag) => tag.name).filter((name, i, all) => all.indexOf(name) !== i);
  if (duplicated.length > 0) fail(`the same name registered twice: ${duplicated.join(', ')}`);
}

/**
 * Quote a string the way Prettier would, so the generated file passes `format:check`.
 *
 * Prettier picks whichever quote needs fewer escapes and prefers single on a tie (this
 * repo sets `singleQuote: true`). Registry comments are arbitrary text from another
 * project — `hash_assign`'s mentions `{% assign %}` today — so the choice cannot be
 * hardcoded.
 */
function quote(value) {
  const singles = (value.match(/'/g) ?? []).length;
  const doubles = (value.match(/"/g) ?? []).length;
  const [q, other] = singles > doubles ? ['"', "'"] : ["'", '"'];
  const escaped = value.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), `\\${q}`);
  return `${q}${escaped.replace(new RegExp(`\\\\${other}`, 'g'), other)}${q}`;
}

/**
 * Emit one object literal, omitting the comment fields the registry does not carry.
 *
 * Wraps at Prettier's 100-column print width rather than delegating to `prettier --write`
 * afterwards: formatting inside the generator is what makes regenerating an unchanged
 * registry produce a byte-identical file.
 */
function renderEntry({ name, handler, comment, precedingComment }) {
  const fields = [`name: ${quote(name)}`, `handler: ${quote(handler)}`];
  if (comment) fields.push(`comment: ${quote(comment)}`);
  if (precedingComment) fields.push(`precedingComment: ${quote(precedingComment)}`);

  const inline = `  { ${fields.join(', ')} },`;
  if (inline.length <= PRINT_WIDTH) return inline;

  return ['  {', ...fields.map((field) => `    ${field},`), '  },'].join('\n');
}

function render(tags, registryFile, generatedAt) {
  // Formatted here, not by a later `prettier --write`, so regenerating an unchanged
  // registry produces a byte-identical file.
  const entries = tags.map(renderEntry).join('\n');

  return `// WARNING:
// This file was generated by "scripts/verify-registered-tags.mjs".
// Do not modify manually. Your changes will be overwritten.
//
// Transcribed from the platform's own Liquid tag registry — the only non-test file
// calling \`register_tag\`. Liquid's built-in tags come from the gem and are therefore
// absent here; everything below is a platformOS addition.
//
// Registry:  ${registryFile}
// Generated: ${generatedAt}

/** One \`register_tag\` line, exactly as the platform wrote it. */
export interface RegisteredTag {
  /** The tag name authors write, e.g. \`graphql\` in \`{% graphql %}\`. */
  name: string;

  /**
   * The Ruby class handling it.
   *
   * Load-bearing, not decoration: two names sharing a handler are the SAME TAG under two
   * spellings. That is how the aliases are identified without guessing from the \`_rc\`
   * suffix — \`context_rc\` and \`context\` are both \`Liquify::Tags::ContextTag\`.
   */
  handler: string;

  /** Trailing comment on the registration line, if any — e.g. \`TODO: remove\`. */
  comment?: string;

  /** Comment on the line immediately above, if any. Cleared by any non-comment line. */
  precedingComment?: string;
}

/**
 * Every Liquid tag platformOS registers.
 *
 * THE VOCABULARY, not a supplement to it. Consulted by {@link AugmentedPlatformOSDocset},
 * which injects the entries the injected docset does not already carry so \`UnknownTag\`
 * stops refusing them. Membership matters in both directions:
 *
 *   - a name here that the platform does NOT register silences \`UnknownTag\` for it, so a
 *     genuinely misspelled tag clears the write gate and fails the whole deploy;
 *   - a registered name MISSING from here is reported as an unknown tag, and since
 *     \`LiquidHTMLSyntaxError\` blocks, the agent cannot write working code at all.
 *
 * Which of these are aliases, which are deprecated and which are merely undocumented is
 * NOT decided here — see \`AugmentedPlatformOSDocset\`. This file is a transcription, and
 * keeping it one is what lets it be regenerated and diffed.
 */
export const REGISTERED_TAGS: readonly RegisteredTag[] = [
${entries}
];
`;
}

const repo = repoPath();
const registryFile = resolve(repo, REGISTRY_RELATIVE);
const source = await readFile(registryFile, 'utf8');

const tags = extract(source);
assertShape(tags, registryFile);

tags.sort((a, b) => a.name.localeCompare(b.name));

for (const tag of tags) {
  const note = tag.comment ?? tag.precedingComment;
  console.log(`  ${tag.name.padEnd(18)} ${tag.handler.padEnd(38)}${note ? `# ${note}` : ''}`);
}

await writeFile(OUTPUT, render(tags, registryFile, new Date().toISOString().slice(0, 10)), 'utf8');
console.log(`\nWrote ${tags.length} registered tags to ${OUTPUT}`);
