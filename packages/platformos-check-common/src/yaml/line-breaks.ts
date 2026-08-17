/**
 * Make the parser agree with the platform about what a line break is.
 *
 * THE MISMATCH. This package parses YAML with npm `yaml`, which implements YAML 1.2; the
 * platform parses with Ruby Psych/libyaml, which implements YAML 1.1. The two disagree about
 * a lone carriage return: 1.1 lists CR as a line break, 1.2 does not.
 *
 * The consequence was a FALSE BLOCK on a paste artefact. A single stray `\r` in an otherwise
 * normal LF file — `a: 1\rb: 2\n` — is one long line to a 1.2 parser, which reads it as
 * `a: 1 b: 2` and reports `Nested mappings are not allowed in compact mappings`, a
 * `YAMLSyntaxError`, which BLOCKS. Measured: `--dry-run` accepts the same bytes in all four
 * admitted YAML types, and Psych parses them as `{"a"=>1, "b"=>2}`.
 *
 * NOT THE `version` OPTION: `parseDocument(source, { version: '1.1' })` still returns
 * `BLOCK_AS_IMPLICIT_KEY` for that input — measured. The option changes SCALAR RESOLUTION,
 * not the lexer's notion of a line break, and no option does, so the source is normalized.
 *
 * SAFE FOR POSITIONS, which is why it can be done at all: the substitution is one byte for
 * one byte, so every offset is unchanged and diagnostics computed against the ORIGINAL source
 * still point at the right characters. `utils/position.ts` already treats a lone `\r` as a
 * line terminator, so line and character numbers stay consistent too.
 *
 * `\r\n` IS LEFT ALONE. Both specs agree it is a single break, and rewriting it would either
 * change the byte count or leave a stray blank line.
 */

/**
 * Replace every LONE carriage return with a line feed, leaving `\r\n` untouched.
 *
 * Returns the source unchanged — the same string reference — when there is nothing to
 * do, which is every file that has never been near a classic-Mac editor.
 */
export function normalizeLoneCarriageReturns(source: string): string {
  // Cheap reject first: the overwhelming majority of files contain no CR at all, and
  // this runs on every YAML file in a project.
  if (!source.includes('\r')) return source;

  // Negative lookahead, not a split/join: `\r` followed by `\n` is a CRLF break that
  // both parsers already agree about.
  return source.replace(/\r(?!\n)/g, '\n');
}
