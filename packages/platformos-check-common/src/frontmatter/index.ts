// Frontmatter schemas and types live in platformos-common so they can be used
// by other packages without depending on the full linting engine.
export {
  type FrontmatterFieldType,
  type FrontmatterFieldSchema,
  type FrontmatterSchema,
  FRONTMATTER_SCHEMAS,
  getFrontmatterSchema,
} from '@platformos/platformos-common';
