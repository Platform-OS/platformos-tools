import { expect, describe, it } from 'vitest';
import { CircularRender } from '.';
import { check } from '../../test';

describe('Module: CircularRender', () => {
  it('should report a simple cycle (A renders B, B renders A)', async () => {
    const offenses = await check(
      {
        'app/views/partials/a.liquid': "{% render 'b' %}",
        'app/views/partials/b.liquid': "{% render 'a' %}",
      },
      [CircularRender],
    );

    expect(offenses).to.have.length(2);
    expect(offenses).to.containOffense({
      check: 'CircularRender',
      uri: 'file:///app/views/partials/a.liquid',
    });
    expect(offenses).to.containOffense({
      check: 'CircularRender',
      uri: 'file:///app/views/partials/b.liquid',
    });
  });

  it('should report a transitive cycle (A -> B -> C -> A)', async () => {
    const offenses = await check(
      {
        'app/views/partials/a.liquid': "{% render 'b' %}",
        'app/views/partials/b.liquid': "{% render 'c' %}",
        'app/views/partials/c.liquid': "{% render 'a' %}",
      },
      [CircularRender],
    );

    expect(offenses).to.have.length(3);
  });

  it('should report a self-referencing partial', async () => {
    const offenses = await check(
      {
        'app/views/partials/a.liquid': "{% render 'a' %}",
      },
      [CircularRender],
    );

    expect(offenses).to.have.length(1);
    expect(offenses).to.containOffense({
      check: 'CircularRender',
      uri: 'file:///app/views/partials/a.liquid',
    });
  });

  it('should not report when there is no cycle', async () => {
    const offenses = await check(
      {
        'app/views/partials/a.liquid': "{% render 'b' %}",
        'app/views/partials/b.liquid': "{% render 'c' %}",
        'app/views/partials/c.liquid': '<p>end</p>',
      },
      [CircularRender],
    );

    expect(offenses).to.have.length(0);
  });

  it('should skip variable lookups', async () => {
    const offenses = await check(
      {
        'app/views/partials/a.liquid': '{% render myvar %}',
      },
      [CircularRender],
    );

    expect(offenses).to.have.length(0);
  });

  it('should detect cycles via function tags', async () => {
    const offenses = await check(
      {
        'app/views/partials/a.liquid': "{% function res = 'b' %}",
        'app/views/partials/b.liquid': "{% function res = 'a' %}",
      },
      [CircularRender],
    );

    expect(offenses).to.have.length(2);
  });

  it('should detect cycles with mixed render and function tags', async () => {
    const offenses = await check(
      {
        'app/views/partials/a.liquid': "{% render 'b' %}",
        'app/views/partials/b.liquid': "{% function res = 'a' %}",
      },
      [CircularRender],
    );

    expect(offenses).to.have.length(2);
  });

  it('should detect cycles via include tags', async () => {
    const offenses = await check(
      {
        'app/views/partials/a.liquid': "{% include 'b' %}",
        'app/views/partials/b.liquid': "{% include 'a' %}",
      },
      [CircularRender],
    );

    expect(offenses).to.have.length(2);
  });

  it('should not crash when a partial in the chain does not exist', async () => {
    const offenses = await check(
      {
        'app/views/partials/a.liquid': "{% render 'b' %}",
        'app/views/partials/b.liquid': "{% render 'nonexistent' %}",
      },
      [CircularRender],
    );

    expect(offenses).to.have.length(0);
  });

  it('should not crash when a dependency has a parse error', async () => {
    const offenses = await check(
      {
        'app/views/partials/a.liquid': "{% render 'b' %}",
        'app/views/partials/b.liquid': '{% render %}{% unclosed',
      },
      [CircularRender],
    );

    expect(offenses).to.have.length(0);
  });

  it('should handle diamond dependencies without false positives', async () => {
    const offenses = await check(
      {
        'app/views/partials/a.liquid': "{% render 'b' %}{% render 'c' %}",
        'app/views/partials/b.liquid': "{% render 'd' %}",
        'app/views/partials/c.liquid': "{% render 'd' %}",
        'app/views/partials/d.liquid': '<p>end</p>',
      },
      [CircularRender],
    );

    expect(offenses).to.have.length(0);
  });

  it('should handle deep chains without cycles (depth limit)', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 55; i++) {
      files[`app/views/partials/p${i}.liquid`] = `{% render 'p${i + 1}' %}`;
    }
    files['app/views/partials/p55.liquid'] = '<p>end</p>';

    const offenses = await check(files, [CircularRender]);
    expect(offenses).to.have.length(0);
  });

  it('should point the diagnostic at the render tag position', async () => {
    const offenses = await check(
      {
        'app/views/partials/a.liquid': "{% render 'b' %}",
        'app/views/partials/b.liquid': "{% render 'a' %}",
      },
      [CircularRender],
    );

    const offenseA = offenses.find((o) => o.uri === 'file:///app/views/partials/a.liquid');
    expect(offenseA).toBeDefined();
    expect(offenseA!.start.index).toBe(10);
    expect(offenseA!.end.index).toBe(13);
  });
});
