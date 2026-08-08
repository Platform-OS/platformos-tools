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
  PropertyShape,
} from '@platformos/platformos-check-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { App, DocumentsLocator } from '@platformos/platformos-common';
import { assert, beforeEach, describe, expect, it, vi } from 'vitest';
import { URI } from 'vscode-uri';
import { ArrayType, ShapeType, TypeSystem, UnionType } from './TypeSystem';
import { languageServerParsers } from './documents/DocumentManager';
import { isLiquidVariableOutput, isNamedLiquidTag } from './utils';

const PROJECT = 'file:///project';
const PAGE = `${PROJECT}/app/views/pages/test.liquid`;

const object = (
  properties: Record<string, PropertyShape>,
  rest: Partial<PropertyShape> = {},
): PropertyShape => ({ kind: 'object', properties: new Map(Object.entries(properties)), ...rest });

/** A GraphQL selection names no primitive TYPE; a JSON literal does. */
const primitive = (primitiveType?: PropertyShape['primitiveType']): PropertyShape =>
  primitiveType ? { kind: 'primitive', primitiveType } : { kind: 'primitive' };

/** What `{% graphql %}` adds to whatever the operation selected, on every result. */
const GRAPHQL_ERRORS: PropertyShape = {
  kind: 'array',
  optional: true,
  itemShape: object({ message: primitive('string') }),
};

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

  /** The inferred type of the LAST `{% assign %}` in `source`. */
  const typeOfLastAssign = async (source: string) => {
    const ast = toLiquidHtmlAST(source);
    const last = ast.children.at(-1)!;
    assert(isNamedLiquidTag(last, NamedTags.assign));
    return typeSystem.inferType(last.markup as AssignMarkup, ast, 'file:///file.liquid');
  };

  /** The inferred type of the LAST node of `source`, which in every case below is a `{{ … }}`. */
  const typeOfLastOutput = async (
    source: string,
    ts: TypeSystem = typeSystem,
    uri = 'file:///file.liquid',
  ) => {
    const ast = toLiquidHtmlAST(source);
    const output = ast.children.at(-1)!;
    assert(isLiquidVariableOutput(output));
    return ts.inferType(output.markup, ast, uri);
  };

  /** The same, narrowed for a caller whose subject is the shape rather than the kind. */
  const shapeOfLastOutput = async (source: string, ts?: TypeSystem, uri?: string) => {
    const inferred = await typeOfLastOutput(source, ts, uri);
    assert(typeof inferred !== 'string' && inferred.kind === 'shape');
    return inferred.shape;
  };

  /** A type system whose partials and `.graphql` documents are `files`, read through no App. */
  const typeSystemFor = (files: Record<string, string>) => {
    const fs = new MockFileSystem(files, PROJECT);
    return new TypeSystem(
      {
        graphQL: async () => null, // no schema: shapes come from the selection set
        tags: async () => [],
        objects: async () => [],
        liquidDrops: async () => [],
        filters: async () => [],
      },
      fs,
      new DocumentsLocator(fs),
      async () => PROJECT,
    );
  };

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

  /**
   * WHICH OPERAND OF `default` FLOWS, and so whose type is the answer. `default` yields the
   * piped value unless it is blank, so the piped value's type wins whenever there is one and
   * nothing proves it blank — taking the fallback's unconditionally named the wrong type for
   * every chain whose input was typed.
   *
   * Blank is Liquid's `empty?`-then-`!input`, not JavaScript's falsiness, which is what the
   * zero case is here to separate: `!0` is false in Ruby, so a zero flows through.
   */
  describe('when using the default filter', () => {
    it('answers with the operand that flows, deciding blankness the way Liquid does', async () => {
      const withThumbnail = (assign: string) =>
        `{% assign d = context.models[0].thumbnail %}\n${assign}`;

      expect({
        // Nothing is known about the piped value, so the fallback is the whole answer.
        untypedPipedLiteralFallback: await typeOfLastAssign(`{% assign x = x | default: 10 %}`),
        untypedPipedLookupFallback: await typeOfLastAssign(
          withThumbnail(`{% assign x = unknown | default: d %}`),
        ),
        // A typed piped value reaches the output, so the fallback's type is not the answer.
        typedPiped: await typeOfLastAssign(
          withThumbnail(`{% assign x = d | default: 'placeholder' %}`),
        ),
        // PROVABLY blank, and typed `string` — so nothing about the type alone separates
        // this from the case above; only the blankness does.
        provablyBlankPiped: await typeOfLastAssign(
          withThumbnail(`{% assign title = '' %}\n{% assign x = title | default: d %}`),
        ),
        blankLiteralPiped: await typeOfLastAssign(
          withThumbnail(`{% assign x = blank | default: d %}`),
        ),
        // The control: a zero is not blank in Liquid, so it flows and stays a number.
        zeroPiped: await typeOfLastAssign(
          withThumbnail(`{% assign count = 0 %}\n{% assign x = count | default: d %}`),
        ),
      }).toEqual({
        untypedPipedLiteralFallback: 'number',
        untypedPipedLookupFallback: 'image',
        typedPiped: 'image',
        provablyBlankPiped: 'image',
        blankLiteralPiped: 'image',
        zeroPiped: 'number',
      });
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
    /**
     * A page calls B, B calls C, C runs the query — inline in one chain, from a `.graphql`
     * document in the other. The shape the query selects has to survive every hop.
     */
    it('should infer types through chain of function calls with GraphQL at the end', async () => {
      const typeSystem = typeSystemFor({
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
        'app/lib/middle/get_data.liquid': `{% function user_data = 'deep/get_user' %}
{% return user_data %}`,
        'app/graphql/get_products.graphql': `query {
  products {
    id
    title
    price
  }
}`,
        'app/lib/products/fetch.liquid': `{% graphql result = 'get_products' %}
{% return result %}`,
        'app/lib/products/wrapper.liquid': `{% function products = 'products/fetch' %}
{% return products %}`,
      });

      const inline = await shapeOfLastOutput(
        `{% function data = 'middle/get_data' %}\n{{ data }}`,
        typeSystem,
        PAGE,
      );
      const fileBased = await shapeOfLastOutput(
        `{% function products = 'products/wrapper' %}\n{{ products }}`,
        typeSystem,
        PAGE,
      );

      expect({ inline, fileBased }).toEqual({
        inline: object({
          user: object({ id: primitive(), name: primitive(), email: primitive() }),
          errors: GRAPHQL_ERRORS,
        }),
        fileBased: object({
          products: object({ id: primitive(), title: primitive(), price: primitive() }),
          errors: GRAPHQL_ERRORS,
        }),
      });
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

      /** The `app` comes back too: a test that edits a buffer needs `setSource` on it. */
      const appBacked = (onDisk: Record<string, string>, inTheApp: Record<string, string>) => {
        const fs = new MockFileSystem(onDisk, rootUri);
        const app = App.fromSources(rootUri, inTheApp, fs, languageServerParsers);

        const typeSystem = new TypeSystem(
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

        return { typeSystem, app };
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
        const { typeSystem } = appBacked(onDisk, {
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
        const { typeSystem } = appBacked(onDisk, {
          'app/lib/users/get.liquid': `{% assign user = {"id": 1, "email": "a@b.c"} %}\n{% return user %}`,
        });

        const inferred = await typeOfCall(typeSystem, 'users/get');

        assert(typeof inferred !== 'string' && inferred.kind === 'shape');
        expect([...(inferred.shape.properties?.keys() ?? [])]).to.deep.equal(['id', 'email']);
      });

      /**
       * AN EDIT TO AN OPEN, UNSAVED PARTIAL, through this class's own deps wiring rather
       * than a hand-built deps object — because the defect lived exactly in the difference
       * between two of those deps. `readPartial` preferred the App's buffer while
       * `readContent`, which is all the analysis memo revalidates against, read only disk.
       * So the first analysis recorded the BUFFER's text, the revalidation compared the
       * unchanged file on DISK against it, decided nothing had moved, and served the old
       * shape — for hover, completion and `{% function %}` return types alike, until the
       * user saved.
       *
       * DISK HOLDS THE FIRST BUFFER'S TEXT, which is what makes this a test of the memo and
       * not of the read: with a third text on disk the revalidation compares two things that
       * differ whichever source it reads, calls the entry stale either way, and passes with
       * the defect in place. Matching disk to the pre-edit buffer is the only arrangement
       * where a disk-only comparison concludes "unchanged" — and `{"a": 1}` is then the
       * STALE answer the second assertion refuses.
       */
      it('follows an edit to an open, unsaved partial without a save', async () => {
        const relative = 'app/lib/users/edited.liquid';
        const returning = (literal: string) => `{% assign user = ${literal} %}\n{% return user %}`;
        const { typeSystem, app } = appBacked(
          { [relative]: returning('{"a": 1}') },
          { [relative]: returning('{"a": 1}') },
        );

        const keysOfCall = async () => {
          const inferred = await typeOfCall(typeSystem, 'users/edited');
          assert(typeof inferred !== 'string' && inferred.kind === 'shape');
          return [...(inferred.shape.properties?.keys() ?? [])];
        };

        const before = await keysOfCall();
        // The editor's own move: a buffer version, no write to `fs`.
        app.setSource(`${rootUri}/${relative}`, returning('{"b": 2}'), 1);
        const after = await keysOfCall();

        expect({ before, after }).to.deep.equal({ before: ['a'], after: ['b'] });
      });

      // The other partial read: `inferFunctionReturnType`, for a callee whose return the
      // analyzer cannot shape — here two branches returning different types.
      it('reads a partial the return-type inference resolves from the App, not from disk', async () => {
        const branching = (second: string) =>
          `{% if condition %}{% return 'text' %}{% else %}{% return ${second} %}{% endif %}`;
        const { typeSystem } = appBacked(
          { 'app/lib/users/value.liquid': branching('42') },
          { 'app/lib/users/value.liquid': branching('true') },
        );

        const inferred = await typeOfCall(typeSystem, 'users/value');

        assert(typeof inferred !== 'string' && inferred.kind === 'union');
        expect([...inferred.types].sort()).to.deep.equal(['boolean', 'string']);
      });
    });

    it('should handle multiple return types creating a union', async () => {
      const typeSystem = typeSystemFor({
        'app/lib/conditional/get_value.liquid': `
          {% if condition %}
            {% return 'string_value' %}
          {% else %}
            {% return 42 %}
          {% endif %}
        `,
        'app/lib/conditional/wrapper.liquid': `
          {% function result = 'conditional/get_value' %}
          {% return result %}
        `,
      });

      expect(
        await typeOfLastOutput(
          `{% function data = 'conditional/wrapper' %}\n{{ data }}`,
          typeSystem,
          PAGE,
        ),
      ).toEqual({ kind: 'union', types: ['string', 'number'] });
    });

    it('should handle circular references gracefully', async () => {
      // A calls B calls A. The answer is `untyped` rather than a hang or a throw.
      const typeSystem = typeSystemFor({
        'app/lib/circular/a.liquid': `{% function result = 'circular/b' %}{% return result %}`,
        'app/lib/circular/b.liquid': `{% function result = 'circular/a' %}{% return result %}`,
      });

      expect(
        await typeOfLastOutput(`{% function data = 'circular/a' %}\n{{ data }}`, typeSystem, PAGE),
      ).to.equal('untyped');
    });

    it('should infer types through 3-level chain: A -> B -> C with GraphQL', async () => {
      const typeSystem = typeSystemFor({
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
        'app/lib/level2/process_data.liquid': `{% function raw_data = 'level3/fetch_data' %}
{% return raw_data %}`,
        'app/lib/level1/get_records.liquid': `{% function processed = 'level2/process_data' %}
{% return processed %}`,
      });

      expect(
        await shapeOfLastOutput(
          `{% function records = 'level1/get_records' %}\n{{ records }}`,
          typeSystem,
          PAGE,
        ),
      ).toEqual(
        object({
          records: object({
            results: object({
              id: primitive(),
              properties: object({ name: primitive(), value: primitive() }),
            }),
          }),
          errors: GRAPHQL_ERRORS,
        }),
      );
    });

    it('should merge hash_assign keys with existing function return shapes', async () => {
      const typeSystem = typeSystemFor({
        'app/lib/api/get_user.liquid': `{% graphql result %}
query {
  user {
    id
    name
  }
}
{% endgraphql %}
{% return result %}`,
      });

      // The written key joins what the query selected instead of replacing it.
      expect(
        await shapeOfLastOutput(
          `{% function data = 'api/get_user' %}\n{% hash_assign data['extra'] = 'value' %}\n{{ data }}`,
          typeSystem,
          PAGE,
        ),
      ).toEqual(
        object({
          user: object({ id: primitive(), name: primitive() }),
          errors: GRAPHQL_ERRORS,
          extra: primitive('string'),
        }),
      );
    });

    it('should accumulate multiple hash_assign keys', async () => {
      expect(
        await shapeOfLastOutput(
          [
            `{% assign data = '{}' | parse_json %}`,
            `{% hash_assign data['key1'] = 'value1' %}`,
            `{% hash_assign data['key2'] = 'value2' %}`,
            `{% hash_assign data['key3'] = 'value3' %}`,
            `{{ data }}`,
          ].join('\n'),
        ),
      ).toEqual(
        object({
          key1: primitive('string'),
          key2: primitive('string'),
          key3: primitive('string'),
        }),
      );
    });
  });

  describe('JSON literal type inference', () => {
    it('should infer shape from a JSON hash literal', async () => {
      expect(await shapeOfLastOutput(`{% assign a = {x: 1, y: "hello"} %}{{ a }}`)).toEqual(
        object({ x: primitive('number'), y: primitive('string') }),
      );
    });

    it('should infer an empty object shape from {}', async () => {
      // OPEN and a PLACEHOLDER: nothing is known yet, and the writes that follow are the
      // whole of what it holds. `{}` is the one shape that CLOSES on the first write.
      expect(await shapeOfLastOutput(`{% assign a = {} %}{{ a }}`)).toEqual(
        object({}, { open: true, placeholder: true }),
      );
    });

    it('should infer array shape from a JSON array literal', async () => {
      expect(await shapeOfLastOutput(`{% assign a = [1, 2, 3] %}{{ a }}`)).toEqual({
        kind: 'array',
        itemShape: primitive('number'),
      });
    });

    it('should infer nested object shapes', async () => {
      expect(
        await typeOfLastOutput(`{% assign a = {"nested": {"deep": 42}} %}{{ a.nested.deep }}`),
      ).to.equal('number');
    });

    it('should produce the same shape as parse_json for equivalent JSON', async () => {
      const literal = await shapeOfLastOutput(`{% assign a = {a: 2} %}{{ a }}`);
      const parsed = await shapeOfLastOutput(`{% assign b = '{"a": 2}' | parse_json %}{{ b }}`);

      // Asserted against the shape itself as well as against each other: two identically
      // wrong answers agree just as well as two right ones.
      expect({ literal, parsed }).toEqual({
        literal: object({ a: primitive('number') }),
        parsed: object({ a: primitive('number') }),
      });
    });

    it('should support LHS lookups with assign (assign x["key"] = value)', async () => {
      // The write CLOSES the placeholder above, which is why `key` is all there is.
      expect(
        await shapeOfLastOutput(
          `{% assign config = {} %}{% assign config["key"] = "value" %}{{ config }}`,
        ),
      ).toEqual(object({ key: primitive('string') }));
    });
  });

  describe('parse_json block with {{ expr | json }} children', () => {
    it('infers object shape from static JSON in block form (baseline)', async () => {
      expect(
        await shapeOfLastOutput(
          `{% parse_json data %}{"id": 1, "name": "hello"}{% endparse_json %}{{ data }}`,
        ),
      ).toEqual(object({ id: primitive('number'), name: primitive('string') }));
    });

    it('infers object shape when values are {{ expr | json }} — unresolvable falls back to null', async () => {
      // `object.unknown_var` is in no docset, so the KEYS are discovered and the values are
      // the null placeholder — which the baseline above proves is not what static JSON gives.
      expect(
        await shapeOfLastOutput(
          `{% parse_json data %}\n{"id": {{ object.unknown_var | json }}, "name": {{ object.unknown_var2 | json }}}\n{% endparse_json %}{{ data }}`,
        ),
      ).toEqual(object({ id: primitive('null'), name: primitive('null') }));
    });

    it('infers correct value types when the expression resolves via the type system', async () => {
      // `user` is established as a shape by the first block, so the second block's
      // interpolations resolve through it rather than falling back to null.
      expect(
        await shapeOfLastOutput(
          `{% parse_json user %}{"name": "John", "age": 30}{% endparse_json %}\n{% parse_json data %}\n{"username": {{ user.name | json }}, "years": {{ user.age | json }}}\n{% endparse_json %}{{ data }}`,
        ),
      ).toEqual(object({ username: primitive('string'), years: primitive('number') }));
    });

    it('falls back gracefully when no | json filter present on LiquidVariableOutput', async () => {
      // The key is still discovered: the TextNodes around the interpolation spell `"title": "`
      // and `"`, which is a string whatever the interpolation turns out to be.
      expect(
        await shapeOfLastOutput(
          `{% parse_json data %}\n{"title": "{{ object.title }}"}\n{% endparse_json %}{{ data }}`,
        ),
      ).toEqual(object({ title: primitive('string') }));
    });
  });
});
