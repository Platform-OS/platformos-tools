import { LiquidBranch, LiquidTag } from '@platformos/liquid-html-parser';
import { SourceCodeType, Problem } from '../../..';
import { editDistance, getValuesInMarkup, INVALID_SYNTAX_MESSAGE } from './utils';

type TokenType = 'variable' | keyof typeof TOKEN_PATTERNS;

interface Token {
  value: string;
  type: TokenType;
  index: number;
}

interface ExpressionIssue {
  message: string;
  fix?: string;
}

const TOKEN_PATTERNS = {
  logical: /^(and|or)$/,
  comparison: /^(==|!=|>=|<=|>|<|contains)$/,
  invalid: /^[@#$&]$/,
  literal: /^(['"][^'"]*['"]|\d+(?:\.\d+)?|true|false|nil|empty|blank)$/,
} as const;

function classifyToken(value: string): TokenType {
  for (const [type, pattern] of Object.entries(TOKEN_PATTERNS)) {
    if (pattern.test(value)) {
      return type as TokenType;
    }
  }
  return 'variable';
}

export function detectInvalidConditionalNode(
  node: LiquidBranch | LiquidTag,
): Problem<SourceCodeType.LiquidHtml> | undefined {
  if (!('name' in node) || !node.name) return;
  if (!['if', 'elsif', 'unless'].includes(String(node.name))) return;

  const markup = node.markup;
  if (typeof markup !== 'string' || !markup.trim()) return;

  const issue = analyzeConditionalExpression(markup);
  if (!issue) return;

  const openingTagRange = node.blockStartPosition || node.position;
  const openingTag = node.source.slice(openingTagRange.start, openingTagRange.end);
  const markupOffsetInOpening = openingTag.indexOf(markup);
  if (markupOffsetInOpening < 0) return;

  const startIndex = openingTagRange.start + markupOffsetInOpening;
  const endIndex = startIndex + markup.length;

  const problem: Problem<SourceCodeType.LiquidHtml> = {
    message: `${INVALID_SYNTAX_MESSAGE}: ${issue.message}`,
    startIndex,
    endIndex,
  };

  const replacement = issue.fix;
  if (replacement !== undefined) {
    problem.fix = (corrector) => {
      corrector.replace(startIndex, endIndex, replacement);
    };
  }

  return problem;
}

function isValueToken(token: Token): boolean {
  return token.type === 'literal' || token.type === 'variable';
}

function isOperatorToken(token: Token): boolean {
  return token.type === 'logical' || token.type === 'comparison';
}

const COMPARISON_OPERATORS = ['==', '!=', '>', '<', '>=', '<=', 'contains'];
const OPERATOR_SUGGESTION_CANDIDATES = [...COMPARISON_OPERATORS, 'and', 'or'];

// What the runtime's lax parser reads as an operator (and raises on when unknown).
const LAX_OPERATOR_WORD = /^[=!<>a-z_]/;

function isSubsequence(word: string, candidate: string): boolean {
  let i = 0;
  for (const char of candidate) {
    if (char === word[i]) i++;
  }
  return i === word.length;
}

function suggestOperator(word: string): string | undefined {
  const nearMisses = OPERATOR_SUGGESTION_CANDIDATES.map((candidate) => ({
    candidate,
    distance: editDistance(word, candidate),
  })).filter(({ candidate, distance }) => distance <= 2 && distance < candidate.length);

  if (nearMisses.length > 0) {
    const minDistance = Math.min(...nearMisses.map(({ distance }) => distance));
    const closest = nearMisses.filter(({ distance }) => distance === minDistance);
    if (closest.length === 1) return closest[0].candidate;
    // `=` ties with ==, !=, >= and <= at distance 1; only a prefix match disambiguates.
    const prefixed = closest.filter(({ candidate }) => candidate.startsWith(word));
    if (prefixed.length === 1) return prefixed[0].candidate;
    return undefined;
  }

  if (word.length >= 2) {
    const matches = OPERATOR_SUGGESTION_CANDIDATES.filter((candidate) =>
      isSubsequence(word, candidate),
    );
    if (matches.length === 1) return matches[0];
  }

  return undefined;
}

function checkConditionStructure(tokens: Token[], markup: string): ExpressionIssue | null {
  let i = 0;
  while (i < tokens.length) {
    if (!isValueToken(tokens[i])) {
      // comparison/invalid at position 0 is checkInvalidStartingToken's to report
      if (i === 0 && tokens[i].type !== 'logical') return null;
      return {
        message: `Conditional cannot start with '${tokens[i].value}'. Use a variable or value instead`,
      };
    }

    const operator = tokens[i + 1];
    if (!operator) return null;

    if (operator.type === 'logical') {
      if (i + 2 >= tokens.length) {
        return {
          message: `Conditional cannot end with '${operator.value}'. Expected a condition after it`,
        };
      }
      i += 2;
      continue;
    }

    if (operator.type === 'comparison') {
      const right = tokens[i + 2];
      if (!right || !isValueToken(right)) {
        return {
          message: `Comparison operator '${operator.value}' is missing its right-hand side`,
        };
      }
      const separator = tokens[i + 3];
      if (!separator) return null;
      // junk after a complete comparison is checkTrailingTokensAfterComparison's
      if (separator.type !== 'logical') return null;
      i += 4;
      continue;
    }

    if (isValueToken(operator) && LAX_OPERATOR_WORD.test(operator.value)) {
      const suggestion = suggestOperator(operator.value);
      const issue: ExpressionIssue = {
        message:
          `Unknown operator '${operator.value}'. ` +
          `Valid operators are: ${COMPARISON_OPERATORS.join(', ')}` +
          (suggestion ? `. Did you mean '${suggestion}'?` : ''),
      };
      if (suggestion) {
        issue.fix =
          markup.slice(0, operator.index) +
          suggestion +
          markup.slice(operator.index + operator.value.length);
      }
      return issue;
    }

    // literal-led junk is checkLaxParsingIssues' to report
    if (tokens[i].type === 'literal') return null;

    const validExpr = tokens
      .slice(0, i + 1)
      .map((t) => t.value)
      .join(' ');
    const ignored = tokens
      .slice(i + 1)
      .map((t) => t.value)
      .join(' ');
    const hint = /&&|\|\|/.test(ignored)
      ? `. Use 'and'/'or' instead of '&&'/'||' for multiple conditions`
      : ignored.startsWith('|')
        ? `. Filters are not supported in conditions`
        : '';

    return {
      message: `Conditional is invalid. Anything after '${validExpr}' will be ignored${hint}`,
      fix: validExpr,
    };
  }
  return null;
}

function checkInvalidStartingToken(tokens: Token[]): ExpressionIssue | null {
  const firstToken = tokens[0];
  if (firstToken.type === 'invalid' || firstToken.type === 'comparison') {
    return {
      message: `Conditional cannot start with '${firstToken.value}'. Use a variable or value instead`,
      fix: 'false',
    };
  }
  return null;
}

function checkTrailingTokensAfterComparison(tokens: Token[]): ExpressionIssue | null {
  const COMPARISON_LENGTH = 3;
  const minTokensForTrailing = COMPARISON_LENGTH + 1;

  for (let i = 0; i <= tokens.length - minTokensForTrailing; i++) {
    const [v1, op, v2] = tokens.slice(i, i + 3);
    const remaining = tokens.slice(i + 3);

    if (isValueToken(v1) && op.type === 'comparison' && isValueToken(v2)) {
      if (remaining.length > 0) {
        if (remaining[0].type !== 'logical') {
          const validExpr = tokens
            .slice(0, i + 3)
            .map((t) => t.value)
            .join(' ');
          const junk = remaining.map((t) => t.value).join(' ');
          const containsLogicalOperators = /&&|\|\|/.test(junk);

          if (containsLogicalOperators) {
            return {
              message: `Conditional is invalid. Anything after '${validExpr}' will be ignored. Use 'and'/'or' instead of '&&'/'||' for multiple conditions`,
              fix: validExpr,
            };
          } else {
            return {
              message: `Conditional is invalid. Anything after '${validExpr}' will be ignored`,
              fix: validExpr,
            };
          }
        }
      }
    }
  }
  return null;
}

function checkLaxParsingIssues(tokens: Token[]): ExpressionIssue | null {
  for (let i = 0; i < tokens.length - 1; i++) {
    const current = tokens[i];
    const next = tokens[i + 1];

    if (current.type === 'literal' && !isOperatorToken(next)) {
      const remaining = tokens.slice(i + 1);
      const ignored = remaining.map((t) => t.value).join(' ');
      const containsLogicalOperators = /&&|\|\|/.test(ignored);

      if (containsLogicalOperators) {
        return {
          message: `Expression stops at truthy value '${current.value}', and will ignore: '${ignored}'. Use 'and'/'or' instead of '&&'/'||' for multiple conditions`,
          fix: current.value,
        };
      } else {
        return {
          message: `Expression stops at truthy value '${current.value}', and will ignore: '${ignored}'`,
          fix: current.value,
        };
      }
    }
  }
  return null;
}

function analyzeConditionalExpression(markup: string): ExpressionIssue | null {
  const trimmed = markup.trim();
  if (!trimmed) return null;

  const tokens: Token[] = getValuesInMarkup(trimmed).map(({ value, index }) => ({
    value,
    index,
    type: classifyToken(value),
  }));

  if (tokens.length === 0) return null;

  return (
    checkInvalidStartingToken(tokens) ||
    checkConditionStructure(tokens, trimmed) ||
    checkTrailingTokensAfterComparison(tokens) ||
    checkLaxParsingIssues(tokens)
  );
}
