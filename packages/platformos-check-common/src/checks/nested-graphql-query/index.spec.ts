import { describe, it, expect } from 'vitest';
import { runLiquidCheck } from '../../test';
import { NestedGraphQLQuery } from '.';

describe('Module: NestedGraphQLQuery', () => {
  it('should not report graphql outside a loop', async () => {
    const offenses = await runLiquidCheck(
      NestedGraphQLQuery,
      `{% graphql result = 'products/list' %}`,
    );
    expect(offenses).to.have.length(0);
  });

  it('should report graphql inside a for loop', async () => {
    const offenses = await runLiquidCheck(
      NestedGraphQLQuery,
      `{% for item in items %}{% graphql result = 'products/get' %}{% endfor %}`,
    );
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.include('N+1');
    expect(offenses[0].message).to.include('for');
  });

  it('should report graphql inside a tablerow loop', async () => {
    const offenses = await runLiquidCheck(
      NestedGraphQLQuery,
      `{% tablerow item in items %}{% graphql result = 'products/get' %}{% endtablerow %}`,
    );
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.include('tablerow');
  });

  it('should report graphql inside nested loops', async () => {
    const offenses = await runLiquidCheck(
      NestedGraphQLQuery,
      `{% for a in items %}{% for b in a.children %}{% graphql result = 'foo' %}{% endfor %}{% endfor %}`,
    );
    expect(offenses).to.have.length(1);
  });

  it('should not report graphql inside a loop when wrapped in cache', async () => {
    const offenses = await runLiquidCheck(
      NestedGraphQLQuery,
      `{% for item in items %}{% cache 'key' %}{% graphql result = 'foo' %}{% endcache %}{% endfor %}`,
    );
    expect(offenses).to.have.length(0);
  });

  it('should not report background tag inside a loop', async () => {
    const offenses = await runLiquidCheck(
      NestedGraphQLQuery,
      `{% for item in items %}{% background %}{% graphql result = 'foo' %}{% endbackground %}{% endfor %}`,
    );
    expect(offenses).to.have.length(0);
  });

  it('should report graphql inline markup inside a for loop', async () => {
    const offenses = await runLiquidCheck(
      NestedGraphQLQuery,
      `{% for item in items %}{% graphql result %}query { records { results { id } } }{% endgraphql %}{% endfor %}`,
    );
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.include('result');
  });

  it('should report multiple graphql tags inside one loop', async () => {
    const offenses = await runLiquidCheck(
      NestedGraphQLQuery,
      `{% for item in items %}{% graphql a = 'foo' %}{% graphql b = 'bar' %}{% endfor %}`,
    );
    expect(offenses).to.have.length(2);
  });
});
