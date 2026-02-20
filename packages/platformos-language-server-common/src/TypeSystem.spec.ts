import {
  AssignMarkup,
  LiquidVariable,
  LiquidVariableOutput,
  NamedTags,
  NodeTypes,
  toLiquidHtmlAST,
} from '@platformos/liquid-html-parser';
import {
  MetafieldDefinitionMap,
  path as pathUtils,
  BasicParamTypes,
  ObjectEntry,
} from '@platformos/platformos-check-common';
import { assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { URI } from 'vscode-uri';
import { SettingsSchemaJSONFile } from './settings';
import { ArrayType, ShapeType, TypeSystem, UnionType } from './TypeSystem';
import { isLiquidVariableOutput, isNamedLiquidTag } from './utils';

describe('Module: TypeSystem', () => {
  let typeSystem: TypeSystem;
  let settingsProvider: any;
  const literalContexts = [
    { value: `10`, type: 'number' },
    { value: `'string'`, type: 'string' },
    { value: `true`, type: 'boolean' },
    //      { value: `null`, type: 'untyped' },
  ];

  beforeEach(() => {
    const _objects: ObjectEntry[] = [
      {
        name: 'all_products',
        return_type: [{ type: 'array', array_value: 'product' }],
      },
      {
        name: 'product',
        access: {
          global: true,
          parents: [],
          template: [],
        },
        return_type: [],
        properties: [
          {
            name: 'featured_image',
            description: 'ze best image for ze product',
            return_type: [{ type: 'image', name: '' }],
          },
          {
            name: 'images',
            description: 'all images for ze product',
            return_type: [{ type: 'array', array_value: 'image' }],
          },
          {
            name: 'title',
            description: 'the title of the product',
            return_type: [{ type: 'string', name: '' }],
          },
          {
            name: 'metafields',
            return_type: [{ type: 'untyped', name: '' }],
          },
        ],
      },
      {
        name: 'metafield',
        properties: [
          {
            name: 'type',
            description: 'the type of the metafield',
            return_type: [{ type: 'string', name: '' }],
          },
          {
            name: 'value',
            description: 'the value of the metafield',
            return_type: [{ type: 'untyped', name: '' }],
          },
        ],
      },
      {
        name: 'settings',
        return_type: [],
        properties: [], // these should be populated dynamically
      },
      {
        name: 'predictive_search',
        access: { global: false, parents: [], template: [] },
        return_type: [],
      },
      {
        name: 'comment',
        access: { global: false, parents: [], template: [] },
        return_type: [],
      },
      {
        name: 'recommendations',
        access: { global: false, parents: [], template: [] },
        return_type: [],
      },
      {
        name: 'app',
        access: { global: false, parents: [], template: [] },
        return_type: [],
      },
      {
        name: 'section',
        access: { global: false, parents: [], template: [] },
        return_type: [],
        properties: [
          {
            name: 'settings',
            return_type: [{ type: 'untyped', name: '' }],
          },
        ],
      },
      {
        name: 'block',
        access: { global: false, parents: [], template: [] },
        return_type: [],
        properties: [
          {
            name: 'settings',
            return_type: [{ type: 'untyped', name: '' }],
          },
        ],
      },
      {
        name: 'locale',
        access: { global: false, parents: [], template: [] },
        return_type: [],
      },
    ];
    settingsProvider = vi.fn().mockResolvedValue([]);
    typeSystem = new TypeSystem(
      {
        graphQL: async () => null,
        tags: async () => [],
        objects: async () => _objects,
        liquidDrops: async () => _objects,
        filters: async () => [
          {
            name: 'size',
            return_type: [{ type: 'number', name: '' }],
          },
        ],
        systemTranslations: async () => ({}),
      },
      settingsProvider,
      async (_uri: string) => {
        return {
          article: [],
          blog: [],
          collection: [],
          company: [],
          company_location: [],
          location: [],
          market: [],
          order: [
            {
              key: 'prods',
              name: 'products',
              namespace: 'related',
              description: 'related products',
              type: {
                category: 'REFERENCE',
                name: 'list.product_reference',
              },
            },
          ],
          page: [],
          product: [
            {
              key: 'code',
              name: 'code',
              namespace: 'manufacturer',
              description: 'the code provided by the manufacturer',
              type: {
                category: 'TEXT',
                name: 'single_line_text_field',
              },
            },
            {
              key: 'id',
              name: 'id',
              namespace: 'manufacturer',
              description: 'the id provided by the manufacturer',
              type: {
                category: 'INTEGER',
                name: 'number_integer',
              },
            },
            {
              key: 'is_rare',
              name: 'is_rare',
              namespace: 'custom',
              description: 'is this product rare?',
              type: {
                category: 'BOOLEAN',
                name: 'boolean',
              },
            },
          ],
          variant: [],
          shop: [],
        } as MetafieldDefinitionMap;
      },
    );
  });

  it('should return the type of assign markup nodes (basic test)', async () => {
    for (const { value, type } of literalContexts) {
      const ast = toLiquidHtmlAST(`{% assign x = ${value} %}`);
      const assignMarkup = (ast as any).children[0].markup as AssignMarkup;
      const inferredType = await typeSystem.inferType(assignMarkup, ast, 'file:///file.liquid');
      expect(inferredType, value).to.equal(type);
    }
  });

  it('should return the type of other variables', async () => {
    for (const { value, type } of literalContexts) {
      const ast = toLiquidHtmlAST(`{% assign x = ${value} %}{% assign y = x %}`);
      const yVariable = (ast as any).children[1].markup as AssignMarkup;
      const inferredType = await typeSystem.inferType(yVariable, ast, 'file:///file.liquid');
      expect(inferredType).to.equal(type);
    }
  });

  it('should return the type of expressions', async () => {
    for (const { value, type } of literalContexts) {
      const ast = toLiquidHtmlAST(`{{ ${value} }}`);
      const output = ast.children[0] as LiquidVariableOutput;
      const variable = output.markup;
      if (typeof variable === 'string') throw new Error('expecting real deal');
      const expression = variable.expression;
      const inferredType = await typeSystem.inferType(expression, ast, 'file:///file.liquid');
      expect(inferredType, value).to.equal(type);
    }
  });

  it('should return the type of array variables', async () => {
    const ast = toLiquidHtmlAST(`{% assign x = all_products %}`);
    const xVariable = (ast as any).children[0].markup as AssignMarkup;
    const inferredType = await typeSystem.inferType(xVariable, ast, 'file:///file.liquid');
    expect(inferredType).to.eql({ kind: 'array', valueType: 'product' });
  });

  it('should return the type of object properties', async () => {
    const ast = toLiquidHtmlAST(`{% assign x = all_products[0].featured_image %}`);
    const xVariable = (ast as any).children[0].markup as AssignMarkup;
    const inferredType = await typeSystem.inferType(xVariable, ast, 'file:///file.liquid');
    expect(inferredType).to.equal('image');
  });

  it('should return the type of filtered variables', async () => {
    const ast = toLiquidHtmlAST(`{% assign x = product | size %}`);
    const xVariable = (ast as any).children[0].markup as AssignMarkup;
    const inferredType = await typeSystem.inferType(xVariable, ast, 'file:///file.liquid');
    expect(inferredType).to.equal('number');
  });

  describe('when using string builtin methods', () => {
    it('should return number for size', async () => {
      const ast = toLiquidHtmlAST(`{{ product.title.size }}`);
      const xVariable = (ast as any).children[0].markup as LiquidVariable;
      const inferredType = await typeSystem.inferType(xVariable, ast, 'file:///file.liquid');
      expect(inferredType).to.equal('number');
    });

    ['first', 'last'].forEach((method) => {
      it(`should return string for ${method}`, async () => {
        const ast = toLiquidHtmlAST(`{{ product.title.${method} }}`);
        const xVariable = (ast as any).children[0].markup as LiquidVariable;
        const inferredType = await typeSystem.inferType(xVariable, ast, 'file:///file.liquid');
        expect(inferredType).to.equal('string');
      });
    });
  });

  describe('when using array builtin methods', () => {
    it('should return number for size', async () => {
      const ast = toLiquidHtmlAST(`{{ product.images.size }}`);
      const xVariable = (ast as any).children[0].markup as LiquidVariable;
      const inferredType = await typeSystem.inferType(xVariable, ast, 'file:///file.liquid');
      expect(inferredType).to.equal('number');
    });

    ['first', 'last'].forEach((method) => {
      it(`should return the value type of the array for ${method}`, async () => {
        const ast = toLiquidHtmlAST(`{{ product.images.${method} }}`);
        const xVariable = (ast as any).children[0].markup as LiquidVariable;
        const inferredType = await typeSystem.inferType(xVariable, ast, 'file:///file.liquid');
        expect(inferredType).to.equal('image');
      });
    });
  });

  describe('when using the default filter', () => {
    it('should return the type of the default value literal', async () => {
      const ast = toLiquidHtmlAST(`
        {% assign x = x | default: 10 %}
      `);
      const xVariable = (ast as any).children[0].markup as AssignMarkup;
      const inferredType = await typeSystem.inferType(xVariable, ast, 'file:///file.liquid');
      expect(inferredType).to.equal('number');
    });

    it('should return the type of the default value lookup', async () => {
      const ast = toLiquidHtmlAST(`
        {% assign d = product.featured_image %}
        {% assign x = unknown | default: d %}
      `);
      const xVariable = (ast as any).children[1].markup as AssignMarkup;
      const inferredType = await typeSystem.inferType(xVariable, ast, 'file:///file.liquid');
      expect(inferredType).to.equal('image');
    });
  });

  it('should return the type of variables in for loop', async () => {
    const ast = toLiquidHtmlAST(`{% for item in all_products %}{{ item }}{% endfor %}`);
    const forLoop = ast.children[0];
    assert(isNamedLiquidTag(forLoop, NamedTags.for) && forLoop.children?.length === 1);
    const branch = forLoop.children[0];
    assert(branch.type === NodeTypes.LiquidBranch);
    const variableOutput = branch.children[0];
    assert(isLiquidVariableOutput(variableOutput));
    const variable = variableOutput.markup;

    const inferredType = await typeSystem.inferType(variable, ast, 'file:///file.liquid');
    expect(inferredType).to.equal('product');
  });

  it('should patch the properties of settings when a schema is available', async () => {
    settingsProvider.mockResolvedValue([
      {
        name: 'category',
        settings: [
          {
            id: 'slide',
            label: 'Slide label',
            type: 'checkbox',
          },
          {
            id: 'my_font',
            label: 'my font',
            type: 'font_picker',
          },
        ],
      },
    ] as SettingsSchemaJSONFile);

    const contexts = [
      { id: 'slide', expectedType: 'boolean' },
      { id: 'my_font', expectedType: 'font' },
    ];
    for (const { id, expectedType } of contexts) {
      const ast = toLiquidHtmlAST(`{{ settings.${id} }}`);
      const variableOutput = ast.children[0];
      assert(isLiquidVariableOutput(variableOutput));
      const inferredType = await typeSystem.inferType(
        variableOutput.markup,
        ast,
        'file:///file.liquid',
      );
      expect(inferredType).to.eql(expectedType);
    }
  });

  it('should support section settings in section files', async () => {
    const sourceCode = `
      {{ section.settings.my_list }}
      {% schema %}
      {
        "name": "section-settings-example",
        "tag": "section",
        "settings": [
          {
            "id": "my_list",
            "label": "t:my-setting.label",
            "type": "product_list"
          }
        ]
      }
      {% endschema %}
    `;
    const ast = toLiquidHtmlAST(sourceCode);
    const variableOutput = ast.children[0];
    assert(isLiquidVariableOutput(variableOutput));
    const inferredType = await typeSystem.inferType(
      variableOutput.markup,
      ast,
      'file:///sections/my-section.liquid',
    );
    expect(inferredType).to.eql({ kind: 'array', valueType: 'product' } as ArrayType);
  });

  it('should support block settings in blocks files', async () => {
    const sourceCode = `
      {{ block.settings.my_list }}
      {% schema %}
      {
        "name": "section-settings-example",
        "tag": "section",
        "settings": [
          {
            "id": "my_list",
            "label": "t:my-setting.label",
            "type": "product_list"
          }
        ]
      }
      {% endschema %}
    `;
    const ast = toLiquidHtmlAST(sourceCode);
    const variableOutput = ast.children[0];
    assert(isLiquidVariableOutput(variableOutput));
    const inferredType = await typeSystem.inferType(
      variableOutput.markup,
      ast,
      'file:///blocks/my-section.liquid',
    );
    expect(inferredType).to.eql({ kind: 'array', valueType: 'product' } as ArrayType);
  });

  // TODO
  it.skip('should support narrowing the type of blocks', async () => {
    const sourceCode = `
      {% for block in section.blocks %}
        {% case block.type %}
          {% when 'slide' %}
            {{ block.settings.image }}
          {% else %}
        {% endcase }
        {% if block.type == 'slide' %}
          {{ block.settings.image }}
        {% endif %}
      {% endfor %}
      {% schema %}
      {
        "name": "Slideshow",
        "tag": "section",
        "class": "slideshow",
        "settings": [],
        "blocks": [
          {
            "name": "Slide",
            "type": "slide",
            "settings": [
              {
                "type": "image_picker",
                "id": "image",
                "label": "Image"
              }
            ]
          }
        ]
      }
      {% endschema %}
    `;
    const ast = toLiquidHtmlAST(sourceCode);
  });

  it('should support path-contextual variable types', async () => {
    let inferredType: string | ArrayType | ShapeType | UnionType;
    const contexts: [string, string][] = [
      ['section', 'sections/my-section.liquid'],
      ['comment', 'sections/main-article.liquid'],
      ['block', 'blocks/my-block.liquid'],
      ['predictive_search', 'sections/predictive-search.liquid'],
      ['recommendations', 'sections/recommendations.liquid'],
      ['app', 'blocks/recommendations.liquid'],
      ['app', 'app/views/partials/recommendations.liquid'],
      ['locale', 'layout/checkout.liquid'],
    ];
    for (const [object, path] of contexts) {
      const sourceCode = `{{ ${object} }}`;
      const ast = toLiquidHtmlAST(sourceCode);
      const variableOutput = ast.children[0];
      assert(isLiquidVariableOutput(variableOutput));
      inferredType = await typeSystem.inferType(
        variableOutput.markup,
        ast,
        // This will be different on Windows ^^
        pathUtils.normalize(URI.from({ scheme: 'file', path })),
      );
      expect(inferredType).to.eql(object);
      inferredType = await typeSystem.inferType(
        variableOutput.markup,
        ast,
        // This will be different on Windows ^^
        pathUtils.normalize(URI.from({ scheme: 'file', path: 'file.liquid' })),
      );
      expect(inferredType).to.eql('unknown');
    }
  });

  describe('LiquidDoc inferred type', () => {
    const liquidDocParamTypeToTypeMap = {
      [BasicParamTypes.String]: 'string',
      [BasicParamTypes.Number]: 'number',
      [BasicParamTypes.Boolean]: 'boolean',
      [BasicParamTypes.Object]: 'untyped',
      invalid: 'untyped',
    };

    Object.entries(liquidDocParamTypeToTypeMap).forEach(([docParamType, expectedType]) => {
      it(`should support basic liquid doc params type: ${docParamType}`, async () => {
        const sourceCode = `
          {% doc %}
            @param {${docParamType}} data - some data
          {% enddoc %}
          {{ data }}
        `;
        const ast = toLiquidHtmlAST(sourceCode);
        const variableOutput = ast.children[1];
        assert(isLiquidVariableOutput(variableOutput));
        const inferredType = await typeSystem.inferType(
          variableOutput.markup,
          ast,
          'file:///snippets/example.liquid',
        );
        expect(inferredType).to.eql(expectedType);
      });
    });

    it(`should support complex liquid doc params type: product`, async () => {
      const sourceCode = `
        {% doc %}
          @param {product} data - some data
        {% enddoc %}
        {{ data }}
      `;
      const ast = toLiquidHtmlAST(sourceCode);
      const variableOutput = ast.children[1];
      assert(isLiquidVariableOutput(variableOutput));
      const inferredType = await typeSystem.inferType(
        variableOutput.markup,
        ast,
        'file:///snippets/example.liquid',
      );
      expect(inferredType).to.eql('product');
    });

    it(`should support array liquid doc params type: product[]`, async () => {
      const sourceCode = `
        {% doc %}
          @param {product[]} data - some data
        {% enddoc %}
        {{ data }}
      `;
      const ast = toLiquidHtmlAST(sourceCode);
      const variableOutput = ast.children[1];
      assert(isLiquidVariableOutput(variableOutput));
      const inferredType = await typeSystem.inferType(
        variableOutput.markup,
        ast,
        'file:///snippets/example.liquid',
      );
      expect(inferredType).to.eql({
        kind: 'array',
        valueType: 'product',
      });
    });
  });

  describe('cross-file type inference (A -> B -> C)', () => {
    it('should infer types through chain of function calls with GraphQL at the end', async () => {
      // Setup: File C calls GraphQL, B calls C, A calls B
      // The type from GraphQL should propagate: C -> B -> A

      const { MockFileSystem } = await import('@platformos/platformos-check-common/src/test');
      const { DocumentsLocator } = await import('@platformos/platformos-common');

      const mockFiles = {
        // File C: calls GraphQL and returns the result
        'app/lib/deep/get_user.liquid': `{% graphql result %}
query {
  user {
    id
    name
    email
  }
}
{% endgraphql %}
{% return result %}`,
        // File B: calls C and returns its result
        'app/lib/middle/get_data.liquid': `{% function user_data = 'deep/get_user' %}
{% return user_data %}`,
        // GraphQL query file (for file-based GraphQL test)
        'app/graphql/get_products.graphql': `query {
  products {
    id
    title
    price
  }
}`,
        // File that uses file-based GraphQL
        'app/lib/products/fetch.liquid': `{% graphql result = 'get_products' %}
{% return result %}`,
        // File that calls the file-based GraphQL function
        'app/lib/products/wrapper.liquid': `{% function products = 'products/fetch' %}
{% return products %}`,
      };

      const rootUri = 'file:///project';
      const fs = new MockFileSystem(mockFiles, rootUri);
      const documentsLocator = new DocumentsLocator(fs);

      const crossFileTypeSystem = new TypeSystem(
        {
          graphQL: async () => null, // No schema for simple inference
          tags: async () => [],
          objects: async () => [],
          liquidDrops: async () => [],
          filters: async () => [],
          systemTranslations: async () => ({}),
        },
        async () => [],
        async () => ({
          article: [],
          blog: [],
          collection: [],
          company: [],
          company_location: [],
          location: [],
          market: [],
          order: [],
          page: [],
          product: [],
          variant: [],
          shop: [],
        }),
        fs,
        documentsLocator,
        async () => rootUri,
      );

      // Test 1: File A calls B (which calls C with GraphQL)
      // Check that `data` has the correct shape type
      const fileASource = `{% function data = 'middle/get_data' %}
{{ data }}`;
      const fileAAst = toLiquidHtmlAST(fileASource);
      const variableOutput = fileAAst.children[1];
      assert(isLiquidVariableOutput(variableOutput));

      const inferredType = await crossFileTypeSystem.inferType(
        variableOutput.markup,
        fileAAst,
        `${rootUri}/app/views/pages/test.liquid`,
      );

      // The type of `data` should be a shape with the GraphQL structure
      expect(inferredType).to.have.property('kind', 'shape');
      if (typeof inferredType !== 'string' && inferredType.kind === 'shape') {
        // data should have `user` property from GraphQL
        const userShape = inferredType.shape.properties?.get('user');
        expect(userShape).to.exist;
        expect(userShape?.kind).to.equal('object');
        expect(userShape?.properties?.get('name')?.kind).to.equal('primitive');
        expect(userShape?.properties?.get('id')?.kind).to.equal('primitive');
        expect(userShape?.properties?.get('email')?.kind).to.equal('primitive');
      }

      // Test 2: File-based GraphQL through chain
      const fileBSource = `{% function products = 'products/wrapper' %}
{{ products }}`;
      const fileBAst = toLiquidHtmlAST(fileBSource);
      const variableOutputB = fileBAst.children[1];
      assert(isLiquidVariableOutput(variableOutputB));

      const inferredTypeB = await crossFileTypeSystem.inferType(
        variableOutputB.markup,
        fileBAst,
        `${rootUri}/app/views/pages/test2.liquid`,
      );

      expect(inferredTypeB).to.have.property('kind', 'shape');
      if (typeof inferredTypeB !== 'string' && inferredTypeB.kind === 'shape') {
        const productsShape = inferredTypeB.shape.properties?.get('products');
        expect(productsShape).to.exist;
        expect(productsShape?.kind).to.equal('object');
        expect(productsShape?.properties?.get('id')?.kind).to.equal('primitive');
        expect(productsShape?.properties?.get('title')?.kind).to.equal('primitive');
        expect(productsShape?.properties?.get('price')?.kind).to.equal('primitive');
      }
    });

    it('should handle multiple return types creating a union', async () => {
      const { MockFileSystem } = await import('@platformos/platformos-check-common/src/test');
      const { DocumentsLocator } = await import('@platformos/platformos-common');

      const mockFiles = {
        // File with conditional returns
        'app/lib/conditional/get_value.liquid': `
          {% if condition %}
            {% return 'string_value' %}
          {% else %}
            {% return 42 %}
          {% endif %}
        `,
        // Wrapper that calls the conditional function
        'app/lib/conditional/wrapper.liquid': `
          {% function result = 'conditional/get_value' %}
          {% return result %}
        `,
      };

      const rootUri = 'file:///project';
      const fs = new MockFileSystem(mockFiles, rootUri);
      const documentsLocator = new DocumentsLocator(fs);

      const unionTypeSystem = new TypeSystem(
        {
          graphQL: async () => null,
          tags: async () => [],
          objects: async () => [],
          liquidDrops: async () => [],
          filters: async () => [],
          systemTranslations: async () => ({}),
        },
        async () => [],
        async () => ({
          article: [],
          blog: [],
          collection: [],
          company: [],
          company_location: [],
          location: [],
          market: [],
          order: [],
          page: [],
          product: [],
          variant: [],
          shop: [],
        }),
        fs,
        documentsLocator,
        async () => rootUri,
      );

      // Call the wrapper that calls the conditional function
      const sourceCode = `
        {% function data = 'conditional/wrapper' %}
        {{ data }}
      `;
      const ast = toLiquidHtmlAST(sourceCode);
      const variableOutput = ast.children[1];
      assert(isLiquidVariableOutput(variableOutput));

      const inferredType = await unionTypeSystem.inferType(
        variableOutput.markup,
        ast,
        `${rootUri}/app/views/pages/test.liquid`,
      );

      // Should be a union type of string and number
      expect(inferredType).to.have.property('kind', 'union');
      if (typeof inferredType !== 'string' && inferredType.kind === 'union') {
        expect(inferredType.types).to.have.length(2);
        expect(inferredType.types).to.include('string');
        expect(inferredType.types).to.include('number');
      }
    });

    it('should handle circular references gracefully', async () => {
      const { MockFileSystem } = await import('@platformos/platformos-check-common/src/test');
      const { DocumentsLocator } = await import('@platformos/platformos-common');

      const mockFiles = {
        // File A calls B
        'app/lib/circular/a.liquid': `
          {% function result = 'circular/b' %}
          {% return result %}
        `,
        // File B calls A (circular!)
        'app/lib/circular/b.liquid': `
          {% function result = 'circular/a' %}
          {% return result %}
        `,
      };

      const rootUri = 'file:///project';
      const fs = new MockFileSystem(mockFiles, rootUri);
      const documentsLocator = new DocumentsLocator(fs);

      const circularTypeSystem = new TypeSystem(
        {
          graphQL: async () => null,
          tags: async () => [],
          objects: async () => [],
          liquidDrops: async () => [],
          filters: async () => [],
          systemTranslations: async () => ({}),
        },
        async () => [],
        async () => ({
          article: [],
          blog: [],
          collection: [],
          company: [],
          company_location: [],
          location: [],
          market: [],
          order: [],
          page: [],
          product: [],
          variant: [],
          shop: [],
        }),
        fs,
        documentsLocator,
        async () => rootUri,
      );

      // This should not hang or throw - it should return 'untyped' for circular refs
      const sourceCode = `
        {% function data = 'circular/a' %}
        {{ data }}
      `;
      const ast = toLiquidHtmlAST(sourceCode);
      const variableOutput = ast.children[1];
      assert(isLiquidVariableOutput(variableOutput));

      const inferredType = await circularTypeSystem.inferType(
        variableOutput.markup,
        ast,
        `${rootUri}/app/views/pages/test.liquid`,
      );

      // Should handle circular reference gracefully (returns 'untyped')
      expect(inferredType).to.equal('untyped');
    });

    it('should infer types through 3-level chain: A -> B -> C with GraphQL', async () => {
      const { MockFileSystem } = await import('@platformos/platformos-check-common/src/test');
      const { DocumentsLocator } = await import('@platformos/platformos-common');

      const mockFiles = {
        // File C: the deepest level, calls GraphQL
        'app/lib/level3/fetch_data.liquid': `{% graphql result %}
query {
  records {
    results {
      id
      properties {
        name
        value
      }
    }
  }
}
{% endgraphql %}
{% return result %}`,
        // File B: middle level, calls C
        'app/lib/level2/process_data.liquid': `{% function raw_data = 'level3/fetch_data' %}
{% return raw_data %}`,
        // File A: top level, calls B
        'app/lib/level1/get_records.liquid': `{% function processed = 'level2/process_data' %}
{% return processed %}`,
      };

      const rootUri = 'file:///project';
      const fs = new MockFileSystem(mockFiles, rootUri);
      const documentsLocator = new DocumentsLocator(fs);

      const threeLevelTypeSystem = new TypeSystem(
        {
          graphQL: async () => null,
          tags: async () => [],
          objects: async () => [],
          liquidDrops: async () => [],
          filters: async () => [],
          systemTranslations: async () => ({}),
        },
        async () => [],
        async () => ({
          article: [],
          blog: [],
          collection: [],
          company: [],
          company_location: [],
          location: [],
          market: [],
          order: [],
          page: [],
          product: [],
          variant: [],
          shop: [],
        }),
        fs,
        documentsLocator,
        async () => rootUri,
      );

      // Consumer code calls file A (which calls B, which calls C)
      // Test just `records` variable to verify the full shape is propagated
      const sourceCode = `{% function records = 'level1/get_records' %}
{{ records }}`;
      const ast = toLiquidHtmlAST(sourceCode);
      const variableOutput = ast.children[1];
      assert(isLiquidVariableOutput(variableOutput));

      const inferredType = await threeLevelTypeSystem.inferType(
        variableOutput.markup,
        ast,
        `${rootUri}/app/views/pages/consumer.liquid`,
      );

      // Verify the entire chain propagates the GraphQL shape correctly
      expect(inferredType).to.have.property('kind', 'shape');
      if (typeof inferredType !== 'string' && inferredType.kind === 'shape') {
        // Check the nested structure: records.results should be an object
        const recordsShape = inferredType.shape.properties?.get('records');
        expect(recordsShape).to.exist;
        expect(recordsShape?.kind).to.equal('object');

        const resultsShape = recordsShape?.properties?.get('results');
        expect(resultsShape).to.exist;
        expect(resultsShape?.kind).to.equal('object');

        // Check deeply nested properties
        expect(resultsShape?.properties?.get('id')?.kind).to.equal('primitive');
        const propertiesShape = resultsShape?.properties?.get('properties');
        expect(propertiesShape).to.exist;
        expect(propertiesShape?.kind).to.equal('object');
        expect(propertiesShape?.properties?.get('name')?.kind).to.equal('primitive');
        expect(propertiesShape?.properties?.get('value')?.kind).to.equal('primitive');
      }
    });

    it('should merge hash_assign keys with existing function return shapes', async () => {
      const { MockFileSystem } = await import('@platformos/platformos-check-common/src/test');
      const { DocumentsLocator } = await import('@platformos/platformos-common');

      const mockFiles = {
        // Function that returns a shape from GraphQL
        'app/lib/api/get_user.liquid': `{% graphql result %}
query {
  user {
    id
    name
  }
}
{% endgraphql %}
{% return result %}`,
      };

      const rootUri = 'file:///project';
      const fs = new MockFileSystem(mockFiles, rootUri);
      const documentsLocator = new DocumentsLocator(fs);

      const hashAssignTypeSystem = new TypeSystem(
        {
          graphQL: async () => null,
          tags: async () => [],
          objects: async () => [],
          liquidDrops: async () => [],
          filters: async () => [],
          systemTranslations: async () => ({}),
        },
        async () => [],
        async () => ({
          article: [],
          blog: [],
          collection: [],
          company: [],
          company_location: [],
          location: [],
          market: [],
          order: [],
          page: [],
          product: [],
          variant: [],
          shop: [],
        }),
        fs,
        documentsLocator,
        async () => rootUri,
      );

      // hash_assign should add 'extra' key while preserving 'user' key
      const sourceCode = `{% function data = 'api/get_user' %}
{% hash_assign data['extra'] = 'value' %}
{{ data }}`;
      const ast = toLiquidHtmlAST(sourceCode);
      const variableOutput = ast.children[2];
      assert(isLiquidVariableOutput(variableOutput));

      const inferredType = await hashAssignTypeSystem.inferType(
        variableOutput.markup,
        ast,
        `${rootUri}/app/views/pages/test.liquid`,
      );

      // Should have both original 'user' key and new 'extra' key
      expect(inferredType).to.have.property('kind', 'shape');
      if (typeof inferredType !== 'string' && inferredType.kind === 'shape') {
        expect(inferredType.shape.properties?.get('user')).to.exist;
        expect(inferredType.shape.properties?.get('extra')).to.exist;
      }
    });

    it('should accumulate multiple hash_assign keys', async () => {
      const { MockFileSystem } = await import('@platformos/platformos-check-common/src/test');
      const { DocumentsLocator } = await import('@platformos/platformos-common');

      const mockFiles = {};

      const rootUri = 'file:///project';
      const fs = new MockFileSystem(mockFiles, rootUri);
      const documentsLocator = new DocumentsLocator(fs);

      const hashAssignTypeSystem = new TypeSystem(
        {
          graphQL: async () => null,
          tags: async () => [],
          objects: async () => [],
          liquidDrops: async () => [],
          filters: async () => [],
          systemTranslations: async () => ({}),
        },
        async () => [],
        async () => ({
          article: [],
          blog: [],
          collection: [],
          company: [],
          company_location: [],
          location: [],
          market: [],
          order: [],
          page: [],
          product: [],
          variant: [],
          shop: [],
        }),
        fs,
        documentsLocator,
        async () => rootUri,
      );

      // Multiple hash_assign calls should accumulate keys
      const sourceCode = `{% assign data = '{}' | parse_json %}
{% hash_assign data['key1'] = 'value1' %}
{% hash_assign data['key2'] = 'value2' %}
{% hash_assign data['key3'] = 'value3' %}
{{ data }}`;
      const ast = toLiquidHtmlAST(sourceCode);
      const variableOutput = ast.children[4];
      assert(isLiquidVariableOutput(variableOutput));

      const inferredType = await hashAssignTypeSystem.inferType(
        variableOutput.markup,
        ast,
        `${rootUri}/app/views/pages/test.liquid`,
      );

      // Should have all three keys
      expect(inferredType).to.have.property('kind', 'shape');
      if (typeof inferredType !== 'string' && inferredType.kind === 'shape') {
        expect(inferredType.shape.properties?.get('key1')).to.exist;
        expect(inferredType.shape.properties?.get('key2')).to.exist;
        expect(inferredType.shape.properties?.get('key3')).to.exist;
      }
    });
  });

  describe('metafieldDefinitionsObjectMap', async () => {
    it('should convert metafield definitions into types', async () => {
      const metafieldObjectMap =
        await typeSystem.metafieldDefinitionsObjectMap('file:///any/file.liquid');

      assert(metafieldObjectMap['product_metafields']);
      assert(metafieldObjectMap['product_metafield_custom']);
      assert(metafieldObjectMap['product_metafield_manufacturer']);
    });

    it('should group metafield definitions by namespace', async () => {
      const metafieldObjectMap =
        await typeSystem.metafieldDefinitionsObjectMap('file:///any/file.liquid');
      const properties = metafieldObjectMap['product_metafields'].properties;

      assert(properties);
      expect(properties).toHaveLength(2);
      expect(properties).toContainEqual(
        expect.objectContaining({
          name: 'custom',
          return_type: [{ type: 'product_metafield_custom', name: '' }],
        }),
      );
      expect(metafieldObjectMap['product_metafields'].properties).toContainEqual(
        expect.objectContaining({
          name: 'manufacturer',
          return_type: [{ type: 'product_metafield_manufacturer', name: '' }],
        }),
      );

      const manufacturerProperties =
        metafieldObjectMap['product_metafield_manufacturer'].properties;

      assert(manufacturerProperties);
      expect(manufacturerProperties).toHaveLength(2);

      expect(manufacturerProperties).toContainEqual(
        expect.objectContaining({
          name: 'code',
          return_type: [{ type: 'metafield_string', name: '' }],
        }),
      );
      expect(manufacturerProperties).toContainEqual(
        expect.objectContaining({
          name: 'id',
          return_type: [{ type: 'metafield_number', name: '' }],
        }),
      );

      const customProperties = metafieldObjectMap['product_metafield_custom'].properties;

      assert(customProperties);
      expect(customProperties).toHaveLength(1);

      expect(customProperties).toContainEqual(
        expect.objectContaining({
          name: 'is_rare',
          return_type: [{ type: 'metafield_boolean', name: '' }],
        }),
      );
    });

    it('should have `metafield_x_array` return_type for array of references', async () => {
      const metafieldObjectMap =
        await typeSystem.metafieldDefinitionsObjectMap('file:///any/file.liquid');
      const relatedProperties = metafieldObjectMap['order_metafield_related'].properties;

      assert(relatedProperties);
      expect(relatedProperties).toHaveLength(1);

      expect(relatedProperties).toContainEqual(
        expect.objectContaining({
          name: 'prods',
          return_type: [{ type: 'metafield_product_array', name: '' }],
        }),
      );
    });
  });
});
