import {
  LiquidTag,
  NamedTags,
  TAGS_WITHOUT_MARKUP,
  BLOCKS,
  RAW_TAGS,
} from '@platformos/liquid-html-parser';
import { Problem, SourceCodeType, TagEntry } from '../../..';

/**
 * All tag names known to the grammar (NamedTags enum + TAGS_WITHOUT_MARKUP + BLOCKS + RAW_TAGS).
 * These are tags that the parser recognizes with specific grammar rules.
 */
const GRAMMAR_KNOWN_TAGS = new Set<string>([
  ...Object.values(NamedTags),
  ...TAGS_WITHOUT_MARKUP,
  ...BLOCKS,
  ...RAW_TAGS,
  '#', // inline comment: {% # this is a comment %}
]);

/**
 * Tags an author is likely to reach for out of habit, with what platformOS wants instead.
 *
 * WHY A HINT AT ALL. "Unknown tag 'layout'" is accurate and useless: the author already knows
 * they wrote `layout`, and it reads like a typo rather than a missing feature. The tooling is
 * forked from Shopify's, so these are the tags a Shopify author brings with them — and the
 * failure is deploy-wide, since the converter rejects the file and takes the whole changeset.
 *
 * EVERY ENTRY IS A MEASUREMENT, never a guess. `layout` is here because `eval/`'s vocabulary
 * sweep put it there: all 50 tag names the grammar carries were run against
 * `/api/app_builder/liquid_exec`, and `layout` is the only one the platform answers
 * `Unknown tag` for. `ifchanged` was the other suspect — in the grammar, absent from the
 * docset — and it RENDERS, so it is not here.
 *
 * A remedy that is wrong is worse than no remedy, so a name goes in only once both halves are
 * measured: that the platform lacks the tag, and what it does instead.
 */
const PLATFORMOS_ALTERNATIVE: Readonly<Record<string, string>> = {
  layout:
    'platformOS has no layout tag — it selects a layout from the page frontmatter instead, ' +
    'e.g. `layout: application`.',
};

export function detectUnknownTag(
  node: LiquidTag,
  tags: TagEntry[] = [],
): Problem<SourceCodeType.LiquidHtml> | undefined {
  const tagName = node.name;

  // If the tag is known to the grammar, it's not unknown
  if (GRAMMAR_KNOWN_TAGS.has(tagName)) {
    return;
  }

  // If the tag is known to the docset, it's not unknown
  if (tags.some((tag) => tag.name === tagName)) {
    return;
  }

  const alternative = PLATFORMOS_ALTERNATIVE[tagName];

  return {
    message: alternative ? `Unknown tag '${tagName}'. ${alternative}` : `Unknown tag '${tagName}'`,
    startIndex: node.position.start,
    endIndex: node.position.end,
  };
}
