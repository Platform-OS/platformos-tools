/**
 * JS mirror of `test/fixtures/parity/corpus.ts` so the recorder script can
 * import it from Node without a TS resolver. Keep these two in sync by
 * hand — the TS file is the source of truth for the spec; this JS file is
 * the source of truth for the recorder. The contents must be identical.
 */

const PAGE_WITH_HTML = ['---', 'slug: parity_html', '---', '<div>', '  <h1>hi</h1>', '</div>'].join('\n');

const FRONTMATTER_ONLY = ['---', 'slug: parity_fm_only', '---', ''].join('\n');

const PARTIAL_OK = [
  '{% doc %}',
  '  @param {string} title',
  '{% enddoc %}',
  '<h1>{{ title }}</h1>',
].join('\n');

const PAGE_OK_RENDERS_EXISTING = [
  '---',
  'slug: parity_renders_existing',
  '---',
  "{% render 'blog_posts/card', blog_post: context.params %}",
].join('\n');

const SCHEMA_BAD = ['name: blog_post', '# missing required `properties` key', ''].join('\n');

const TRANSLATION_BAD = ['app:', '  hello: "Hi"'].join('\n');

const GRAPHQL_OK = [
  'query ParityList {',
  '  records(per_page: 5, filter: { table: { value: "blog_post" } }) {',
  '    results { title: property(name: "title") }',
  '  }',
  '}',
].join('\n');

export const CORPUS = [
  {
    id: '01-clean-partial-full',
    filePath: 'app/views/partials/parity/clean.liquid',
    content: PARTIAL_OK,
    mode: 'full',
    description: 'Clean partial with @param + body — expect status: ok or advisory warning',
  },
  {
    id: '02-clean-partial-quick',
    filePath: 'app/views/partials/parity/clean.liquid',
    content: PARTIAL_OK,
    mode: 'quick',
    description: 'Same content, quick mode — skip fix gen / scorecard / domain guide',
  },
  {
    id: '03-page-missing-partial',
    filePath: 'app/views/pages/parity/missing.html.liquid',
    content: ['---', 'slug: parity_missing', '---', "{% render 'does/not/exist/at/all' %}"].join('\n'),
    mode: 'full',
    description: 'Page renders a partial that does not exist on disk → MissingPartial error',
  },
  {
    id: '04-orphaned-partial',
    filePath: 'app/views/partials/parity/orphan.liquid',
    content: '<p>I am orphaned.</p>',
    mode: 'full',
    description: 'Partial with no callers in the fixture → OrphanedPartial warning',
  },
  {
    id: '05-graphql-clean',
    filePath: 'app/graphql/parity/list.graphql',
    content: GRAPHQL_OK,
    mode: 'full',
    description: 'GraphQL query that references a known schema property — no errors',
  },
  {
    id: '06-schema-yaml-bad',
    filePath: 'app/schema/parity_bad.yml',
    content: SCHEMA_BAD,
    mode: 'quick',
    description: 'Schema YAML missing `properties` → pos-supervisor:SchemaStructure error',
  },
  {
    id: '07-translation-yaml-bad',
    filePath: 'app/translations/en.yml',
    content: TRANSLATION_BAD,
    mode: 'quick',
    description: 'Translation YAML with no locale wrapper → TranslationMissingLocaleKey error',
  },
  {
    id: '08-shopify-contamination',
    filePath: 'app/views/pages/parity/shopify.html.liquid',
    content: ['---', 'slug: parity_shopify', '---', '{{ product.title }}'].join('\n'),
    mode: 'full',
    description: 'Shopify-only `product` object in a page → UndefinedObject + Shopify suggestion',
  },
  {
    id: '09-html-in-page',
    filePath: 'app/views/pages/parity/html.html.liquid',
    content: PAGE_WITH_HTML,
    mode: 'full',
    description: 'Page with inline HTML and no renders → pos-supervisor:HtmlInPage warning',
  },
  {
    id: '10-frontmatter-only-page',
    filePath: 'app/views/pages/parity/empty.html.liquid',
    content: FRONTMATTER_ONLY,
    mode: 'full',
    description: 'Page with frontmatter but no body → pos-supervisor:FrontmatterOnlyPage warning',
  },
  {
    id: '11-page-renders-existing',
    filePath: 'app/views/pages/parity/renders_existing.html.liquid',
    content: PAGE_OK_RENDERS_EXISTING,
    mode: 'full',
    description: 'Page rendering an EXISTING fixture partial — expect no errors',
  },
  {
    id: '12-unknown-filter',
    filePath: 'app/views/partials/parity/unknown_filter.liquid',
    content: [
      '{% doc %}',
      '  @param {string} name',
      '{% enddoc %}',
      '{{ name | totally_made_up_filter }}',
    ].join('\n'),
    mode: 'full',
    description: 'Partial pipes through a bogus filter → UnknownFilter error + closest-match suggestion',
  },
  {
    id: '13-deprecated-include',
    filePath: 'app/views/partials/parity/deprecated.liquid',
    content: "{% include 'shared/header' %}",
    mode: 'full',
    description: 'Deprecated {% include %} tag → DeprecatedTag warning + enricher hint',
  },
];
