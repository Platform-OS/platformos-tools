import { describe, it, expect } from 'vitest';
import { runLiquidCheck, check } from '../../test';
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
    expect(offenses[0].message).to.equal(
      "N+1 pattern: {% graphql result = 'result' %} is inside a {% for %} loop. This executes at least one database request per iteration. Move the query before the loop and pass data as a variable.",
    );
  });

  it('should report graphql inside a tablerow loop', async () => {
    const offenses = await runLiquidCheck(
      NestedGraphQLQuery,
      `{% tablerow item in items %}{% graphql result = 'products/get' %}{% endtablerow %}`,
    );
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      "N+1 pattern: {% graphql result = 'result' %} is inside a {% tablerow %} loop. This executes at least one database request per iteration. Move the query before the loop and pass data as a variable.",
    );
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
    expect(offenses[0].message).to.equal(
      "N+1 pattern: {% graphql result = 'result' %} is inside a {% for %} loop. This executes at least one database request per iteration. Move the query before the loop and pass data as a variable.",
    );
  });

  it('should report multiple graphql tags inside one loop', async () => {
    const offenses = await runLiquidCheck(
      NestedGraphQLQuery,
      `{% for item in items %}{% graphql a = 'foo' %}{% graphql b = 'bar' %}{% endfor %}`,
    );
    expect(offenses).to.have.length(2);
  });

  it('should report function call inside loop that transitively calls graphql', async () => {
    const offenses = await check(
      {
        'app/views/pages/index.liquid': `{% for item in items %}{% function res = 'my_partial' %}{% endfor %}`,
        'app/lib/my_partial.liquid': `{% graphql result = 'products/get' %}`,
      },
      [NestedGraphQLQuery],
    );
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      "N+1 pattern: {% function 'my_partial' %} inside a {% for %} loop transitively calls a GraphQL query (my_partial). Move the query before the loop and pass data as a variable.",
    );
  });

  it('should report render call inside loop that transitively calls graphql', async () => {
    const offenses = await check(
      {
        'app/views/pages/index.liquid': `{% for item in items %}{% render 'my_partial' %}{% endfor %}`,
        'app/views/partials/my_partial.liquid': `{% graphql result = 'products/get' %}`,
      },
      [NestedGraphQLQuery],
    );
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      "N+1 pattern: {% render 'my_partial' %} inside a {% for %} loop transitively calls a GraphQL query (my_partial). Move the query before the loop and pass data as a variable.",
    );
  });

  it('should report function call that transitively calls graphql through another function', async () => {
    const offenses = await check(
      {
        'app/views/pages/index.liquid': `{% for item in items %}{% function res = 'outer' %}{% endfor %}`,
        'app/lib/outer.liquid': `{% function inner_res = 'inner' %}`,
        'app/lib/inner.liquid': `{% graphql result = 'products/get' %}`,
      },
      [NestedGraphQLQuery],
    );
    expect(offenses).to.have.length(1);
    expect(offenses[0].message).to.equal(
      "N+1 pattern: {% function 'outer' %} inside a {% for %} loop transitively calls a GraphQL query (outer \u2192 inner). Move the query before the loop and pass data as a variable.",
    );
  });

  it('should not report function call inside loop that does not call graphql', async () => {
    const offenses = await check(
      {
        'app/views/pages/index.liquid': `{% for item in items %}{% function res = 'safe_partial' %}{% endfor %}`,
        'app/lib/safe_partial.liquid': `{{ 'hello' }}`,
      },
      [NestedGraphQLQuery],
    );
    expect(offenses).to.have.length(0);
  });

  it('should not report function call inside loop when partial does not exist', async () => {
    const offenses = await check(
      {
        'app/views/pages/index.liquid': `{% for item in items %}{% function res = 'nonexistent' %}{% endfor %}`,
      },
      [NestedGraphQLQuery],
    );
    expect(offenses).to.have.length(0);
  });

  it('should not report function call inside loop with cache wrapping', async () => {
    const offenses = await check(
      {
        'app/views/pages/index.liquid': `{% for item in items %}{% cache 'key' %}{% function res = 'my_partial' %}{% endcache %}{% endfor %}`,
        'app/lib/my_partial.liquid': `{% graphql result = 'products/get' %}`,
      },
      [NestedGraphQLQuery],
    );
    expect(offenses).to.have.length(0);
  });

  it('should handle circular function calls without infinite loop', async () => {
    const offenses = await check(
      {
        'app/views/pages/index.liquid': `{% for item in items %}{% function res = 'partial_a' %}{% endfor %}`,
        'app/lib/partial_a.liquid': `{% function res = 'partial_b' %}`,
        'app/lib/partial_b.liquid': `{% function res = 'partial_a' %}`,
      },
      [NestedGraphQLQuery],
    );
    expect(offenses).to.have.length(0);
  });

  it('should skip function calls with dynamic partial names', async () => {
    const offenses = await check(
      {
        'app/views/pages/index.liquid': `{% for item in items %}{% function res = partial_name %}{% endfor %}`,
      },
      [NestedGraphQLQuery],
    );
    expect(offenses).to.have.length(0);
  });
});
