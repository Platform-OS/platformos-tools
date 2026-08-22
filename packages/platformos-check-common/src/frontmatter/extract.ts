import { Document, isMap, isScalar, parseDocument } from 'yaml';
import {
  FrontmatterSchema,
  getFrontmatterSchema,
  PlatformOSFileType,
} from '@platformos/platformos-common';

/** One `key: value` pair of a frontmatter block, with offsets into the `.liquid` file. */
export interface FrontmatterEntry {
  /** The parsed value, or `undefined` when the value is not a scalar (a map or a sequence). */
  jsValue: unknown;
  /** Range of the KEY. */
  absStart: number;
  absEnd: number;
  /** Range of the VALUE. Equal to the key range when there is no scalar value. */
  valueAbsStart: number;
  valueAbsEnd: number;
}

/**
 * A parsed frontmatter block, shared by every check that reads one.
 *
 * All offsets are absolute in the `.liquid` source, so a check reports a range without
 * knowing the block was extracted from a larger file.
 */
export interface FrontmatterBlock {
  /** The schema for this file's type. A file type with no schema has no block. */
  schema: FrontmatterSchema;
  /** Declared keys, in document order. */
  entries: ReadonlyMap<string, FrontmatterEntry>;
  /**
   * The parsed YAML document. Exposed because sequence-valued fields (the association
   * arrays) need the nodes rather than a scalar, and because `doc.errors` is the block's
   * own syntax report.
   */
  doc: Document.Parsed;
  /** Absolute offset of the first character of the YAML body. */
  bodyOffset: number;
  /** Absolute offset of the opening `---`. */
  frontmatterStart: number;
  /** Parse failures for the block, already offset into the `.liquid` file. */
  syntaxErrors: { message: string; startIndex: number; endIndex: number }[];
}

/**
 * Cache keyed on the file object, guarded by its source.
 *
 * Five checks read one block, and `parseDocument` costs ~80 µs — measured — so the
 * redundant parses would cost ~640 ms over a 2 000-page project. A `WeakMap` rather than
 * the size-1 cache used for the GraphQL SDL, because per-check pipelines interleave.
 *
 * The source guard matters: an `AppFile` object is reused when a buffer is re-read, so
 * identity alone would serve a stale block after every edit.
 */
const cache = new WeakMap<object, { source: string; block: FrontmatterBlock | undefined }>();

/**
 * Parse the frontmatter block of a Liquid file, or `undefined` when it has none — no leading
 * `---`, no closing `---`, or a file type that declares no frontmatter schema.
 */
export function frontmatterBlock(
  file: { source: string },
  fileType: PlatformOSFileType | undefined,
): FrontmatterBlock | undefined {
  const cached = cache.get(file);
  if (cached && cached.source === file.source) {
    return cached.block;
  }

  const block = extractFrontmatterBlock(file.source, fileType);
  cache.set(file, { source: file.source, block });
  return block;
}

function extractFrontmatterBlock(
  source: string,
  fileType: PlatformOSFileType | undefined,
): FrontmatterBlock | undefined {
  // Locate the frontmatter block — may be preceded by whitespace
  const trimmed = source.trimStart();
  if (!trimmed.startsWith('---')) return;

  const leadingLen = source.length - trimmed.length;
  const firstNewline = trimmed.indexOf('\n');
  if (firstNewline === -1) return;

  const afterOpening = trimmed.slice(firstNewline + 1);

  // The closing `---` may be the very first line of afterOpening (empty frontmatter)
  // or may follow a newline (normal frontmatter with content).
  let yamlBody: string;
  if (afterOpening.startsWith('---')) {
    yamlBody = '';
  } else {
    const closeIdx = afterOpening.indexOf('\n---');
    if (closeIdx === -1) return;
    yamlBody = afterOpening.slice(0, closeIdx);
  }
  // Absolute offset of the first character of yamlBody in source
  const bodyOffset = leadingLen + firstNewline + 1;

  const schema = getFrontmatterSchema(fileType);
  if (!schema) return;

  // Parse YAML with position tracking (yaml v2 provides range arrays).
  // Continue even when the document has parse errors — parseDocument is
  // lenient and still builds a partial map for the valid pairs it finds.
  // Normalize CRLF → LF so YAML values don't contain stray \r characters.
  const doc = parseDocument(yamlBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));

  // Only populate entries when the document parsed to a map (non-empty frontmatter).
  // When frontmatter is empty (`---\n---\n`) doc.contents is null — entries stays empty,
  // which is the correct input for a required-field rule.
  const entries = new Map<string, FrontmatterEntry>();
  if (isMap(doc.contents)) {
    for (const pair of doc.contents.items) {
      const keyNode = pair.key;
      if (!isScalar(keyNode) || typeof keyNode.value !== 'string') continue;
      const [ks = 0, ke = 0] = keyNode.range ?? [];
      const valNode = isScalar(pair.value) ? pair.value : undefined;
      const jsValue = valNode?.value;
      const [vs = 0, ve = 0] = valNode?.range ?? [];
      entries.set(keyNode.value, {
        jsValue,
        absStart: bodyOffset + ks,
        absEnd: bodyOffset + ke,
        valueAbsStart: bodyOffset + vs,
        valueAbsEnd: bodyOffset + ve,
      });
    }
  }

  return {
    schema,
    entries,
    doc,
    bodyOffset,
    frontmatterStart: leadingLen, // position of opening `---`
    syntaxErrors: doc.errors.map((error) => {
      const [start = 0, end = 0] = error.pos ?? [];
      return {
        message: error.message,
        startIndex: bodyOffset + start,
        endIndex: bodyOffset + end,
      };
    }),
  };
}

/**
 * The block, but only when it parsed cleanly.
 *
 * Every rule about FIELDS reads through this. `parseDocument` recovers and returns a partial
 * map, so those rules would otherwise report on the half of a broken block that happened to
 * survive — one mistake producing several unrelated diagnostics. `InvalidFrontmatterSyntax`
 * reads the raw block instead and is the one thing that speaks for a malformed one.
 */
export function wellFormedFrontmatterBlock(
  file: { source: string },
  fileType: PlatformOSFileType | undefined,
): FrontmatterBlock | undefined {
  const block = frontmatterBlock(file, fileType);
  return block && block.syntaxErrors.length === 0 ? block : undefined;
}
