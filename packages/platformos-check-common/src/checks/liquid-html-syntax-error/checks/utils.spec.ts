import { expect, describe, it } from 'vitest';
import {
  doesFragmentContainUnsupportedParentheses,
  fragmentKeyValuePair,
  getFragmentsInMarkup,
  getValuesInMarkup,
  hasExpressionOperator,
  isOperatorToken,
} from './utils';

describe('getValuesInMarkup', () => {
  it('should return the values in the markup (one value)', () => {
    const markup = '"123"';
    const values = getValuesInMarkup(markup);
    expect(values).toContainEqual({ value: '"123"', index: 0 });
  });

  it('should return the values in the markup (multiple values)', () => {
    const markup = '"123" 555 text';
    const values = getValuesInMarkup(markup);
    expect(values).toContainEqual({ value: '"123"', index: 0 });
    expect(values).toContainEqual({ value: '555', index: 6 });
    expect(values).toContainEqual({ value: 'text', index: 10 });
  });

  it('should return nothing when no values in the markup', () => {
    const markup = '';
    const values = getValuesInMarkup(markup);
    expect(values).to.have.length(0);
  });

  it('should return nothing when only spaces in the markup', () => {
    const markup = '     ';
    const values = getValuesInMarkup(markup);
    expect(values).to.have.length(0);
  });
});

describe('getFragmentsInMarkup', () => {
  Object.entries({
    space: ' ',
    comma: ', ',
  }).forEach(([name, separator]) => {
    it(`should return all fragments in markup separated by ${name}`, () => {
      const markup = `reversed${separator}limit: 10${separator}offset: 1${separator}something`;
      const values = getFragmentsInMarkup(markup);
      expect(values).toContainEqual(expect.objectContaining({ value: 'reversed' }));
      expect(values).toContainEqual(expect.objectContaining({ value: 'limit: 10' }));
      expect(values).toContainEqual(expect.objectContaining({ value: 'offset: 1' }));
      expect(values).toContainEqual(expect.objectContaining({ value: 'something' }));
    });
  });

  it('should capture all the ranges in the markup', () => {
    const markup = `(1..10) ( 1..10 ) ( 1 .. 10 ) ( 1 ... 10 )`;
    const values = getFragmentsInMarkup(markup);
    expect(values).toContainEqual(expect.objectContaining({ value: '(1..10)' }));
    expect(values).toContainEqual(expect.objectContaining({ value: '( 1..10 )' }));
    expect(values).toContainEqual(expect.objectContaining({ value: '( 1 .. 10 )' }));
    expect(values).toContainEqual(expect.objectContaining({ value: '( 1 ... 10 )' }));
  });
});

describe('fragmentKeyValuePair', () => {
  it('should return the key and value of the key-value pair', () => {
    const fragment = 'key: value';
    const keyValuePair = fragmentKeyValuePair(fragment);
    expect(keyValuePair).to.deep.equal({ key: 'key', value: 'value' });
  });
});

describe('doesFragmentContainUnsupportedParentheses', () => {
  it('should return true when the fragment contains parentheses and isnt a range', () => {
    const fragment = '(this and that)';
    const result = doesFragmentContainUnsupportedParentheses(fragment);
    expect(result).to.be.true;
  });

  it('should return false when the fragment contains parentheses and is a range', () => {
    const fragment = '(1..2)';
    const result = doesFragmentContainUnsupportedParentheses(fragment);
    expect(result).to.be.false;
  });
});

/**
 * The guard on every fix that repairs markup by keeping the first value and deleting the
 * rest. Getting it wrong in one direction rewrites the author's expression into a different
 * program; in the other it merely declines to autofix, so the token lists below are pinned
 * whole rather than sampled.
 */
describe('isOperatorToken', () => {
  it('classifies operators as operators', () => {
    const operators = [
      '?',
      ':',
      '?b', // a ternary marker fused to its operand, as in `a ?b :c`
      'a?',
      '&&',
      '||',
      '==',
      '!=',
      '>=',
      '<=',
      '>',
      '<',
      '+',
      '-',
      '*',
      '/',
      '%',
      'and',
      'or',
      'contains',
    ];

    expect(operators.filter((token) => !isOperatorToken(token))).toEqual([]);
  });

  it('classifies values as values', () => {
    const values = [
      '123',
      '-5', // a negative number, NOT the `-` operator
      '-5.5',
      'true',
      'text',
      'foo.bar',
      '(1..3)',
      "'a?b'", // an operator spelled inside a quoted string is data
      '"a:b"',
      "'and'",
      "':'",
    ];

    expect(values.filter((token) => isOperatorToken(token))).toEqual([]);
  });
});

describe('hasExpressionOperator', () => {
  it('is true for a value section the author wrote as an expression', () => {
    const expressions = [
      `flag ? 'yes' : 'no'`,
      `a ?b :c`,
      `a && b`,
      `a and b`,
      `a contains b`,
      `1 + 2`,
      `+ 2`, // operator in leading position
    ];

    expect(expressions.filter((section) => !hasExpressionOperator(section))).toEqual([]);
  });

  it('is false for a value followed by stray tokens', () => {
    const strayTails = [`'123' 555 text`, `"123" 555 text`, `'a?b' 555`, `-5 555`, `(1..3) 555`];

    expect(strayTails.filter((section) => hasExpressionOperator(section))).toEqual([]);
  });
});
