import {
  AssignMarkup,
  LiquidVariable,
  LiquidVariableOutput,
  NamedTags,
  NodeTypes,
  toLiquidHtmlAST,
} from '@platformos/liquid-html-parser';
import {
  path as pathUtils,
  BasicParamTypes,
  ObjectEntry,
} from '@platformos/platformos-check-common';
import { assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { URI } from 'vscode-uri';
import { ArrayType, ShapeType, TypeSystem, UnionType } from './TypeSystem';
import { isLiquidVariableOutput, isNamedLiquidTag } from './utils';

describe('Module: TypeSystem', () => {
  let typeSystem: TypeSystem;
  const literalContexts = [
    { value: `10`, type: 'number' },
    { value: `'string'`, type: 'string' },
    { value: `true`, type: 'boolean' },
    //      { value: `null`, type: 'untyped' },
  ];

  beforeEach(async () => {
    const _objects: ObjectEntry[] = [
      {
        name: 'context',
        access: { global: true, parents: [], template: [] },
        return_type: [],
        properties: [
          {
            name: 'models',
            description: 'a list of user-defined data models (e.g. from GraphQL)',
            return_type: [{ type: 'array', array_value: 'model' }],
          },
          {
            name: 'current_user',
            description: 'the current user',
            return_type: [{ type: 'current_user', name: '' }],
          },
        ],
      },
      {
        // 'model' represents a generic user-defined data model in platformOS
        // (e.g. a record returned from a GraphQL query)
        name: 'model',
        properties: [
          {
            name: 'thumbnail',
            description: 'a thumbnail image',
            return_type: [{ type: 'image', name: '' }],
          },
          {
            name: 'images',
            description: 'all images for the model',
            return_type: [{ type: 'array', array_value: 'image' }],
          },
          {
            name: 'title',
            description: 'the title of the model',
            return_type: [{ type: 'string', name: '' }],
          },
          {
            name: 'metadata',
            return_type: [{ type: 'untyped', name: '' }],
          },
        ],
      },
      {
        name: 'current_user',
        properties: [
          {
            name: 'name',
            description: 'the name of the user',
            return_type: [{ type: 'string', name: '' }],
          },
          {
            name: 'info',
            description: 'additional info',
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
        name: 'locale',
        access: { global: false, parents: [], template: [] },
        return_type: [],
      },
      {
        name: 'app',
        access: { global: false, parents: [], template: [] },
        return_type: [],
      },
    ];
    typeSystem = new TypeSystem({
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
    });
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
    const ast = toLiquidHtmlAST(`{% assign x = context.models %}`);
    const xVariable = (ast as any).children[0].markup as AssignMarkup;
    const inferredType = await typeSystem.inferType(xVariable, ast, 'file:///file.liquid');
    expect(inferredType).to.eql({ kind: 'array', valueType: 'model' });
  });

  it('should return the type of object properties', async () => {
    const ast = toLiquidHtmlAST(`{% assign x = context.models[0].thumbnail %}`);
    const xVariable = (ast as any).children[0].markup as AssignMarkup;
    const inferredType = await typeSystem.inferType(xVariable, ast, 'file:///file.liquid');
    expect(inferredType).to.equal('image');
  });

  it('should return the type of filtered variables', async () => {
    const ast = toLiquidHtmlAST(`{% assign x = context | size %}`);
    const xVariable = (ast as any).children[0].markup as AssignMarkup;
    const inferredType = await typeSystem.inferType(xVariable, ast, 'file:///file.liquid');
    expect(inferredType).to.equal('number');
  });

  describe('when using string builtin methods', () => {
    it('should return number for size', async () => {
      const ast = toLiquidHtmlAST(`{{ context.current_user.name.size }}`);
      const xVariable = (ast as any).children[0].markup as LiquidVariable;
      const inferredType = await typeSystem.inferType(xVariable, ast, 'file:///file.liquid');
      expect(inferredType).to.equal('number');
    });

    ['first', 'last'].forEach((method) => {
      it(`should return string for ${method}`, async () => {
        const ast = toLiquidHtmlAST(`{{ context.current_user.name.${method} }}`);
        const xVariable = (ast as any).children[0].markup as LiquidVariable;
        const inferredType = await typeSystem.inferType(xVariable, ast, 'file:///file.liquid');
        expect(inferredType).to.equal('string');
      });
    });
  });

  describe('when using array builtin methods', () => {
    it('should return number for size', async () => {
      const ast = toLiquidHtmlAST(`{{ context.models[0].images.size }}`);
      const xVariable = (ast as any).children[0].markup as LiquidVariable;
      const inferredType = await typeSystem.inferType(xVariable, ast, 'file:///file.liquid');
      expect(inferredType).to.equal('number');
    });

    ['first', 'last'].forEach((method) => {
      it(`should return the value type of the array for ${method}`, async () => {
        const ast = toLiquidHtmlAST(`{{ context.models[0].images.${method} }}`);
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
        {% assign d = context.models[0].thumbnail %}
        {% assign x = unknown | default: d %}
      `);
      const xVariable = (ast as any).children[1].markup as AssignMarkup;
      const inferredType = await typeSystem.inferType(xVariable, ast, 'file:///file.liquid');
      expect(inferredType).to.equal('image');
    });
  });

  it('should return the type of variables in for loop', async () => {
    const ast = toLiquidHtmlAST(`{% for item in context.models %}{{ item }}{% endfor %}`);
    const forLoop = ast.children[0];
    assert(isNamedLiquidTag(forLoop, NamedTags.for) && forLoop.children?.length === 1);
    const branch = forLoop.children[0];
    assert(branch.type === NodeTypes.LiquidBranch);
    const variableOutput = branch.children[0];
    assert(isLiquidVariableOutput(variableOutput));
    const variable = variableOutput.markup;

    const inferredType = await typeSystem.inferType(variable, ast, 'file:///file.liquid');
    expect(inferredType).to.equal('model');
  });

  it('should support path-contextual variable types for partials', async () => {
    let inferredType: string | ArrayType | ShapeType | UnionType;
    const contexts: [string, string][] = [
      ['app', 'app/views/partials/recommendations.liquid'],
      ['app', 'app/lib/helpers/my-helper.liquid'],
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
          'file:///app/views/partials/example.liquid',
        );
        expect(inferredType).to.eql(expectedType);
      });
    });

    it(`should support complex liquid doc params type: current_user`, async () => {
      const sourceCode = `
        {% doc %}
          @param {current_user} data - the current user object
        {% enddoc %}
        {{ data }}
      `;
      const ast = toLiquidHtmlAST(sourceCode);
      const variableOutput = ast.children[1];
      assert(isLiquidVariableOutput(variableOutput));
      const inferredType = await typeSystem.inferType(
        variableOutput.markup,
        ast,
        'file:///app/views/partials/example.liquid',
      );
      expect(inferredType).to.eql('current_user');
    });

    it(`should support array liquid doc params type: current_user[]`, async () => {
      const sourceCode = `
        {% doc %}
          @param {current_user[]} data - a list of users
        {% enddoc %}
        {{ data }}
      `;
      const ast = toLiquidHtmlAST(sourceCode);
      const variableOutput = ast.children[1];
      assert(isLiquidVariableOutput(variableOutput));
      const inferredType = await typeSystem.inferType(
        variableOutput.markup,
        ast,
        'file:///app/views/partials/example.liquid',
      );
      expect(inferredType).to.eql({
        kind: 'array',
        valueType: 'current_user',
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
        },
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
        },
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
        },
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
        },
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
        },
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
        },
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

  describe('JSON literal type inference', () => {
    it('should infer shape from a JSON hash literal', async () => {
      const ast = toLiquidHtmlAST(`{% assign a = {x: 1, y: "hello"} %}{{ a }}`);
      const variableOutput = ast.children[1];
      assert(isLiquidVariableOutput(variableOutput));
      const inferredType = await typeSystem.inferType(
        variableOutput.markup,
        ast,
        'file:///file.liquid',
      );
      expect(inferredType).to.have.property('kind', 'shape');
      if (typeof inferredType !== 'string' && inferredType.kind === 'shape') {
        expect(inferredType.shape.kind).to.equal('object');
        expect(inferredType.shape.properties?.get('x')).to.deep.equal({
          kind: 'primitive',
          primitiveType: 'number',
        });
        expect(inferredType.shape.properties?.get('y')).to.deep.equal({
          kind: 'primitive',
          primitiveType: 'string',
        });
      }
    });

    it('should infer an empty object shape from {}', async () => {
      const ast = toLiquidHtmlAST(`{% assign a = {} %}{{ a }}`);
      const variableOutput = ast.children[1];
      assert(isLiquidVariableOutput(variableOutput));
      const inferredType = await typeSystem.inferType(
        variableOutput.markup,
        ast,
        'file:///file.liquid',
      );
      expect(inferredType).to.have.property('kind', 'shape');
      if (typeof inferredType !== 'string' && inferredType.kind === 'shape') {
        expect(inferredType.shape.kind).to.equal('object');
        expect(inferredType.shape.properties?.size).to.equal(0);
      }
    });

    it('should infer array shape from a JSON array literal', async () => {
      const ast = toLiquidHtmlAST(`{% assign a = [1, 2, 3] %}{{ a }}`);
      const variableOutput = ast.children[1];
      assert(isLiquidVariableOutput(variableOutput));
      const inferredType = await typeSystem.inferType(
        variableOutput.markup,
        ast,
        'file:///file.liquid',
      );
      expect(inferredType).to.have.property('kind', 'shape');
      if (typeof inferredType !== 'string' && inferredType.kind === 'shape') {
        expect(inferredType.shape.kind).to.equal('array');
        expect(inferredType.shape.itemShape).to.deep.equal({
          kind: 'primitive',
          primitiveType: 'number',
        });
      }
    });

    it('should infer nested object shapes', async () => {
      const ast = toLiquidHtmlAST(`{% assign a = {"nested": {"deep": 42}} %}{{ a.nested.deep }}`);
      const variableOutput = ast.children[1];
      assert(isLiquidVariableOutput(variableOutput));
      const inferredType = await typeSystem.inferType(
        variableOutput.markup,
        ast,
        'file:///file.liquid',
      );
      expect(inferredType).to.equal('number');
    });

    it('should produce the same shape as parse_json for equivalent JSON', async () => {
      const astLiteral = toLiquidHtmlAST(`{% assign a = {a: 2} %}{{ a }}`);
      const astParseJson = toLiquidHtmlAST(`{% assign b = '{"a": 2}' | parse_json %}{{ b }}`);

      const outputLiteral = astLiteral.children[1];
      const outputParseJson = astParseJson.children[1];
      assert(isLiquidVariableOutput(outputLiteral));
      assert(isLiquidVariableOutput(outputParseJson));

      const typeLiteral = await typeSystem.inferType(
        outputLiteral.markup,
        astLiteral,
        'file:///file.liquid',
      );
      const typeParseJson = await typeSystem.inferType(
        outputParseJson.markup,
        astParseJson,
        'file:///file.liquid',
      );

      expect(typeLiteral).to.have.property('kind', 'shape');
      expect(typeParseJson).to.have.property('kind', 'shape');
      if (
        typeof typeLiteral !== 'string' &&
        typeLiteral.kind === 'shape' &&
        typeof typeParseJson !== 'string' &&
        typeParseJson.kind === 'shape'
      ) {
        // Both should have an 'a' property with number type
        expect(typeLiteral.shape.properties?.get('a')).to.deep.equal(
          typeParseJson.shape.properties?.get('a'),
        );
      }
    });

    it('should support LHS lookups with assign (assign x["key"] = value)', async () => {
      const ast = toLiquidHtmlAST(
        `{% assign config = {} %}{% assign config["key"] = "value" %}{{ config }}`,
      );
      const variableOutput = ast.children[2];
      assert(isLiquidVariableOutput(variableOutput));
      const inferredType = await typeSystem.inferType(
        variableOutput.markup,
        ast,
        'file:///file.liquid',
      );
      expect(inferredType).to.have.property('kind', 'shape');
      if (typeof inferredType !== 'string' && inferredType.kind === 'shape') {
        expect(inferredType.shape.properties?.get('key')).to.exist;
      }
    });

    it('should support << operator (array append)', async () => {
      const ast = toLiquidHtmlAST(`{% assign arr = [] %}{% assign arr << "item" %}{{ arr }}`);
      const variableOutput = ast.children[2];
      assert(isLiquidVariableOutput(variableOutput));
      const inferredType = await typeSystem.inferType(
        variableOutput.markup,
        ast,
        'file:///file.liquid',
      );
      expect(inferredType).to.have.property('kind', 'shape');
      if (typeof inferredType !== 'string' && inferredType.kind === 'shape') {
        expect(inferredType.shape.kind).to.equal('array');
        expect(inferredType.shape.itemShape).to.deep.equal({
          kind: 'primitive',
          primitiveType: 'string',
        });
      }
    });

    it('should support explicit push form (assign a = source << value)', async () => {
      const ast = toLiquidHtmlAST(`{% assign arr = [] %}{% assign arr = arr << "item" %}{{ arr }}`);
      const variableOutput = ast.children[2];
      assert(isLiquidVariableOutput(variableOutput));
      const inferredType = await typeSystem.inferType(
        variableOutput.markup,
        ast,
        'file:///file.liquid',
      );
      expect(inferredType).to.have.property('kind', 'shape');
      if (typeof inferredType !== 'string' && inferredType.kind === 'shape') {
        expect(inferredType.shape.kind).to.equal('array');
        expect(inferredType.shape.itemShape).to.deep.equal({
          kind: 'primitive',
          primitiveType: 'string',
        });
      }
    });
  });
});
