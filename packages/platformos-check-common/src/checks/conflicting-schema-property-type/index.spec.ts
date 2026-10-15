import { describe, expect, it } from 'vitest';
import { ConflictingSchemaPropertyType } from '.';
import { check, messagesOf } from '../../test';

const TOKENS = 'app/schema/access_token.yml';
const ORDERS = 'app/schema/order.yml';
const INVOICES = 'app/schema/invoice.yml';
const USER = 'app/user.yml';

const report = async (files: Record<string, string>) =>
  messagesOf(await check(files, [ConflictingSchemaPropertyType]));

const schema = (name: string, properties: Record<string, string>) =>
  `name: ${name}\nproperties:\n` +
  Object.entries(properties)
    .map(([property, type]) => `  - name: ${property}\n    type: ${type}\n`)
    .join('');

const conflict = (property: string, here: string, elsewhere: string) =>
  `Property '${property}' is declared as '${here}' here and as ${elsewhere}. ` +
  `The platform resolves a property's type by name across every schema, so filters on '${property}' see both.`;

/**
 * The platform's property-type lookup takes a NAME and no owning schema, so every schema in the
 * instance answers together. These fixtures are the shape that produced a real incident: a
 * `range` filter on one schema's `expires_at` started failing with
 * `invalid input syntax for type json` because a SECOND schema declared an `expires_at` of its
 * own — nothing about the queried schema having changed.
 */
