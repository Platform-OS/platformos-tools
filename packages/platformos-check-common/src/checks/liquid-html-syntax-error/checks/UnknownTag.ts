import { LiquidTag, NamedTags, TAGS_WITHOUT_MARKUP, BLOCKS, RAW_TAGS } from '@platformos/liquid-html-parser';
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

  return {
    message: `Unknown tag '${tagName}'`,
    startIndex: node.position.start,
    endIndex: node.position.end,
  };
}
