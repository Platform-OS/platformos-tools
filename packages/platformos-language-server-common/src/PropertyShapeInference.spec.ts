import { describe, expect, it } from 'vitest';
import { shapeToJSONPlaceholder } from './PropertyShapeInference';
import type { PropertyShape } from './PropertyShapeInference';

describe('shapeToJSONPlaceholder', () => {
  it('returns "null" for undefined', () => {
    expect(shapeToJSONPlaceholder(undefined)).toBe('null');
  });

  it('returns "" for string primitive', () => {
    const shape: PropertyShape = { kind: 'primitive', primitiveType: 'string' };
    expect(shapeToJSONPlaceholder(shape)).toBe('""');
  });

  it('returns "0" for number primitive', () => {
    const shape: PropertyShape = { kind: 'primitive', primitiveType: 'number' };
    expect(shapeToJSONPlaceholder(shape)).toBe('0');
  });

  it('returns "true" for boolean primitive', () => {
    const shape: PropertyShape = { kind: 'primitive', primitiveType: 'boolean' };
    expect(shapeToJSONPlaceholder(shape)).toBe('true');
  });

  it('returns "null" for null primitive', () => {
    const shape: PropertyShape = { kind: 'primitive', primitiveType: 'null' };
    expect(shapeToJSONPlaceholder(shape)).toBe('null');
  });

  it('returns "null" for untyped primitive', () => {
    const shape: PropertyShape = { kind: 'primitive' };
    expect(shapeToJSONPlaceholder(shape)).toBe('null');
  });

  it('returns "[]" for array shape', () => {
    const shape: PropertyShape = { kind: 'array' };
    expect(shapeToJSONPlaceholder(shape)).toBe('[]');
  });

  it('returns "{}" for object shape', () => {
    const shape: PropertyShape = { kind: 'object', properties: new Map() };
    expect(shapeToJSONPlaceholder(shape)).toBe('{}');
  });
});
