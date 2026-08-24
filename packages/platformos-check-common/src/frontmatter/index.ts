// Frontmatter schemas, block extraction and its types live in platformos-common so they can
// be used by other packages without depending on the full linting engine.
export {
  type FrontmatterFieldType,
  type FrontmatterFieldSchema,
  type FrontmatterSchema,
  type FrontmatterEntry,
  type FrontmatterBlock,
  FRONTMATTER_SCHEMAS,
  getFrontmatterSchema,
  extractFrontmatterBlock,
  frontmatterBlock,
  wellFormedFrontmatterBlock,
} from '@platformos/platformos-common';
