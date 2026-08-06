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
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { App, DocumentsLocator } from '@platformos/platformos-common';
import { assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { URI } from 'vscode-uri';
import { ArrayType, ShapeType, TypeSystem, UnionType } from './TypeSystem';
import { languageServerParsers } from './documents/DocumentManager';
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

  /**
   * The type system asks `UnknownProperty`'s analyzer what shape a variable has, instead
   * of tracking shapes itself. These are the answers its own copy got wrong.
   */
  describe('shapes, as the check analyzer sees them', () => {
    const shapeOf = async (source: string): Promise<ShapeType | string> => {
      const ast = toLiquidHtmlAST(source);
      const output = ast.children.at(-1)!;
      assert(isLiquidVariableOutput(output));
      const inferred = await typeSystem.inferType(output.markup, ast, 'file:///file.liquid');
      return typeof inferred === 'string' ? inferred : (inferred as ShapeType);
    };

    it('resolves the fields a GraphQL fragment spread contributes', async () => {
      const inferred = await shapeOf(`{% graphql r %}
query { records { results { id ...rec } } }
fragment rec on Record { name slug }
{% endgraphql %}{{ r }}`);

      assert(typeof inferred !== 'string');
      const results = inferred.shape.properties?.get('records')?.properties?.get('results');
      expect([...(results?.properties?.keys() ?? [])]).to.deep.equal(['id', 'name', 'slug']);
    });

    it('claims no shape when a filter after parse_json changes the value', async () => {
      // The string's keys are not the value's keys once `hash_merge` has added to it.
      expect(
        await shapeOf(
          `{% assign site = '{"type": "site"}' | parse_json | hash_merge: a: b %}{{ site }}`,
        ),
      ).to.equal('untyped');
    });

    it('treats an empty hash as a placeholder other code fills in', async () => {
      const inferred = await shapeOf(`{% assign c = {"errors": {}} %}{{ c }}`);

      assert(typeof inferred !== 'string');
      expect(inferred.shape.properties?.get('errors')).to.deep.equal({
        kind: 'object',
        properties: new Map(),
        open: true,
        placeholder: true,
      });
    });

    it('knows the item type a push proves about a list', async () => {
      const inferred = await shapeOf(`{% assign arr = [] %}{% assign arr << "item" %}{{ arr }}`);

      assert(typeof inferred !== 'string');
      expect(inferred.shape).to.deep.equal({
        kind: 'array',
        itemShape: { kind: 'primitive', primitiveType: 'string' },
      });
    });
  });

  describe('cross-file type inference (A -> B -> C)', () => {
    it('should infer types through chain of function calls with GraphQL at the end', async () => {
      // Setup: File C calls GraphQL, B calls C, A calls B
      // The type from GraphQL should propagate: C -> B -> A

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

    /**
     * The type system reads a document from the App the host supplies, which is the same
     * `AppFile` the diagnostics over these buffers already parsed — not a second read and
     * a second parse of the same bytes, once per call site, per request.
     *
     * Each fixture below makes the two answers DIFFERENT on purpose: the App holds a
     * version the filesystem does not. A read that went to disk would infer the disk's
     * answer, so the assertion says which path ran. The no-App tests above and below are
     * the control for the fallback still working.
     */
    describe('when the host supplies an App', () => {
      const rootUri = 'file:///project';

      const appBacked = (onDisk: Record<string, string>, inTheApp: Record<string, string>) => {
        const fs = new MockFileSystem(onDisk, rootUri);
        const app = App.fromSources(rootUri, inTheApp, fs, languageServerParsers);

        return new TypeSystem(
          {
            graphQL: async () => null, // no schema: shapes come from the selection set
            tags: async () => [],
            objects: async () => [],
            liquidDrops: async () => [],
            filters: async () => [],
          },
          fs,
          new DocumentsLocator(fs, app),
          async () => rootUri,
          () => app,
        );
      };

      /** The type of `data` in `{% function data = '<partial>' %}{{ data }}`. */
      const typeOfCall = async (typeSystem: TypeSystem, partial: string) => {
        const ast = toLiquidHtmlAST(`{% function data = '${partial}' %}\n{{ data }}`);
        const variableOutput = ast.children[1];
        assert(isLiquidVariableOutput(variableOutput));

        return typeSystem.inferType(
          variableOutput.markup,
          ast,
          `${rootUri}/app/views/pages/test.liquid`,
        );
      };

      it('reads a .graphql document from the App, not from disk', async () => {
        const onDisk = {
          'app/graphql/get_user.graphql': `query { user { id } }`,
          'app/lib/users/fetch.liquid': `{% graphql result = 'get_user' %}\n{% return result %}`,
        };
        const typeSystem = appBacked(onDisk, {
          ...onDisk,
          'app/graphql/get_user.graphql': `query { user { id email } }`,
        });

        const inferred = await typeOfCall(typeSystem, 'users/fetch');

        assert(typeof inferred !== 'string' && inferred.kind === 'shape');
        const user = inferred.shape.properties?.get('user');
        expect([...(user?.properties?.keys() ?? [])]).to.deep.equal(['id', 'email']);
      });

      // The shape analyzer's own read of a partial (`ShapeAnalyzerDeps.readPartial`).
      it('reads a partial the shape analyzer resolves from the App, not from disk', async () => {
        const onDisk = {
          'app/lib/users/get.liquid': `{% assign user = {"id": 1} %}\n{% return user %}`,
        };
        const typeSystem = appBacked(onDisk, {
          'app/lib/users/get.liquid': `{% assign user = {"id": 1, "email": "a@b.c"} %}\n{% return user %}`,
        });

        const inferred = await typeOfCall(typeSystem, 'users/get');

        assert(typeof inferred !== 'string' && inferred.kind === 'shape');
        expect([...(inferred.shape.properties?.keys() ?? [])]).to.deep.equal(['id', 'email']);
      });

      // The other partial read: `inferFunctionReturnType`, for a callee whose return the
      // analyzer cannot shape — here two branches returning different types.
      it('reads a partial the return-type inference resolves from the App, not from disk', async () => {
        const branching = (second: string) =>
          `{% if condition %}{% return 'text' %}{% else %}{% return ${second} %}{% endif %}`;
        const typeSystem = appBacked(
          { 'app/lib/users/value.liquid': branching('42') },
          { 'app/lib/users/value.liquid': branching('true') },
        );

        const inferred = await typeOfCall(typeSystem, 'users/value');

        assert(typeof inferred !== 'string' && inferred.kind === 'union');
        expect([...inferred.types].sort()).to.deep.equal(['boolean', 'string']);
      });
    });

    it('should handle multiple return types creating a union', async () => {
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

    it('should support bare push form (assign arr << value)', async () => {
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
  });

  describe('parse_json block with {{ expr | json }} children', () => {
    it('infers object shape from static JSON in block form (baseline)', async () => {
      // Existing behaviour: static JSON works fine
      const ast = toLiquidHtmlAST(
        `{% parse_json data %}{"id": 1, "name": "hello"}{% endparse_json %}{{ data }}`,
      );
      const output = ast.children[1];
      assert(isLiquidVariableOutput(output));
      const inferredType = await typeSystem.inferType(output.markup, ast, 'file:///file.liquid');
      assert(typeof inferredType !== 'string' && inferredType.kind === 'shape');
      expect(inferredType.shape.properties?.has('id')).toBe(true);
      expect(inferredType.shape.properties?.has('name')).toBe(true);
    });

    it('infers object shape when values are {{ expr | json }} — unresolvable falls back to null', async () => {
      // object.unknown_var is not in the docset, so shape is unresolvable → null placeholder
      const ast = toLiquidHtmlAST(
        `{% parse_json data %}\n{"id": {{ object.unknown_var | json }}, "name": {{ object.unknown_var2 | json }}}\n{% endparse_json %}{{ data }}`,
      );
      const output = ast.children[1];
      assert(isLiquidVariableOutput(output));
      const inferredType = await typeSystem.inferType(output.markup, ast, 'file:///file.liquid');
      // Keys must be discovered even when types are unknown
      assert(typeof inferredType !== 'string' && inferredType.kind === 'shape');
      expect(inferredType.shape.properties?.has('id')).toBe(true);
      expect(inferredType.shape.properties?.has('name')).toBe(true);
    });

    it('infers correct value types when the expression resolves via the type system', async () => {
      // user is established as a ShapeType by the first parse_json block
      const ast = toLiquidHtmlAST(
        `{% parse_json user %}{"name": "John", "age": 30}{% endparse_json %}\n{% parse_json data %}\n{"username": {{ user.name | json }}, "years": {{ user.age | json }}}\n{% endparse_json %}{{ data }}`,
      );
      const output = ast.children[2];
      assert(isLiquidVariableOutput(output));
      const inferredType = await typeSystem.inferType(output.markup, ast, 'file:///file.liquid');
      assert(typeof inferredType !== 'string' && inferredType.kind === 'shape');
      const usernameShape = inferredType.shape.properties?.get('username');
      expect(usernameShape?.kind).toBe('primitive');
      expect(usernameShape?.primitiveType).toBe('string');
      const yearsShape = inferredType.shape.properties?.get('years');
      expect(yearsShape?.kind).toBe('primitive');
      expect(yearsShape?.primitiveType).toBe('number');
    });

    it('falls back gracefully when no | json filter present on LiquidVariableOutput', async () => {
      // Without | json, fall back to null for that key; key still discoverable via TextNode context
      const ast = toLiquidHtmlAST(
        `{% parse_json data %}\n{"title": "{{ object.title }}"}\n{% endparse_json %}{{ data }}`,
      );
      const output = ast.children[1];
      assert(isLiquidVariableOutput(output));
      const inferredType = await typeSystem.inferType(output.markup, ast, 'file:///file.liquid');
      // key must still be discovered (the TextNodes provide `"title": "` and `"`)
      assert(typeof inferredType !== 'string' && inferredType.kind === 'shape');
      expect(inferredType.shape.properties?.has('title')).toBe(true);
    });
  });
});
