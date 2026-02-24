import { Severity, SourceCodeType, LiquidCheckDefinition, Problem } from '../../types';
import { getOffset, isError } from '../../utils';
import { detectMultipleAssignValues } from './checks/MultipleAssignValues';
import { detectInvalidBooleanExpressions } from './checks/InvalidBooleanExpressions';
import { detectInvalidEchoValue } from './checks/InvalidEchoValue';
import { detectInvalidConditionalNode } from './checks/InvalidConditionalNode';
import { detectInvalidLoopRange } from './checks/InvalidLoopRange';
import { detectInvalidLoopArguments } from './checks/InvalidLoopArguments';
import { detectConditionalNodeUnsupportedParenthesis } from './checks/InvalidConditionalNodeParenthesis';
import { detectInvalidFilterName } from './checks/InvalidFilterName';
import { detectInvalidPipeSyntax } from './checks/InvalidPipeSyntax';
import { detectUnknownTag } from './checks/UnknownTag';
import { detectInvalidTagSyntax } from './checks/InvalidTagSyntax';
import { isWithinRawTagThatDoesNotParseItsContents } from '../utils';

type LineColPosition = {
  line: number;
  column: number;
};

function isParsingErrorWithLocation(
  error: Error,
): error is Error & { loc: { start: LineColPosition; end: LineColPosition } } {
  return 'name' in error && error.name === 'LiquidHTMLParsingError' && 'loc' in error;
}

function cleanErrorMessage(message: string, highlight: string): string {
  return message
    .replace(/Line \d+, col \d+:\s+/, 'SyntaxError: ')
    .replace(/(?!<expected ".+",) not .*/, ` not "${highlight}"`);
}

export const LiquidHTMLSyntaxError: LiquidCheckDefinition = {
  meta: {
    code: 'LiquidHTMLSyntaxError',
    aliases: ['SyntaxError', 'HtmlParsingError'],
    name: 'Prevent LiquidHTML Syntax Errors',
    docs: {
      description: 'This check exists to inform the user of Liquid HTML syntax errors.',
      recommended: true,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    const ast = context.file.ast;
    const filtersPromise = context.platformosDocset?.filters();
    const tagsPromise = context.platformosDocset?.tags();

    if (!isError(ast)) {
      return {
        async BooleanExpression(node, ancestors) {
          if (isWithinRawTagThatDoesNotParseItsContents(ancestors)) return;

          const problem = detectInvalidBooleanExpressions(node, ancestors);

          if (!problem) {
            return;
          }

          context.report(problem);
        },
        async LiquidTag(node, ancestors) {
          if (isWithinRawTagThatDoesNotParseItsContents(ancestors)) return;

          const tags = (await tagsPromise) ?? [];

          // Unknown tags are fatal — no point in further syntax checks.
          const unknownTagProblem = detectUnknownTag(node, tags);
          if (unknownTagProblem) {
            context.report(unknownTagProblem);
            return;
          }

          // Run specific sub-checks first — they provide better error messages and autofixes.
          const problems = [
            detectMultipleAssignValues(node),
            detectInvalidEchoValue(node),
            detectInvalidLoopRange(node),
            detectInvalidLoopArguments(node, tags),
          ].filter(Boolean) as Problem<SourceCodeType.LiquidHtml>[];

          // Fixers for `detectConditionalNodeUnsupportedParenthesis` and `detectInvalidConditionalNode` consume
          // the whole node markup, so we MUST not run both.
          const conditionalNodeProblem =
            detectConditionalNodeUnsupportedParenthesis(node) || detectInvalidConditionalNode(node);

          if (conditionalNodeProblem) {
            problems.push(conditionalNodeProblem);
          }

          // InvalidTagSyntax is a catch-all for known tags with unparseable markup.
          // Only fire it if no more specific sub-check already reported on this tag.
          if (problems.length === 0) {
            const invalidSyntaxProblem = detectInvalidTagSyntax(node, tags);
            if (invalidSyntaxProblem) {
              problems.push(invalidSyntaxProblem);
            }
          }

          problems.forEach(context.report);

          const filterProblems = await detectInvalidFilterName(node, (await filtersPromise) ?? []);
          if (filterProblems.length > 0) {
            filterProblems.forEach((filterProblem) => context.report(filterProblem));
          }

          const pipeProblems = await detectInvalidPipeSyntax(node);
          if (pipeProblems.length > 0) {
            pipeProblems.forEach((pipeProblem) => context.report(pipeProblem));
          }
        },

        async LiquidBranch(node, ancestors) {
          if (isWithinRawTagThatDoesNotParseItsContents(ancestors)) return;

          const problem = detectInvalidConditionalNode(node);

          if (!problem) {
            return;
          }

          context.report(problem);
        },

        async LiquidVariableOutput(node, ancestors) {
          if (isWithinRawTagThatDoesNotParseItsContents(ancestors)) return;

          const filterProblems = await detectInvalidFilterName(node, (await filtersPromise) ?? []);
          if (filterProblems.length > 0) {
            filterProblems.forEach((problem) => context.report(problem));
          }

          const pipeProblems = await detectInvalidPipeSyntax(node);
          if (pipeProblems.length > 0) {
            pipeProblems.forEach((pipeProblem) => context.report(pipeProblem));
          }

          const problem = detectInvalidEchoValue(node);
          if (problem) {
            context.report(problem);
          }
        },
      };
    }

    return {
      async onCodePathStart(file) {
        if (isParsingErrorWithLocation(ast)) {
          const { start, end } = ast.loc;
          const startIndex = getOffset(file.source, start.line, start.column);
          let endIndex = getOffset(file.source, end.line, end.column);
          if (startIndex === endIndex) endIndex += 1;
          const highlight = file.source.slice(startIndex, endIndex);
          context.report({
            message: cleanErrorMessage(ast.message, highlight),
            startIndex,
            endIndex: endIndex,
          });
        } else {
          context.report({
            message: ast.message,
            startIndex: 0,
            endIndex: file.source.length,
          });
        }
      },
    };
  },
};
