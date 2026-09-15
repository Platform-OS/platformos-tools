import { JSONNode, LiteralNode, ObjectNode, PropertyNode } from '../jsonc/types';

/**
 * Each entry of a schema document's `properties:` sequence.
 *
 * A SEQUENCE specifically: the mapping form is rejected on deploy, so a document using it is
 * broken for a reason no check here owns and has no properties worth reading.
 *
 * Shared by the checks that read property declarations, so they cannot disagree about what a
 * declaration IS — one reporting a property the other does not see would be a bug in whichever
 * of them was consulted second.
 */
export function schemaProperties(ast: JSONNode): ObjectNode[] {
  if (ast.type !== 'Object') return [];
  const properties = propertyOf(ast, 'properties');
  if (properties?.value.type !== 'Array') return [];

  return properties.value.children.filter((child): child is ObjectNode => child.type === 'Object');
}

export function propertyOf(node: ObjectNode, name: string): PropertyNode | undefined {
  return node.children.find((child) => child.key.value === name);
}

/**
 * A property entry's value for `key`, when it is a plain string the platform will read
 * literally.
 *
 * `undefined` covers every spelling nothing can be concluded from: the key is absent, the value
 * is a sequence or mapping rather than a scalar, it is a number or boolean, or it carries
 * `{{ }}` and is resolved at deploy time from something this file does not contain.
 */
export function literalStringOf(property: ObjectNode, key: string): LiteralNode | undefined {
  const found = propertyOf(property, key);
  if (found?.value.type !== 'Literal') return undefined;
  if (typeof found.value.value !== 'string' || found.value.value.includes('{{')) return undefined;

  return found.value;
}
