import { describe, it, expect } from 'vitest';
import { InvalidHashAssignTarget } from './index';
import { check, MockApp } from '../../test';

describe('Module: InvalidHashAssignTarget', () => {
  it('should report an error when hash_assign is used on a number', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% assign x = 10 %}
        {% hash_assign x['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toContain('number');
    expect(offenses[0].message).toContain('hash_assign');
  });

  it('should report an error when hash_assign is used on a string', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% assign x = 'hello' %}
        {% hash_assign x['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toContain('string');
  });

  it('should report an error when hash_assign is used on a boolean', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% assign x = true %}
        {% hash_assign x['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toContain('boolean');
  });

  it('should report an error when hash_assign is used on an array (range)', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% assign x = (1..5) %}
        {% hash_assign x['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toContain('array');
  });

  it('should not report an error when hash_assign is used on an object from parse_json', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% assign x = '{}' | parse_json %}
        {% hash_assign x['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(0);
  });

  it('should not report an error when hash_assign is used on an object from parse_json tag', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% parse_json x %}
          {}
        {% endparse_json %}
        {% hash_assign x['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(0);
  });

  it('should not report an error when hash_assign is used on an object from graphql', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% graphql result %}
          query { user { id } }
        {% endgraphql %}
        {% hash_assign result['extra'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(0);
  });

  it('should not report an error when hash_assign is used on an untyped variable', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% hash_assign unknown_var['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(0);
  });

  it('should not report an error when hash_assign is used on a function return', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% function data = 'lib/get_data' %}
        {% hash_assign data['extra'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(0);
  });

  it('should not report an error when hash_assign is used on a function return with variable partial', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% assign partial_name = 'lib/get_data' %}
        {% function data = partial_name %}
        {% hash_assign data['extra'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(0);
  });

  it('should not report an error when function uses hash-access result target and hash_assign follows', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% parse_json my_hash %}{}{% endparse_json %}
        {% function my_hash['result'] = 'lib/get_data' %}
        {% hash_assign my_hash['extra'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(0);
  });

  it('should track reassignment and report error on new type', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% assign x = '{}' | parse_json %}
        {% hash_assign x['key1'] = 'value1' %}
        {% assign x = 42 %}
        {% hash_assign x['key2'] = 'value2' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toContain('number');
  });

  it('should handle increment/decrement as numbers', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% increment counter %}
        {% hash_assign counter['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toContain('number');
  });

  it('should handle capture as string', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% capture x %}hello{% endcapture %}
        {% hash_assign x['key'] = 'value' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(1);
    expect(offenses[0].message).toContain('string');
  });

  it('should allow multiple hash_assign on same object', async () => {
    const app: MockApp = {
      'file.liquid': `
        {% assign x = '{}' | parse_json %}
        {% hash_assign x['key1'] = 'value1' %}
        {% hash_assign x['key2'] = 'value2' %}
        {% hash_assign x['key3'] = 'value3' %}
      `,
    };

    const offenses = await check(app, [InvalidHashAssignTarget]);
    expect(offenses).toHaveLength(0);
  });
});
