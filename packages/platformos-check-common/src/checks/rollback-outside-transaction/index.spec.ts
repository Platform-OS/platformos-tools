import { describe, expect, it } from 'vitest';
import { check, highlightedOffenses, messagesOf } from '../../test';
import { RollbackOutsideTransaction } from '.';

const RAISES = 'At runtime the platform raises "rollback performed outside of transaction".';
const BACKGROUND_REASON =
  'A {% background %} job runs only after the transaction that scheduled it commits, so it is never inside one.';

const direct = (reason = '') =>
  `{% rollback %} is not inside a {% transaction %} block.${reason} ${RAISES}`;

const through = (verb: string, name: string, chain = '', reason = '') =>
  `${verb} '${name}' reaches a {% rollback %} that is not inside a {% transaction %} block${chain}.${reason} ${RAISES}`;

const run = (app: Record<string, string>) => check(app, [RollbackOutsideTransaction]);

describe('Module: RollbackOutsideTransaction', () => {
  describe('a rollback written in the file being checked', () => {
    it('reports a bare rollback in a page', async () => {
      const app = { 'app/views/pages/index.liquid': `{% rollback %}` };

      const offenses = await run(app);

      expect(messagesOf(offenses)).toEqual([direct()]);
      expect(highlightedOffenses(app, offenses)).toEqual(['{% rollback %}']);
    });

    it('reports a bare rollback written inside a {% liquid %} tag', async () => {
      const app = { 'app/views/pages/index.liquid': `{% liquid\n  rollback %}` };

      const offenses = await run(app);

      expect(messagesOf(offenses)).toEqual([direct()]);
    });

    it('stays silent inside a transaction, and still reports the one outside it', async () => {
      // The control: a suppression wide enough to hide the second rollback would pass a
      // "nothing was reported" assertion on its own.
      const app = {
        'app/views/pages/index.liquid': `{% transaction %}{% rollback %}{% endtransaction %}{% rollback %}`,
      };

      const offenses = await run(app);

      expect(messagesOf(offenses)).toEqual([direct()]);
      expect(offenses.map((offense) => offense.start.index)).toEqual([
        app['app/views/pages/index.liquid'].lastIndexOf('{% rollback %}'),
      ]);
    });

    it('stays silent for a rollback nested in branches inside a transaction', async () => {
      const offenses = await run({
        'app/views/pages/index.liquid': `{% transaction %}{% if a %}{% unless b %}{% rollback %}{% endunless %}{% endif %}{% endtransaction %}`,
      });

      expect(messagesOf(offenses)).toEqual([]);
    });

    it('stays silent for a transaction written inside a {% liquid %} tag', async () => {
      const offenses = await run({
        'app/views/pages/index.liquid': `{% liquid
  transaction
    function user = 'modules/core/commands/execute', mutation_name: 'modules/user/user/create', object: object, selection: 'user'
    assign object.user_id = user.id

    function profile = 'modules/user/commands/profiles/create', object: object
    unless profile.valid == true
      rollback
    endunless
  endtransaction
%}`,
      });

      expect(messagesOf(offenses)).toEqual([]);
    });

    it('reports every rollback a page leaves outside a transaction, in source order', async () => {
      const source = `{% rollback %}{% transaction %}{% rollback %}{% endtransaction %}{% rollback %}`;
      const app = { 'app/views/pages/index.liquid': source };

      const offenses = await run(app);

      expect(messagesOf(offenses)).toEqual([direct(), direct()]);
      expect(offenses.map((offense) => offense.start.index)).toEqual([
        source.indexOf('{% rollback %}'),
        source.lastIndexOf('{% rollback %}'),
      ]);
    });
  });

  describe('the file type decides whether the entry state is known', () => {
    const source = `{% rollback %}`;

    it.each([
      ['app/views/pages/index.liquid', [direct()]],
      ['app/views/layouts/application.liquid', [direct()]],
      ['app/emails/welcome.liquid', [direct()]],
      ['app/api_calls/ping.liquid', [direct()]],
      ['app/smses/alert.liquid', [direct()]],
      // A partial's caller owns the transaction, so the rollback may well be correct.
      ['app/views/partials/place.liquid', []],
      ['app/lib/commands/place.liquid', []],
      // DataMigration#execute_queries wraps the whole render in a transaction.
      ['app/migrations/20240101000000_backfill.liquid', []],
      // Both reachable from a programmatic form submit, which inherits its caller's transaction.
      ['app/form_configurations/sign_up.liquid', []],
      ['app/authorization_policies/is_admin.liquid', []],
    ])('%s', async (path, expected) => {
      expect(messagesOf(await run({ [path]: source }))).toEqual(expected);
    });
  });

  describe('a rollback reached through a call', () => {
    it('reports the call site when the partial rolls back', async () => {
      const app = {
        'app/views/pages/index.liquid': `{% render 'order/place' %}`,
        'app/views/partials/order/place.liquid': `{% rollback %}`,
      };

      const offenses = await run(app);

      expect(messagesOf(offenses)).toEqual([through('Rendering', 'order/place')]);
      expect(highlightedOffenses(app, offenses)).toEqual([`{% render 'order/place' %}`]);
    });

    it('names the whole chain when the rollback is deeper down', async () => {
      const offenses = await run({
        'app/views/pages/index.liquid': `{% function _ = 'outer' %}`,
        'app/lib/outer.liquid': `{% render 'middle' %}`,
        'app/views/partials/middle.liquid': `{% render 'inner' %}`,
        'app/views/partials/inner.liquid': `{% rollback %}`,
      });

      expect(messagesOf(offenses)).toEqual([
        through('Calling', 'outer', ' (outer → middle → inner)'),
      ]);
    });

    it('reports an {% include %} call site', async () => {
      const offenses = await run({
        'app/views/pages/index.liquid': `{% include 'place' %}`,
        'app/views/partials/place.liquid': `{% rollback %}`,
      });

      expect(messagesOf(offenses)).toEqual([through('Including', 'place')]);
    });

    it('stays silent when the call is wrapped in a transaction, and reports the identical call that is not', async () => {
      const offenses = await run({
        'app/views/pages/wrapped.liquid': `{% transaction %}{% render 'place' %}{% endtransaction %}`,
        'app/views/pages/bare.liquid': `{% render 'place' %}`,
        'app/views/partials/place.liquid': `{% rollback %}`,
      });

      expect(messagesOf(offenses)).toEqual([through('Rendering', 'place')]);
      expect(offenses.map((offense) => offense.uri)).toEqual([
        'file:///app/views/pages/bare.liquid',
      ]);
    });

    it('stays silent when the partial opens its own transaction, and reports the sibling that does not', async () => {
      const offenses = await run({
        'app/views/pages/index.liquid': `{% render 'guarded' %}{% render 'unguarded' %}`,
        'app/views/partials/guarded.liquid': `{% transaction %}{% rollback %}{% endtransaction %}`,
        'app/views/partials/unguarded.liquid': `{% rollback %}`,
      });

      expect(messagesOf(offenses)).toEqual([through('Rendering', 'unguarded')]);
    });

    it('stays silent for a partial that never reaches a rollback, when a sibling does', async () => {
      const offenses = await run({
        'app/views/pages/index.liquid': `{% render 'safe' %}{% render 'unsafe' %}`,
        'app/views/partials/safe.liquid': `{% render 'leaf' %}`,
        'app/views/partials/leaf.liquid': `{{ 'hello' }}`,
        'app/views/partials/unsafe.liquid': `{% rollback %}`,
      });

      expect(messagesOf(offenses)).toEqual([through('Rendering', 'unsafe')]);
    });

    it('terminates on a render cycle and still finds the rollback inside it', async () => {
      const offenses = await run({
        'app/views/pages/index.liquid': `{% render 'a' %}`,
        'app/views/partials/a.liquid': `{% render 'b' %}`,
        'app/views/partials/b.liquid': `{% render 'a' %}{% rollback %}`,
      });

      expect(messagesOf(offenses)).toEqual([through('Rendering', 'a', ' (a → b)')]);
    });

    it('terminates on a render cycle with no rollback in it', async () => {
      const offenses = await run({
        'app/views/pages/index.liquid': `{% render 'a' %}`,
        'app/views/partials/a.liquid': `{% render 'b' %}`,
        'app/views/partials/b.liquid': `{% render 'a' %}`,
      });

      expect(messagesOf(offenses)).toEqual([]);
    });

    it('stays silent for a partial that does not exist, and reports the one that does', async () => {
      // MissingPartial owns the "it is not there" report; this check must not double up.
      const offenses = await run({
        'app/views/pages/index.liquid': `{% render 'nowhere' %}{% render 'place' %}`,
        'app/views/partials/place.liquid': `{% rollback %}`,
      });

      expect(messagesOf(offenses)).toEqual([through('Rendering', 'place')]);
    });

    it('stays silent for a computed partial name, and reports the literal one', async () => {
      const offenses = await run({
        'app/views/pages/index.liquid': `{% render partial_name %}{% render 'place' %}`,
        'app/views/partials/place.liquid': `{% rollback %}`,
      });

      expect(messagesOf(offenses)).toEqual([through('Rendering', 'place')]);
    });

    it('stays silent when a partial calls a partial from inside its own transaction', async () => {
      const offenses = await run({
        'app/views/pages/index.liquid': `{% render 'outer' %}`,
        'app/views/partials/outer.liquid': `{% transaction %}{% render 'inner' %}{% endtransaction %}`,
        'app/views/partials/inner.liquid': `{% rollback %}`,
      });

      expect(messagesOf(offenses)).toEqual([]);
    });
  });

  describe('{% background %} never inherits the transaction that scheduled it', () => {
    it('reports a rollback inside a background block that a transaction wraps', async () => {
      const offenses = await run({
        'app/views/pages/index.liquid': `{% transaction %}{% background %}{% rollback %}{% endbackground %}{% endtransaction %}`,
      });

      expect(messagesOf(offenses)).toEqual([direct(` ${BACKGROUND_REASON}`)]);
    });

    it('reports a background call from inside a transaction', async () => {
      const offenses = await run({
        'app/views/pages/index.liquid': `{% transaction %}{% background _ = 'place' %}{% endtransaction %}`,
        'app/views/partials/place.liquid': `{% rollback %}`,
      });

      expect(messagesOf(offenses)).toEqual([
        through('Scheduling', 'place', '', ` ${BACKGROUND_REASON}`),
      ]);
    });

    it('reports a background call written in a partial, where a render call stays silent', async () => {
      const offenses = await run({
        'app/views/partials/scheduler.liquid': `{% render 'place' %}{% background _ = 'place' %}`,
        'app/views/partials/place.liquid': `{% rollback %}`,
      });

      expect(messagesOf(offenses)).toEqual([
        through('Scheduling', 'place', '', ` ${BACKGROUND_REASON}`),
      ]);
    });

    it("reports a background block in a partial, where the partial's own bare rollback stays silent", async () => {
      // The discriminating case for the barrier: this file's entry state is UNKNOWN, so only
      // the {% background %} between the rollback and the top of the file can decide it.
      const source = `{% rollback %}{% background %}{% rollback %}{% endbackground %}`;
      const app = { 'app/views/partials/scheduler.liquid': source };

      const offenses = await run(app);

      expect(messagesOf(offenses)).toEqual([direct(` ${BACKGROUND_REASON}`)]);
      expect(offenses.map((offense) => offense.start.index)).toEqual([
        source.lastIndexOf('{% rollback %}'),
      ]);
    });

    it('reports a background block in a migration, whose own bare rollback stays silent', async () => {
      // The other discriminating case: a migration's entry state is IN a transaction, and the
      // background block is what takes the job back out of it.
      const source = `{% rollback %}{% background %}{% rollback %}{% endbackground %}`;
      const app = { 'app/migrations/20240101000000_backfill.liquid': source };

      const offenses = await run(app);

      expect(messagesOf(offenses)).toEqual([direct(` ${BACKGROUND_REASON}`)]);
      expect(offenses.map((offense) => offense.start.index)).toEqual([
        source.lastIndexOf('{% rollback %}'),
      ]);
    });

    it('stays silent when the background body opens its own transaction, and reports the one that does not', async () => {
      const offenses = await run({
        'app/views/pages/index.liquid': `{% background %}{% transaction %}{% rollback %}{% endtransaction %}{% rollback %}{% endbackground %}`,
      });

      expect(messagesOf(offenses)).toEqual([direct(` ${BACKGROUND_REASON}`)]);
    });
  });

  describe('a theme_render_rc call resolves through the configured search paths', () => {
    it('reports the partial the search path selects', async () => {
      const offenses = await run({
        'app/config.yml': 'theme_search_paths:\n  - theme/dress',
        'app/views/pages/index.liquid': `{% theme_render_rc 'place' %}`,
        'app/views/partials/theme/dress/place.liquid': `{% rollback %}`,
        'app/views/partials/place.liquid': `{% transaction %}{% rollback %}{% endtransaction %}`,
      });

      expect(messagesOf(offenses)).toEqual([through('Rendering', 'place')]);
    });
  });

  describe('{% content_for %} runs where its {% yield %} is', () => {
    it('stays silent inside a content_for block, and reports the rollback beside it', async () => {
      const offenses = await run({
        'app/views/pages/index.liquid': `{% content_for 'body' %}{% rollback %}{% endcontent_for %}{% rollback %}`,
      });

      expect(messagesOf(offenses)).toEqual([direct()]);
    });

    it('stays silent for a partial reached only from a content_for block', async () => {
      const offenses = await run({
        'app/views/pages/index.liquid': `{% content_for 'body' %}{% render 'place' %}{% endcontent_for %}`,
        'app/views/partials/place.liquid': `{% rollback %}`,
      });

      expect(messagesOf(offenses)).toEqual([]);
    });
  });
});
