import { REGISTERED_TAGS, RegisteredTag } from './registered-tags';
import { TagEntry } from './types';

/**
 * Tags that are valid in platformOS but absent from the docs API's `tags.json`.
 *
 * There are TWO populations here and they are verified differently, which is the whole
 * reason this module exists rather than one flat list:
 *
 *   1. Liquid SUB-TAGS and built-ins the docs omit — `elsif`, `when`, `ifchanged`. These
 *      come from the Liquid gem or from a block's `unknown_tag` hook, so they appear
 *      nowhere in platformOS's registry and can only be confirmed by rendering them.
 *   2. Tags platformOS REGISTERS but the docs do not list. `tags.json` is generated from
 *      `@tag_name` YARD annotations, and an annotation names one tag, so every additional
 *      spelling the platform registers under the same handler is invisible to it. These
 *      are read from {@link REGISTERED_TAGS}, transcribed from the registry itself.
 *
 * Both feed `AugmentedPlatformOSDocset.tags()`, and therefore `UnknownTag` — which
 * `LiquidHTMLSyntaxError` reports at ERROR severity and the MCP supervisor treats as
 * BLOCKING. A name missing from here is an unappealable refusal of code the platform
 * runs: that was the state of all eight registered tags below (TASK-56).
 */

/**
 * Sub-tags and built-ins missing from the docs, each PROVEN by rendering it.
 *
 * Hand-listed because there is nothing to derive them from — they are not registered, so
 * the registry cannot see them. Do not add a name here without rendering it on a real
 * instance first: an unverified entry silences `UnknownTag`, and a misspelled tag that
 * clears the write gate fails the whole deploy rather than one file.
 */
const UNREGISTERED_UNDOCUMENTED_TAGS: readonly string[] = ['elsif', 'ifchanged', 'when'];

/**
 * Registry text that states a registration is on its way out.
 *
 * Matched against the platform's OWN comment, never against the tag name. The `_rc`
 * suffix looks like it means "release candidate, will be removed", and for three of the
 * five it demonstrably does — but only because the registry says `TODO: remove` beside
 * them. `context_rc` and `try_rc` carry no such comment, so they are recorded as aliases
 * and NOT claimed to be deprecated. Reading deprecation off the name shape would be
 * inference dressed as measurement.
 */
const DEPRECATION_MARKER = /TODO:\s*remove|DEPRECATED|backwards compat/i;

/** The comment the platform wrote about this registration, wherever it put it. */
function registryNote(tag: RegisteredTag): string | undefined {
  return tag.comment ?? tag.precedingComment;
}

/**
 * The canonical spelling of a tag registered under more than one name.
 *
 * Identity comes from the HANDLER CLASS: two registrations pointing at the same Ruby
 * class are the same tag, which is a fact in the registry rather than a guess from the
 * names. Of the sibling names, the canonical one is whichever the docs document — the
 * docs annotate the class once, under the name the platform considers primary. Falls back
 * to the alphabetically-first sibling so the answer is deterministic even if the docs ever
 * document neither.
 */
function canonicalNameFor(
  tag: RegisteredTag,
  documentedNames: ReadonlySet<string>,
): string | undefined {
  const siblings = REGISTERED_TAGS.filter(
    (other) => other.handler === tag.handler && other.name !== tag.name,
  ).map((other) => other.name);

  if (siblings.length === 0) return undefined;

  const documented = siblings.filter((name) => documentedNames.has(name));
  return (documented.length > 0 ? documented : siblings).sort()[0];
}

function toTagEntry(tag: RegisteredTag, documentedNames: ReadonlySet<string>): TagEntry {
  const canonical = canonicalNameFor(tag, documentedNames);
  const note = registryNote(tag);
  const deprecated = note !== undefined && DEPRECATION_MARKER.test(note);

  const summary = canonical
    ? `Alias of \`{% ${canonical} %}\` — the platform registers both names against the same handler (\`${tag.handler}\`).`
    : `Registered by platformOS (\`${tag.handler}\`) but absent from the official tag documentation.`;

  if (!deprecated) return { name: tag.name, summary };

  // The registry's own wording is quoted rather than paraphrased: it is the evidence, and
  // an author reading the warning can go check it.
  const remedy = canonical
    ? `use \`{% ${canonical} %}\` instead`
    : 'the platform plans to remove it';
  return {
    name: tag.name,
    summary,
    deprecated: true,
    deprecation_reason: `${remedy} (the platform's registry says "${note}").`,
  };
}

/**
 * Every tag entry to add to a docset, given what that docset already documents.
 *
 * Takes the documented tags rather than importing `data/tags.json` on purpose. That file
 * is re-downloaded by the docs-updater's `postbuild`, so a gap computed at build time
 * would go stale exactly when the docs GAIN a tag — and it would go stale silently, in
 * the direction that keeps a redundant entry alive. Computing it against the docset that
 * is actually injected means the answer is always current, and the language server and
 * the CLI get the same one.
 */
export function undocumentedTagEntries(documented: readonly TagEntry[]): TagEntry[] {
  const documentedNames = new Set(documented.map((tag) => tag.name));

  const unregistered = UNREGISTERED_UNDOCUMENTED_TAGS.filter(
    (name) => !documentedNames.has(name),
  ).map((name) => ({ name }));

  const registered = REGISTERED_TAGS.filter((tag) => !documentedNames.has(tag.name)).map((tag) =>
    toTagEntry(tag, documentedNames),
  );

  return [...unregistered, ...registered];
}
