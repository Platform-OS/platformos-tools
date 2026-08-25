import { Document, isMap, isScalar, parseDocument } from 'yaml';
import type { AppFile } from '../app';
import { PlatformOSFileType } from '../path-utils';
import { normalizeLoneCarriageReturns } from '../yaml-line-breaks';
import { FrontmatterSchema, getFrontmatterSchema } from './schemas';

/**
 * How frontmatter YAML is read, matching what the platform's own parser does.
 *
 * `uniqueKeys: false` because A REPEATED KEY IS NOT A PARSE FAILURE. The platform parses
 * frontmatter with `SafeYAML.load` (Psych) and rescues only `Psych::SyntaxError`, so a
 * repeated key is accepted and resolved LAST-WINS — measured end to end by syncing a page
 * whose `slug` was declared twice: it deployed, the first slug 404s and the second serves.
 * The library defaults this to `true`, which made the duplicate a `doc.errors` entry, and
 * since every field rule reads through {@link wellFormedFrontmatterBlock} that one legal
 * key silently suppressed every real finding in the block.
 *
 * `prettyErrors: false` because the pretty form appends the source line and a caret diagram
 * to `error.message`, and that message is reported verbatim as an offense.
 *
 * The same two options, for the same reasons, are passed by `check-common`'s `yaml/parse.ts`
 * and `yaml/duplicate-keys.ts`.
 */
const FRONTMATTER_PARSE_OPTIONS = { prettyErrors: false, uniqueKeys: false } as const;

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
 * A parsed frontmatter block, shared by every consumer that reads one.
 *
 * All offsets are absolute in the `.liquid` source, so a consumer reports a range without
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
  /**
   * The YAML body exactly as it appears in the file, unnormalized.
   *
   * For a consumer that needs to run its OWN parse over the block — `findDuplicateKeys`
   * re-reads it at YAML 1.1 to settle key identity the way Psych would. Offsets from such a
   * parse are relative to this string, so {@link bodyOffset} places them in the file.
   */
  body: string;
  /** Absolute offset of the first character of the YAML body. */
  bodyOffset: number;
  /** Absolute offset of the opening `---`. */
  frontmatterStart: number;
  /** Parse failures for the block, already offset into the `.liquid` file. */
  syntaxErrors: { message: string; startIndex: number; endIndex: number }[];
}

/**
 * Parse the frontmatter block of a Liquid file, or `undefined` when it has none — no leading
 * `---`, no closing `---`, or a file type that declares no frontmatter schema.
 *
 * THE DELIMITERS ARE FOUND BY SCANNING THE STRING, not by reading the parser's
 * `YAMLFrontmatter` node, and that is deliberate twice over. This package sits below the
 * parser stack, so it cannot import one; and reading the node would make every frontmatter
 * finding conditional on the Liquid file PARSING — an unrelated syntax error elsewhere in
 * the file would silently produce no frontmatter findings at all.
 *
 * Pure: no caching, no file object. {@link frontmatterBlock} is the memoized form.
 */
export function extractFrontmatterBlock(
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
  //
  // ONLY A LONE `\r` IS REWRITTEN, one byte for one byte, so every `range` below is still an
  // offset into `yamlBody` and `bodyOffset + range` is still an offset into the file. This
  // used to collapse `\r\n` to `\n` as well, which shortens the string: on a CRLF file every
  // entry after the first pointed a byte further left per preceding line.
  //
  // The CRLF pass was not merely harmful, it was unnecessary — `parseDocument` reads `\r\n`
  // natively and yields scalars with no stray `\r`, block and quoted alike. The lone-`\r`
  // pass IS load-bearing, and not only for classic-Mac files: `yamlBody` ends at the `\n`
  // before the closing fence, so on any CRLF file its last byte is a lone `\r` that would
  // otherwise ride along into the final entry's value.
  const doc = parseDocument(normalizeLoneCarriageReturns(yamlBody), FRONTMATTER_PARSE_OPTIONS);

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
    body: yamlBody,
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
 * {@link extractFrontmatterBlock}, memoized for as long as the file's contents stand.
 *
 * Six checks read one block and `parseDocument` costs ~80 µs — measured — so the redundant
 * parses would cost ~640 ms over a 2 000-page project. {@link AppFile.derived} is the memo
 * because it is already dropped by the two places that drop the source, where a cache keyed
 * on content would need its own copy of every source it had seen and its own eviction.
 *
 * `fileType` is part of the key rather than assumed constant: nothing here can enforce that
 * a caller passes the same one twice for one file.
 */
export function frontmatterBlock(
  file: AppFile,
  fileType: PlatformOSFileType | undefined,
): FrontmatterBlock | undefined {
  return file.derived(`frontmatterBlock\u0000${fileType ?? ''}`, () =>
    extractFrontmatterBlock(file.source, fileType),
  );
}

/**
 * The block, but only when it parsed cleanly.
 *
 * Every rule about FIELDS reads through this. `parseDocument` recovers and returns a partial
 * map, so those rules would otherwise report on the half of a broken block that happened to
 * survive — one mistake producing several unrelated diagnostics. A syntax rule reads the raw
 * block instead and is the one thing that speaks for a malformed one.
 */
export function wellFormedFrontmatterBlock(
  file: AppFile,
  fileType: PlatformOSFileType | undefined,
): FrontmatterBlock | undefined {
  const block = frontmatterBlock(file, fileType);
  return block && block.syntaxErrors.length === 0 ? block : undefined;
}
