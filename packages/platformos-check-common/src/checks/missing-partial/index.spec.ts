import { expect, describe, it } from 'vitest';
import { MissingPartial } from '.';
import { check } from '../../test';

describe('Module: MissingPartial', () => {
  it('should report missing partial errors', async () => {
    const testCases = [
      {
        testCase: 'should report the missing partial to be rendered with "render"',
        file: `
        {% render 'missing' with foo as arg          %}
        {% render myvariable %}
      `,
        expected: {
          check: 'MissingPartial',
          end: {
            character: 27,
            index: 28,
            line: 1,
          },
          fix: undefined,
          message: "'missing' does not exist",
          severity: 0,
          start: {
            character: 18,
            index: 19,
            line: 1,
          },
          suggest: undefined,
          type: 'LiquidHtml',
          uri: 'file:///app/views/partials/partial.liquid',
        },
        filesWith: (file: string) => ({
          'app/views/partials/partial.liquid': file,
        }),
      },
      {
        testCase: 'should report the missing partial to be rendered with "include"',
        file: "{% include 'missing' %}",
        expected: {
          message: "'missing' does not exist",
          uri: 'file:///app/views/partials/partial.liquid',
          start: { index: 11, line: 0, character: 11 },
          end: { index: 20, line: 0, character: 20 },
        },
        filesWith: (file: string) => ({
          'app/views/partials/partial.liquid': file,
        }),
      },
      {
        testCase: 'should report the missing partial to be rendered with "theme_render_rc"',
        file: "{% theme_render_rc 'missing' %}",
        expected: {
          message: "'missing' does not exist",
          uri: 'file:///app/views/partials/partial.liquid',
          start: { index: 19, line: 0, character: 19 },
          end: { index: 28, line: 0, character: 28 },
        },
        filesWith: (file: string) => ({
          'app/views/partials/partial.liquid': file,
        }),
      },
    ];
    for (const { testCase, file, expected, filesWith } of testCases) {
      const offenses = await check(filesWith(file), [MissingPartial]);

      expect(offenses).to.have.length(1);
      expect(offenses, testCase).to.containOffense({
        check: MissingPartial.meta.code,
        ...expected,
      });
    }
  });

  it('should not report when the partial exists for theme_render_rc', async () => {
    const offenses = await check(
      {
        'app/views/partials/partial.liquid':
          "{% theme_render_rc 'my_product', class: 'featured' %}",
        'app/views/partials/my_product.liquid': '<div>Product</div>',
      },
      [MissingPartial],
    );

    expect(offenses).to.have.length(0);
  });

  it('should not report theme_render_rc with variable lookup', async () => {
    const offenses = await check(
      {
        'app/views/partials/partial.liquid':
          "{% theme_render_rc 'existing' for products as product %}",
        'app/views/partials/existing.liquid': '{{ product }}',
      },
      [MissingPartial],
    );

    expect(offenses).to.have.length(0);
  });

  describe('theme_render_rc with theme_search_paths', () => {
    it('should find partial via first search path (highest priority)', async () => {
      const offenses = await check(
        {
          'app/config.yml': 'theme_search_paths:\n  - theme/dress\n  - theme/simple',
          'app/views/partials/page.liquid': "{% theme_render_rc 'another/super/partial' %}",
          'app/views/partials/theme/dress/another/super/partial.liquid': 'dress partial',
          'app/views/partials/theme/simple/another/super/partial.liquid': 'simple partial',
          'app/views/partials/another/super/partial.liquid': 'default partial',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(0);
    });

    it('should find partial via second search path when first does not have it', async () => {
      const offenses = await check(
        {
          'app/config.yml': 'theme_search_paths:\n  - theme/dress\n  - theme/simple',
          'app/views/partials/page.liquid': "{% theme_render_rc 'my/partial' %}",
          'app/views/partials/theme/simple/my/partial.liquid': 'simple partial',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(0);
    });

    it('should fallback to default path when no search path matches', async () => {
      const offenses = await check(
        {
          'app/config.yml': 'theme_search_paths:\n  - theme/dress\n  - theme/simple',
          'app/views/partials/page.liquid': "{% theme_render_rc 'default' %}",
          'app/views/partials/default.liquid': 'default partial',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(0);
    });

    it('should report missing when partial is not found in any search path or fallback', async () => {
      const offenses = await check(
        {
          'app/config.yml': 'theme_search_paths:\n  - theme/dress\n  - theme/simple',
          'app/views/partials/page.liquid': "{% theme_render_rc 'my/missing' %}",
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(1);
      expect(offenses).to.containOffense({
        check: 'MissingPartial',
        message: "'my/missing' does not exist",
      });
    });

    it('should respect empty string in search paths as default path position', async () => {
      // With ['theme/dress', '', 'theme/simple'], the empty string means "default path"
      // appears between dress and simple in priority order.
      // So if dress doesn't have it but default path does, use default (skip simple).
      const offenses = await check(
        {
          'app/config.yml': "theme_search_paths:\n  - theme/dress\n  - ''\n  - theme/simple",
          'app/views/partials/page.liquid': "{% theme_render_rc 'my/partial' %}",
          'app/views/partials/my/partial.liquid': 'default partial',
          'app/views/partials/theme/simple/my/partial.liquid': 'simple partial',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(0);
    });

    it('should expand Liquid expressions as wildcards and find matching partial', async () => {
      // {{ context.constants.MY_THEME }} acts as a wildcard matching any subdirectory.
      // With theme/custom_theme/my/partial.liquid existing, the wildcard should match it.
      const offenses = await check(
        {
          'app/config.yml':
            'theme_search_paths:\n  - theme/{{ context.constants.MY_THEME }}\n  - theme/simple',
          'app/views/partials/page.liquid': "{% theme_render_rc 'my/partial' %}",
          'app/views/partials/theme/custom_theme/my/partial.liquid': 'custom theme partial',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(0);
    });

    it('should find partial via static path when dynamic path has no match', async () => {
      const offenses = await check(
        {
          'app/config.yml':
            'theme_search_paths:\n  - theme/{{ context.constants.MY_THEME }}\n  - theme/simple',
          'app/views/partials/page.liquid': "{% theme_render_rc 'product' %}",
          'app/views/partials/theme/simple/product.liquid': 'simple partial',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(0);
    });

    it('should report missing when wildcard expansion finds no matching partial', async () => {
      // Dynamic path expands but the partial doesn't exist in any expanded directory
      const offenses = await check(
        {
          'app/config.yml': 'theme_search_paths:\n  - theme/{{ context.constants.MY_THEME }}',
          'app/views/partials/page.liquid': "{% theme_render_rc 'missing' %}",
          'app/views/partials/theme/custom/other.liquid': 'wrong partial',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(1);
      expect(offenses).to.containOffense({
        check: 'MissingPartial',
        message: "'missing' does not exist",
      });
    });

    it('should handle multiple Liquid expressions in a path', async () => {
      // E.g. "{{ context.constants.BRAND }}/{{ context.constants.TIER }}" - both segments are wildcards
      const offenses = await check(
        {
          'app/config.yml':
            'theme_search_paths:\n  - "{{ context.constants.BRAND }}/{{ context.constants.TIER }}"',
          'app/views/partials/page.liquid': "{% theme_render_rc 'card' %}",
          'app/views/partials/acme/premium/card.liquid': 'acme premium card',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(0);
    });

    it('should render partial which includes path in its name', async () => {
      // When the partial name itself includes the search path prefix
      const offenses = await check(
        {
          'app/config.yml': 'theme_search_paths:\n  - theme/simple',
          'app/views/partials/page.liquid': "{% theme_render_rc 'theme/simple/my/partial' %}",
          'app/views/partials/theme/simple/my/partial.liquid': 'simple partial',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(0);
    });

    it('should work with nested partial directories', async () => {
      const offenses = await check(
        {
          'app/config.yml': 'theme_search_paths:\n  - theme/dress\n  - theme/simple',
          'app/views/partials/page.liquid': "{% theme_render_rc 'components/card' %}",
          'app/views/partials/theme/dress/components/card.liquid': 'dress card',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(0);
    });

    it('should not affect regular render tags even when config exists', async () => {
      // 'card' exists under the search path prefix, so theme_render_rc would find it,
      // but render ignores search paths entirely and looks only in the default locations.
      const offenses = await check(
        {
          'app/config.yml': 'theme_search_paths:\n  - theme/dress\n  - theme/simple',
          'app/views/partials/page.liquid': "{% render 'card' %}",
          'app/views/partials/theme/simple/card.liquid': 'simple card',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(1);
      expect(offenses).to.containOffense({
        check: 'MissingPartial',
        message: "'card' does not exist",
      });
    });

    it('should also search in app/lib with search paths', async () => {
      const offenses = await check(
        {
          'app/config.yml': 'theme_search_paths:\n  - theme/dress',
          'app/views/partials/page.liquid': "{% theme_render_rc 'my_helper' %}",
          'app/lib/theme/dress/my_helper.liquid': 'helper from lib',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(0);
    });

    it('should fallback to standard render resolution when no config.yml exists', async () => {
      const offenses = await check(
        {
          'app/views/partials/page.liquid': "{% theme_render_rc 'existing' %}",
          'app/views/partials/existing.liquid': 'found it',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(0);
    });

    it('should handle theme_render_rc with named arguments and search paths', async () => {
      const offenses = await check(
        {
          'app/config.yml': 'theme_search_paths:\n  - theme/dress',
          'app/views/partials/page.liquid':
            "{% theme_render_rc 'product', class: 'featured', size: 'large' %}",
          'app/views/partials/theme/dress/product.liquid': '{{ class }} {{ size }}',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(0);
    });

    it('should handle theme_render_rc with for/with and search paths', async () => {
      const offenses = await check(
        {
          'app/config.yml': 'theme_search_paths:\n  - theme/dress',
          'app/views/partials/page.liquid': "{% theme_render_rc 'item' for products as product %}",
          'app/views/partials/theme/dress/item.liquid': '{{ product }}',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(0);
    });

    it('should treat empty theme_search_paths array same as absent', async () => {
      const offenses = await check(
        {
          'app/config.yml': 'theme_search_paths: []',
          'app/views/partials/page.liquid': "{% theme_render_rc 'existing' %}",
          'app/views/partials/existing.liquid': 'found it',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(0);
    });

    it('should handle malformed theme_search_paths (not an array)', async () => {
      const offenses = await check(
        {
          'app/config.yml': 'theme_search_paths: some_string',
          'app/views/partials/page.liquid': "{% theme_render_rc 'existing' %}",
          'app/views/partials/existing.liquid': 'found it',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(0);
    });

    it('should handle multiple theme_render_rc tags in one file', async () => {
      const offenses = await check(
        {
          'app/config.yml': 'theme_search_paths:\n  - theme/dress\n  - theme/simple',
          'app/views/partials/page.liquid':
            "{% theme_render_rc 'header' %} {% theme_render_rc 'footer' %} {% theme_render_rc 'missing' %}",
          'app/views/partials/theme/dress/header.liquid': 'header',
          'app/views/partials/theme/simple/footer.liquid': 'footer',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(1);
      expect(offenses).to.containOffense({
        check: 'MissingPartial',
        message: "'missing' does not exist",
      });
    });

    it('should handle theme_render_rc inside {% liquid %} block', async () => {
      const offenses = await check(
        {
          'app/config.yml': 'theme_search_paths:\n  - theme/dress',
          'app/views/partials/page.liquid': "{% liquid\n  theme_render_rc 'card'\n%}",
          'app/views/partials/theme/dress/card.liquid': 'card',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(0);
    });

    it('should resolve module-prefixed partials via fallback', async () => {
      const offenses = await check(
        {
          'app/config.yml': 'theme_search_paths:\n  - theme/dress',
          'app/views/partials/page.liquid': "{% theme_render_rc 'modules/shop/card' %}",
          'modules/shop/public/views/partials/card.liquid': 'module card',
        },
        [MissingPartial],
      );

      expect(offenses).to.have.length(0);
    });

    it('should handle non-string entries in theme_search_paths gracefully', async () => {
      const offenses = await check(
        {
          'app/config.yml': 'theme_search_paths:\n  - 123\n  - true',
          'app/views/partials/page.liquid': "{% theme_render_rc 'card' %}",
          'app/views/partials/card.liquid': 'default card',
        },
        [MissingPartial],
      );

      // 123/card and true/card won't exist, but fallback to unprefixed finds it
      expect(offenses).to.have.length(0);
    });
  });
});
