import {
  DocDefinition,
  getDefaultValueForType,
  LiquidDocParameter,
} from '@platformos/platformos-check-common';

export function formatLiquidDocParameter(
  { name, type, description, required }: LiquidDocParameter,
  heading: boolean = false,
) {
  const nameStr = required ? `\`${name}\`` : `\`${name}\` (Optional)`;
  const typeStr = type ? `: ${type}` : '';

  if (heading) {
    const descStr = description ? `\n\n${description}` : '';
    return `### ${nameStr}${typeStr}${descStr}`;
  }

  const descStr = description ? ` - ${description}` : '';
  return `- ${nameStr}${typeStr}${descStr}`;
}

export function formatLiquidDocTagHandle(label: string, description: string, example: string) {
  return `### @${label}\n\n${description}\n\n` + `**Example**\n\n\`\`\`liquid\n${example}\n\`\`\``;
}

/**
 * The snippet an editor inserts for an annotation — mechanism, not documentation.
 *
 * `@param` is the one annotation whose completion places the cursor somewhere other than the end of the
 * line: `{$2}` for the type, `$1` for the name. Everything else takes free-form text after the name,
 * which is what the generic answer produces, so this stays a one-entry table with a fallback rather
 * than a row per annotation — the docset decides WHICH annotations exist, and an annotation it
 * publishes that is not named here still gets a working snippet.
 *
 * `param` is spelled out because the PARSER names it too: `LiquidDocParamNode` is the only annotation
 * with a structured markup rule, and that grammar is the one copy of the vocabulary that stays local.
 */
export function liquidDocAnnotationSnippet(name: string): string {
  return name === 'param' ? `param {$2} $1$0` : `${name} $0`;
}

export function getParameterCompletionTemplate(name: string, type: string | null) {
  const paramDefaultValue = getDefaultValueForType(type);

  const valueTemplate = paramDefaultValue === "''" ? `'$1'$0` : `\${1:${paramDefaultValue}}$0`;

  return `${name}: ${valueTemplate}`;
}

export function formatLiquidDocContentMarkdown(
  name: string,
  docDefinition?: DocDefinition,
): string {
  const liquidDoc = docDefinition?.liquidDoc;

  if (!liquidDoc) {
    return `### ${name}`;
  }

  const parts = [`### ${name}`];

  if (liquidDoc.description) {
    const description = liquidDoc.description.content;
    parts.push('', '**Description:**', '\n', description);
  }

  if (liquidDoc.parameters?.length) {
    const parameters = liquidDoc.parameters
      .map((param) => formatLiquidDocParameter(param))
      .join('\n');
    parts.push('', '**Parameters:**', parameters);
  }

  if (liquidDoc.examples?.length) {
    const examples = liquidDoc.examples
      ?.map(({ content }) => `\`\`\`liquid\n${content}\n\`\`\``)
      .join('\n');

    parts.push('', '**Examples:**', examples);
  }

  return parts.join('\n');
}
