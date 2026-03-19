import { InferredParamType } from '@platformos/platformos-check-common';

/**
 * Generate a single @param line for a doc tag.
 *
 * @param name - The parameter name
 * @param type - The inferred type
 * @param isOptional - Whether to mark as optional with brackets
 * @returns A formatted @param line like "@param {string} [name]" or "@param {string} name"
 */
export function generateParamLine(
  name: string,
  type: InferredParamType,
  isOptional: boolean = true,
): string {
  const paramName = isOptional ? `[${name}]` : name;
  return `@param {${type}} ${paramName}`;
}

/**
 * Generate a complete doc tag with param lines.
 *
 * @param params - Array of param line strings (without leading whitespace)
 * @param indentation - The indentation to use for each line (default: 2 spaces)
 * @returns A complete doc tag string
 */
export function generateDocTag(params: string[], indentation: string = '  '): string {
  if (params.length === 0) {
    return `{% doc %}\n{% enddoc %}\n`;
  }

  const paramLines = params.map((p) => `${indentation}${p}`).join('\n');
  return `{% doc %}\n${paramLines}\n{% enddoc %}\n`;
}
