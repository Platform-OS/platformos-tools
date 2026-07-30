import { LiquidVariableLookup, NamedTags, NodeTypes } from '@platformos/liquid-html-parser';
import { LiquidCheckDefinition, Severity, SourceCodeType } from '../../types';
import { RESERVED_VARIABLE_NAMES } from '../utils';

export const ReservedVariableName: LiquidCheckDefinition = {
  meta: {
    code: 'ReservedVariableName',
    name: 'Reserved variable name',
    docs: {
      description:
        "Disallows using reserved Liquid literals ('true', 'false', 'nil', 'null', 'empty', 'blank') as variable names. Reading such a name always returns the built-in literal, never the assigned value.",
      recommended: true,
      url: undefined,
    },
    type: SourceCodeType.LiquidHtml,
    severity: Severity.ERROR,
    schema: {},
    targets: [],
  },

  create(context) {
    const report = (name: string, startIndex: number, endIndex: number) => {
      context.report({
        message: `'${name}' is a reserved Liquid literal and cannot be used as a variable name — reading '${name}' always returns the literal, never the assigned value`,
        startIndex,
        endIndex,
      });
    };

    // Targets whose name is a plain string always sit at the start of their markup node
    const checkStringTarget = (name: string, markup: { position: { start: number } }) => {
      if (RESERVED_VARIABLE_NAMES.has(name)) {
        report(name, markup.position.start, markup.position.start + name.length);
      }
    };

    const checkLookupTarget = (lookup: LiquidVariableLookup | null) => {
      if (lookup?.name && RESERVED_VARIABLE_NAMES.has(lookup.name)) {
        report(lookup.name, lookup.position.start, lookup.position.end);
      }
    };

    return {
      async LiquidTag(node) {
        if (typeof node.markup === 'string') return;

        switch (node.name) {
          case NamedTags.assign:
            checkStringTarget(node.markup.name, node.markup);
            break;
          case NamedTags.capture:
          case NamedTags.parse_json:
          case NamedTags.increment:
          case NamedTags.decrement:
            checkLookupTarget(node.markup);
            break;
          case NamedTags.function:
            checkLookupTarget(node.markup.name);
            break;
          case NamedTags.graphql:
            checkStringTarget(node.markup.name, node.markup);
            break;
          case NamedTags.hash_assign:
            checkLookupTarget(node.markup.target);
            break;
          case NamedTags.for:
          case NamedTags.tablerow:
            checkStringTarget(node.markup.variableName, node.markup);
            break;
          case NamedTags.background:
            if (node.markup.type === NodeTypes.BackgroundMarkup) {
              checkStringTarget(node.markup.jobId, node.markup);
            }
            break;
        }
      },

      async LiquidBranch(node) {
        if (node.name === NamedTags.catch && typeof node.markup !== 'string') {
          checkLookupTarget(node.markup);
        }
      },
    };
  },
};
