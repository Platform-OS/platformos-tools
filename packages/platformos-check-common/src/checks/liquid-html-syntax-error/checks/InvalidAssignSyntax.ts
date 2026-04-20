import { LiquidTag } from '@platformos/liquid-html-parser';
import { Problem, SourceCodeType } from '../../..';

/**
 * Detects structurally-invalid `assign` tags that neither `MultipleAssignValues` nor
 * `InvalidPipeSyntax`/`InvalidFilterName` catch:
 *
 *   {% assign %}             — empty markup
 *   {% assign x %}           — target only, no operator
 *   {% assign x "var" %}     — missing `=`
 *   {% assign = 'v' %}       — missing target
 *   {% assign x = %}         — empty RHS
 *   {% assign 'str' = 'v' %} — target is a literal
 *   {% assign x := 'v' %}    — operator is not `=`
 *
 * When the strict grammar rule `liquidTagAssignMarkup` fails, the parser falls back to
 * the base case and stores markup as a raw string. That string almost always still
 * contains `=`-plus-RHS with a filter or pipe issue (handled elsewhere). This check
 * targets the cases where the `target = value` skeleton itself is broken, so it
 * complements rather than duplicates the other sub-checks.
 */
export function detectInvalidAssignSyntax(
  node: LiquidTag,
): Problem<SourceCodeType.LiquidHtml> | undefined {
  if (node.name !== 'assign') return;
  if (typeof node.markup !== 'string') return;

  const markup = node.markup.trim();

  const eqIndex = markup.indexOf('=');
  const hasEquals = eqIndex !== -1;
  const lhs = hasEquals ? markup.slice(0, eqIndex).trim() : markup;
  const rhs = hasEquals ? markup.slice(eqIndex + 1).trim() : '';

  const isStructurallyBroken =
    markup === '' || !hasEquals || lhs === '' || rhs === '' || !isValidAssignTarget(lhs);

  if (!isStructurallyBroken) return;

  return {
    message: `Invalid syntax for tag 'assign'. Expected syntax: {% assign <var> = <value> %}`,
    startIndex: node.position.start,
    endIndex: node.position.end,
  };
}

/**
 * Rejects an LHS that is obviously not an assign target.
 *
 * NOTE: the parser's `variableSegment` rule is stricter than the platformOS runtime —
 * Liquify (see assign_tag_test.rb "allow variable names to start with digit") accepts
 * `23_hours_ago` as a valid name, but our grammar requires `(letter | "_")` at the
 * start and falls back to the base case for digit-starting names. To avoid
 * false-positive lint errors on code that runs fine, this shape check only rejects
 * LHS forms that are never valid: literal delimiters at the start (`'`, `"`, `[`, `{`)
 * and stray operator characters (`:` or a second `=`) that indicate the operator
 * itself is malformed (e.g. `:=`).
 */
function isValidAssignTarget(lhs: string): boolean {
  if (/^['"[{]/.test(lhs)) return false;
  if (/[:=]/.test(lhs)) return false;
  return true;
}
