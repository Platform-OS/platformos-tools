import { NamedTags } from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';

/**
 * Flags a `{% graphql %}` call written in multi-line form INSIDE a
 * `{% liquid %}` block.
 *
 * The Liquid grammar terminates an inline `graphql` statement at the first
 * newline that follows a trailing comma, so every `name: value` argument on a
 * subsequent line is silently dropped at runtime — the query executes with a
 * truncated argument set and NO error is raised. This is a correctness defect
 * (silent data loss), not a style issue, which is why it lives in the engine
 * where every editor and the CLI surface it.
 *
 * The detection is the heuristic the pos-supervisor used as
 * `classifyGraphqlSourceKind === 'liquid_multiline_truncated'`:
 *   - the parsed statement is the inline form (its source does NOT start with
 *     `{%` — the tag form `{% graphql … %}` is a single statement and is never
 *     truncated), AND
 *   - the parsed statement ends on a trailing comma, AND
 *   - the line immediately after the statement opens a `name:` argument that
 *     the grammar dropped.
 */

const TRAILING_COMMA = /,\s*$/;
const NEXT_LINE_NAMED_ARG = /\n\s*[A-Za-z_]\w*\s*:/;
/** How far past the statement to look for a dropped `name:` argument. */
const TRAIL_LOOKAHEAD = 200;

function isMultilineTruncatedGraphql(source: string, start: number, end: number): boolean {
  const text = source.slice(start, end);
  // Tag form `{% graphql … %}` is a single statement — never truncated.
  if (text.startsWith('{%')) return false;
  // Inline form inside `{% liquid %}`: truncation shows up as a statement that
  // ends on a comma with a `name:` argument stranded on the following line.
  if (!TRAILING_COMMA.test(text)) return false;
  const trail = source.slice(end, end + TRAIL_LOOKAHEAD);
  return NEXT_LINE_NAMED_ARG.test(trail);
}

export const GraphqlMultilineInLiquidBlock: LiquidCheckDefinition = {
  meta: {
    code: 'GraphqlMultilineInLiquidBlock',
    name: 'GraphQL Multi-line In Liquid Block',
    docs: {
      description:
        'Flags a multi-line {% graphql %} call inside a {% liquid %} block. The grammar truncates the call at the first newline following a trailing comma, so named arguments on later lines are silently dropped at runtime.',
      recommended: true,
      url: undefined,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    return {
      async LiquidTag(node) {
        if (node.name !== NamedTags.graphql) return;
        if (!node.position) return;
        if (
          !isMultilineTruncatedGraphql(context.file.source, node.position.start, node.position.end)
        ) {
          return;
        }
        context.report({
          message:
            "Multi-line `{% graphql %}` call inside a `{% liquid %}` block: the parser truncates the call at the first newline after a comma, so every named argument past it is silently dropped at runtime. Move it to single-line tag form (`{% graphql result = 'op', name: value, ... %}`), or keep it in the block with every `name: value` argument on the same line as `graphql`.",
          startIndex: node.position.start,
          endIndex: node.position.end,
        });
      },
    };
  },
};
