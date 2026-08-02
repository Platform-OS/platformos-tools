/**
 * Make the parser agree with the platform about what a line break is.
 *
 * THE MISMATCH THIS EXISTS FOR. This package parses YAML with npm `yaml`, which
 * implements **YAML 1.2**. The platform parses with Ruby Psych/libyaml, which
 * implements **YAML 1.1**. The two specs disagree about a lone carriage return: 1.1
 * lists CR as a line break, 1.2 does not.
 *
 * The consequence was a FALSE BLOCK on a paste artefact. A single stray `\r` in an
 * otherwise normal LF file:
 *
 *   ```
 *     a: 1\rb: 2\n
 *   ```
 *
 * is one long line to a 1.2 parser, which reads it as `a: 1 b: 2` and reports
 * `Nested mappings are not allowed in compact mappings` — a `YAMLSyntaxError`, which
 * BLOCKS. Measured: `pos-cli deploy --dry-run` accepts the same bytes in all four
 * admitted YAML types, and Psych parses them as `{"a"=>1, "b"=>2}`.
 *
 * The classic-Mac file is the obvious case, but it is not the important one. A single
 * CR pasted into an LF file blocks identically, and that is a thing that happens.
 *
 * WHY NOT THE `version` OPTION. `parseDocument(source, { version: '1.1' })` does not
 * help — measured, it still returns `BLOCK_AS_IMPLICIT_KEY` for the input above. The
 * option changes SCALAR RESOLUTION, not the lexer's notion of a line break. There is
 * no option that does, so the source is normalized instead.
 *
 * WHY THIS IS SAFE FOR POSITIONS, which is the reason it can be done at all. The
 * substitution is one byte for one byte, so every offset in the document is unchanged
 * and diagnostics computed against the ORIGINAL source still point at the right
 * characters. `utils/position.ts` already treats a lone `\r` as a line terminator — it
 * was rewritten for exactly these files — so line and character numbers stay
 * consistent too. Nothing downstream needs to know this happened.
 *
 * `\r\n` IS LEFT ALONE. Both specs agree it is a single break, both parsers already
 * handle it, and rewriting it would either change the byte count or leave a stray
 * blank line.
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