describe('ConflictingSchemaPropertyType', () => {
  it('reports one property name declared with two types, in both files', async () => {
    const offenses = await check(
      {
        [TOKENS]: schema('access_token', { expires_at: 'string' }),
        [ORDERS]: schema('order', { expires_at: 'integer' }),
      },
      [ConflictingSchemaPropertyType],
    );

    // Both files, because neither is the wrong one: the conflict is the pair, and the reader
    // may be looking at either.
    expect(offenses.map((offense) => ({ uri: offense.uri, message: offense.message }))).toEqual([
      {
        uri: `file:///${TOKENS}`,
        message: conflict('expires_at', 'string', `'integer' in ${ORDERS}`),
      },
      {
        uri: `file:///${ORDERS}`,
        message: conflict('expires_at', 'integer', `'string' in ${TOKENS}`),
      },
    ]);
  });

  it('says nothing when every schema agrees on the type', async () => {
    // The common case by far — `name: string` in every table — and the one a check that
    // merely counted declarations would drown the project in.
    expect(
      await report({
        [TOKENS]: schema('access_token', { name: 'string', expires_at: 'datetime' }),
        [ORDERS]: schema('order', { name: 'string', expires_at: 'datetime' }),
        [INVOICES]: schema('invoice', { name: 'string' }),
      }),
    ).toEqual([]);
  });

  it('reports a conflict the platform still resolves to a working query', async () => {
    // `string` and `date` are both string-ish, so a range filter compiles the same either way
    // and nothing breaks TODAY. It is still two answers to one question, and which one a
    // given lookup takes is not something the schemas say — so it is reported.
    expect(
      await report({
        [TOKENS]: schema('access_token', { expires_at: 'string' }),
        [ORDERS]: schema('order', { expires_at: 'date' }),
      }),
    ).toEqual([
      conflict('expires_at', 'string', `'date' in ${ORDERS}`),
      conflict('expires_at', 'date', `'string' in ${TOKENS}`),
    ]);
  });

  it('names each conflicting type once, at one declaring file', async () => {
    // Bounded on purpose: a name declared in dozens of schemas must not produce a message
    // nobody reads to the end. Types are listed alphabetically so the message is stable.
    expect(
      await report({
        [TOKENS]: schema('access_token', { expires_at: 'string' }),
        [ORDERS]: schema('order', { expires_at: 'integer' }),
        [INVOICES]: schema('invoice', { expires_at: 'float' }),
      }),
    ).toEqual([
      conflict('expires_at', 'string', `'float' in ${INVOICES}, 'integer' in ${ORDERS}`),
      conflict('expires_at', 'integer', `'float' in ${INVOICES}, 'string' in ${TOKENS}`),
      conflict('expires_at', 'float', `'integer' in ${ORDERS}, 'string' in ${TOKENS}`),
    ]);
  });

  it('reports each conflicting property separately', async () => {
    expect(
      await report({
        [TOKENS]: schema('access_token', { expires_at: 'string', amount: 'integer', ok: 'string' }),
        [ORDERS]: schema('order', { expires_at: 'integer', amount: 'float', ok: 'string' }),
      }),
    ).toEqual([
      conflict('expires_at', 'string', `'integer' in ${ORDERS}`),
      conflict('amount', 'integer', `'float' in ${ORDERS}`),
      conflict('expires_at', 'integer', `'string' in ${TOKENS}`),
      conflict('amount', 'float', `'integer' in ${TOKENS}`),
    ]);
  });

  /**
   * The four file types whose `properties:` the same converter builds — and, not by
   * coincidence, the four arms of the platform's own property-definition query. A check
   * looking only at `app/schema/` would miss three quarters of the collision surface.
   */
  it('resolves across tables, profiles, transactables and user.yml alike', async () => {
    expect(
      await report({
        [TOKENS]: schema('access_token', { expires_at: 'string' }),
        'app/user.yml': 'properties:\n  - name: expires_at\n    type: integer\n',
      }),
    ).toEqual([
      conflict('expires_at', 'string', `'integer' in ${USER}`),
      conflict('expires_at', 'integer', `'string' in ${TOKENS}`),
    ]);

    expect(
      await report({
        'app/user_profile_types/seller.yml': schema('seller', { expires_at: 'string' }),
        'app/transactable_types/listing.yml': schema('listing', { expires_at: 'integer' }),
      }),
    ).toEqual([
      conflict('expires_at', 'string', `'integer' in app/transactable_types/listing.yml`),
      conflict('expires_at', 'integer', `'string' in app/user_profile_types/seller.yml`),
    ]);
  });

  it('resolves a module schema against the app, which deploys into the same instance', async () => {
    expect(
      await report({
        [TOKENS]: schema('access_token', { expires_at: 'string' }),
        'modules/blog/public/schema/post.yml': schema('post', { expires_at: 'integer' }),
      }),
    ).toEqual([
      conflict('expires_at', 'string', `'integer' in modules/blog/public/schema/post.yml`),
      conflict('expires_at', 'integer', `'string' in ${TOKENS}`),
    ]);
  });

  it('does not report an overwrite against the module file it replaces', async () => {
    // Copying a module schema to the same path under `app/` and changing a property's type is
    // how you overwrite it. Only the copy deploys, so there is one declaration, not two —
    // counting both would report the fix as the bug.
    expect(
      await report({
        'modules/blog/public/schema/post.yml': schema('post', { expires_at: 'integer' }),
        'app/modules/blog/public/schema/post.yml': schema('post', { expires_at: 'string' }),
      }),
    ).toEqual([]);

    // The control: the overwrite still conflicts with a DIFFERENT schema, so the silence
    // above is the shadowing and not the check having stopped looking at module paths.
    expect(
      await report({
        'modules/blog/public/schema/post.yml': schema('post', { expires_at: 'integer' }),
        'app/modules/blog/public/schema/post.yml': schema('post', { expires_at: 'string' }),
        [ORDERS]: schema('order', { expires_at: 'float' }),
      }),
    ).toEqual([
      conflict('expires_at', 'string', `'float' in ${ORDERS}`),
      conflict('expires_at', 'float', `'string' in app/modules/blog/public/schema/post.yml`),
    ]);
  });

  it('reports one document that declares the same name twice with different types', async () => {
    expect(
      await report({
        [TOKENS]:
          schema('access_token', { expires_at: 'string' }) +
          `  - name: expires_at\n    type: integer\n`,
      }),
    ).toEqual([
      conflict('expires_at', 'string', `'integer' in ${TOKENS}`),
      conflict('expires_at', 'integer', `'string' in ${TOKENS}`),
    ]);
  });

  it('leaves a type the platform rejects to InvalidSchemaPropertyType', async () => {
    // A schema with an unaccepted type fails the deploy outright, so it never becomes one of
    // the declarations a query resolves against. Warning about it twice would be noise.
    expect(
      await report({
        [TOKENS]: schema('access_token', { expires_at: 'string' }),
        [ORDERS]: schema('order', { expires_at: 'not_a_real_type' }),
      }),
    ).toEqual([]);

    // The control: the same pair with an accepted type IS reported.
    expect(
      await report({
        [TOKENS]: schema('access_token', { expires_at: 'string' }),
        [ORDERS]: schema('order', { expires_at: 'integer' }),
      }),
    ).toEqual([
      conflict('expires_at', 'string', `'integer' in ${ORDERS}`),
      conflict('expires_at', 'integer', `'string' in ${TOKENS}`),
    ]);
  });

  it('says nothing about a YAML file whose properties are not converted', async () => {
    // ROOT-level `properties`, so the file type is what excludes it rather than nesting.
    expect(
      await report({
        [TOKENS]: schema('access_token', { expires_at: 'string' }),
        'app/translations/en.yml': 'properties:\n  - name: expires_at\n    type: integer\n',
      }),
    ).toEqual([]);
  });

  it.each([
    ['a property that declares no type', 'name: thing\nproperties:\n  - name: expires_at\n'],
    ['a property that declares no name', 'name: thing\nproperties:\n  - type: integer\n'],
    [
      'a Liquid-interpolated type',
      'name: thing\nproperties:\n  - name: expires_at\n    type: "{{ context.type }}"\n',
    ],
    ['no properties key at all', 'name: thing\n'],
    ['an empty properties sequence', 'name: thing\nproperties: []\n'],
  ])('stays silent on %s beside a real declaration', async (_label, source) => {
    expect(
      await report({
        [TOKENS]: schema('access_token', { expires_at: 'string' }),
        [ORDERS]: source,
      }),
    ).toEqual([]);
  });

  it('leaves an unparseable document to YAMLSyntaxError', async () => {
    // It contributes no declaration rather than an empty one: guessing at the types in a file
    // that does not parse would report a conflict against something nobody wrote.
    expect(
      await report({
        [TOKENS]: schema('access_token', { expires_at: 'string' }),
        [ORDERS]: 'name: order\nproperties:\n  - name: expires_at\n    type: [unclosed\n',
      }),
    ).toEqual([]);
  });
});
