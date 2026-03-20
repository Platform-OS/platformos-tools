import { expect, describe, it } from 'vitest';
import { ValidFrontmatter } from '.';
import { check } from '../../test';

const PAGE = 'app/views/pages/test.html.liquid';
const FORM = 'app/forms/test.liquid';
const AUTH = 'app/authorization_policies/test.liquid';
const EMAIL = 'app/emails/test.liquid';
const SMS = 'app/smses/test.liquid';
const API_CALL = 'app/api_calls/test.liquid';
const LAYOUT = 'app/views/layouts/application.liquid';
const PARTIAL = 'app/views/partials/card.liquid';
const MIGRATION = 'app/migrations/20240101_seed.liquid';

describe('ValidFrontmatter', () => {
  // ── Required fields ───────────────────────────────────────────────────────

  describe('no required fields (name derived from file path)', () => {
    it('does not report on Page with no frontmatter fields', async () => {
      const offenses = await check(
        { [PAGE]: `---\nslug: /test\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses).to.have.length(0);
    });

    it('does not report on FormConfiguration with no name field', async () => {
      const offenses = await check(
        { [FORM]: `---\nresource: User\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses.some((o) => o.message.includes('Missing required'))).toBe(false);
    });

    it('does not report on AuthorizationPolicy with no name field', async () => {
      const offenses = await check(
        { [AUTH]: `---\nhttp_status: 403\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses.some((o) => o.message.includes('Missing required'))).toBe(false);
    });

    it('does not report on Email with only from field', async () => {
      const offenses = await check(
        { [EMAIL]: `---\nfrom: sender@example.com\n---\nHi` },
        [ValidFrontmatter],
      );
      expect(offenses.some((o) => o.message.includes('Missing required'))).toBe(false);
    });

    it('does not report on ApiCall with only to and request_type', async () => {
      const offenses = await check(
        { [API_CALL]: `---\nto: https://example.com\nrequest_type: GET\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses.some((o) => o.message.includes('Missing required'))).toBe(false);
    });

    it('does not report on SMS with only to field', async () => {
      const offenses = await check(
        { [SMS]: `---\nto: "+15550001234"\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses.some((o) => o.message.includes('Missing required'))).toBe(false);
    });

    it('does not report when there is no frontmatter', async () => {
      const offenses = await check({ [FORM]: `{{ content }}` }, [ValidFrontmatter]);
      expect(offenses).to.have.length(0);
    });

    it('does not report on empty frontmatter block', async () => {
      const offenses = await check({ [FORM]: `---\n---\n` }, [ValidFrontmatter]);
      expect(offenses.some((o) => o.message.includes('Missing required'))).toBe(false);
    });
  });

  // ── Deprecated fields ─────────────────────────────────────────────────────

  describe('deprecated fields', () => {
    it('warns on layout_name on Page', async () => {
      const files = {
        'app/views/layouts/application.liquid': `{{ content }}`,
        [PAGE]: `---\nlayout_name: application\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense('Use `layout` instead of `layout_name`.');
    });

    it('warns on deprecated redirect_url on Page', async () => {
      const offenses = await check(
        { [PAGE]: `---\nredirect_url: /home\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense('Use `redirect_to` instead of `redirect_url`.');
    });

    it('does not warn on redirect_to (non-deprecated)', async () => {
      const offenses = await check(
        { [PAGE]: `---\nredirect_to: /home\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses).to.have.length(0);
    });

    it('warns on deprecated return_to in FormConfiguration', async () => {
      const offenses = await check(
        { [FORM]: `---\nname: my_form\nreturn_to: /home\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense('Use `redirect_to` instead of `return_to`.');
    });

    it('does not warn on redirect_to in FormConfiguration (non-deprecated)', async () => {
      const offenses = await check(
        { [FORM]: `---\nname: my_form\nredirect_to: /home\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.have.length(0);
    });

    it('warns on deprecated layout_path in Email', async () => {
      const offenses = await check(
        { [EMAIL]: `---\nlayout_path: email_base\n---\nHi` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense('Use `layout` instead of `layout_path`.');
    });

    it('does not warn on layout in Email (non-deprecated)', async () => {
      const files = {
        'app/views/layouts/email_base.liquid': `{{ content }}`,
        [EMAIL]: `---\nlayout: email_base\n---\nHi`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.have.length(0);
    });

    it('warns on deprecated headers field in ApiCall', async () => {
      const offenses = await check(
        { [API_CALL]: `---\nto: https://example.com\nrequest_type: GET\nheaders: "{}"\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense('Use `request_headers` instead of `headers`.');
    });

    it('does not warn on non-deprecated fields', async () => {
      const files = {
        'app/views/layouts/application.liquid': `{{ content }}`,
        [PAGE]: `---\nlayout: application\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.have.length(0);
    });
  });

  // ── Enum validation ───────────────────────────────────────────────────────

  describe('enum validation', () => {
    // Page method
    it('reports invalid method on Page', async () => {
      const offenses = await check(
        { [PAGE]: `---\nmethod: invalid\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "Invalid value 'invalid' for 'method'. Must be one of: delete, get, patch, post, put, options",
      );
    });

    it('accepts all valid method values on Page', async () => {
      for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options']) {
        const offenses = await check(
          { [PAGE]: `---\nmethod: ${method}\n---\n{{ content }}` },
          [ValidFrontmatter],
        );
        expect(offenses).to.have.length(0);
      }
    });

    it('is case-insensitive for method values', async () => {
      const offenses = await check(
        { [PAGE]: `---\nmethod: GET\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses).to.have.length(0);
    });

    // Page redirect_code
    it('reports invalid redirect_code on Page', async () => {
      const offenses = await check(
        { [PAGE]: `---\nredirect_to: /home\nredirect_code: 200\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "Invalid value '200' for 'redirect_code'. Must be one of: 301, 302, 307",
      );
    });

    it('accepts valid redirect_code values', async () => {
      for (const code of [301, 302, 307]) {
        const offenses = await check(
          { [PAGE]: `---\nredirect_to: /home\nredirect_code: ${code}\n---\n` },
          [ValidFrontmatter],
        );
        expect(offenses).to.have.length(0);
      }
    });

    // AuthorizationPolicy http_status
    it('reports invalid http_status on AuthorizationPolicy', async () => {
      const offenses = await check(
        { [AUTH]: `---\nname: my_policy\nhttp_status: 500\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "Invalid value '500' for 'http_status'. Must be one of: 403, 404",
      );
    });

    it('accepts valid http_status values', async () => {
      for (const status of [403, 404]) {
        const offenses = await check(
          { [AUTH]: `---\nname: my_policy\nhttp_status: ${status}\n---\n` },
          [ValidFrontmatter],
        );
        expect(offenses).to.have.length(0);
      }
    });

    // FormConfiguration spam_protection
    it('reports invalid spam_protection in FormConfiguration', async () => {
      const offenses = await check(
        { [FORM]: `---\nname: my_form\nspam_protection: invalid_type\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "Invalid value 'invalid_type' for 'spam_protection'. Must be one of: recaptcha, recaptcha_v2, recaptcha_v3, hcaptcha",
      );
    });

    it('accepts all valid spam_protection values', async () => {
      for (const val of ['recaptcha', 'recaptcha_v2', 'recaptcha_v3', 'hcaptcha']) {
        const offenses = await check(
          { [FORM]: `---\nname: my_form\nspam_protection: ${val}\n---\n` },
          [ValidFrontmatter],
        );
        expect(offenses).to.have.length(0);
      }
    });

    // ApiCall request_type
    it('reports invalid request_type in ApiCall', async () => {
      const offenses = await check(
        { [API_CALL]: `---\nname: my_call\nto: https://example.com\nrequest_type: INVALID\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "Invalid value 'INVALID' for 'request_type'. Must be one of: GET, POST, PUT, PATCH, DELETE",
      );
    });

    it('accepts all valid request_type values', async () => {
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        const offenses = await check(
          { [API_CALL]: `---\nname: my_call\nto: https://example.com\nrequest_type: ${method}\n---\n` },
          [ValidFrontmatter],
        );
        expect(offenses).to.have.length(0);
      }
    });

    it('is case-insensitive for request_type values', async () => {
      const offenses = await check(
        { [API_CALL]: `---\nname: my_call\nto: https://example.com\nrequest_type: get\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.have.length(0);
    });

    it('does not validate method on non-Page files', async () => {
      const offenses = await check(
        { [FORM]: `---\nname: my_form\nmethod: invalid\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses.some((o) => o.message.includes("for 'method'"))).toBe(false);
    });
  });

  // ── Layout association ────────────────────────────────────────────────────

  describe('layout association', () => {
    // Page
    it('reports missing layout file on Page', async () => {
      const offenses = await check(
        { [PAGE]: `---\nlayout: nonexistent\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense("Layout 'nonexistent' does not exist");
    });

    it('does not report when layout file exists on Page', async () => {
      const files = {
        'app/views/layouts/application.liquid': `{{ content }}`,
        [PAGE]: `---\nlayout: application\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.have.length(0);
    });

    it('reports missing module layout (public path)', async () => {
      const offenses = await check(
        { [PAGE]: `---\nlayout: modules/my-module/layouts/email\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense("Layout 'modules/my-module/layouts/email' does not exist");
    });

    it('does not report when module layout exists at public path', async () => {
      const files = {
        'modules/my-module/public/views/layouts/layouts/email.liquid': `{{ content }}`,
        [PAGE]: `---\nlayout: modules/my-module/layouts/email\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.have.length(0);
    });

    it('does not report when module layout exists at private path', async () => {
      const files = {
        'modules/my-module/private/views/layouts/layouts/email.liquid': `{{ content }}`,
        [PAGE]: `---\nlayout: modules/my-module/layouts/email\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.have.length(0);
    });

    it('reports layout: false (boolean) and suggests empty string on Page', async () => {
      const offenses = await check(
        { [PAGE]: `---\nlayout: false\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "`layout: false` falls back to the default layout. Use `layout: ''` to disable layout rendering.",
      );
    });

    it('does not warn for layout: empty string on Page (valid disable)', async () => {
      const offenses = await check(
        { [PAGE]: `---\nlayout: ''\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses.some((o) => o.message.includes('does not exist'))).toBe(false);
      expect(offenses.some((o) => o.message.includes('falls back'))).toBe(false);
    });

    // Email layout
    it('reports missing layout file on Email', async () => {
      const offenses = await check(
        { [EMAIL]: `---\nlayout: nonexistent_email_layout\n---\nHi` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense("Layout 'nonexistent_email_layout' does not exist");
    });

    it('does not report when layout file exists on Email', async () => {
      const files = {
        'app/views/layouts/email_base.liquid': `{{ content }}`,
        [EMAIL]: `---\nlayout: email_base\n---\nHi`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.have.length(0);
    });

    it('reports layout: false (boolean) on Email', async () => {
      const offenses = await check(
        { [EMAIL]: `---\nlayout: false\n---\nHi` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "`layout: false` falls back to the default layout. Use `layout: ''` to disable layout rendering.",
      );
    });
  });

  // ── Authorization policy association ─────────────────────────────────────

  describe('authorization_policies association', () => {
    it('reports missing authorization policy file', async () => {
      const offenses = await check(
        { [PAGE]: `---\nauthorization_policies:\n  - missing_policy\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense("Authorization policy 'missing_policy' does not exist");
    });

    it('does not report when authorization policy file exists', async () => {
      const files = {
        'app/authorization_policies/require_login.liquid': `---\nname: require_login\n---\n`,
        [PAGE]: `---\nauthorization_policies:\n  - require_login\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses.some((o) => o.message.includes('Authorization policy'))).toBe(false);
    });

    it('reports each missing policy in the list', async () => {
      const offenses = await check(
        { [PAGE]: `---\nauthorization_policies:\n  - policy_a\n  - policy_b\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense("Authorization policy 'policy_a' does not exist");
      expect(offenses).to.containOffense("Authorization policy 'policy_b' does not exist");
    });
  });

  // ── Form notification associations ───────────────────────────────────────

  describe('form notification associations', () => {
    it('reports missing email notification', async () => {
      const offenses = await check(
        { [FORM]: `---\nname: my_form\nemail_notifications:\n  - missing_email\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense("Email notification 'missing_email' does not exist");
    });

    it('reports missing SMS notification', async () => {
      const offenses = await check(
        { [FORM]: `---\nname: my_form\nsms_notifications:\n  - missing_sms\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense("SMS notification 'missing_sms' does not exist");
    });

    it('reports missing API call notification', async () => {
      const offenses = await check(
        { [FORM]: `---\nname: my_form\napi_call_notifications:\n  - missing_api_call\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "API call notification 'missing_api_call' does not exist",
      );
    });

    it('does not report when email notification file exists', async () => {
      const files = {
        'app/emails/welcome.liquid': `---\nto: user@example.com\nsubject: Welcome\n---\n`,
        [FORM]: `---\nemail_notifications:\n  - welcome\n---\n`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses.some((o) => o.message.includes('Email notification'))).toBe(false);
    });

    it('does not report when SMS notification file exists', async () => {
      const files = {
        'app/smses/alert.liquid': `---\nto: "+15550001234"\n---\n`,
        [FORM]: `---\nsms_notifications:\n  - alert\n---\n`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses.some((o) => o.message.includes('SMS notification'))).toBe(false);
    });

    it('does not report when API call notification file exists', async () => {
      const files = {
        'app/api_calls/webhook.liquid': `---\nto: https://example.com\nrequest_type: POST\n---\n`,
        [FORM]: `---\napi_call_notifications:\n  - webhook\n---\n`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses.some((o) => o.message.includes('API call notification'))).toBe(false);
    });

    it('reports each missing notification individually in a list', async () => {
      const offenses = await check(
        { [FORM]: `---\nname: my_form\nemail_notifications:\n  - email_a\n  - email_b\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense("Email notification 'email_a' does not exist");
      expect(offenses).to.containOffense("Email notification 'email_b' does not exist");
    });

    it('only reports missing items when some exist and some do not', async () => {
      const files = {
        'app/emails/welcome.liquid': `---\nto: u@e.com\nsubject: Hi\n---\n`,
        [FORM]: `---\nemail_notifications:\n  - welcome\n  - missing_one\n---\n`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense("Email notification 'missing_one' does not exist");
      expect(offenses.some((o) => o.message.includes("'welcome'"))).toBe(false);
    });
  });

  // ── home.html.liquid deprecation ─────────────────────────────────────────

  describe('home.html.liquid deprecation', () => {
    it('warns when home.html.liquid is used', async () => {
      const offenses = await check(
        { 'app/views/pages/home.html.liquid': `---\nslug: /\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "'home.html.liquid' is deprecated. Rename to 'index.html.liquid' to serve as the root page.",
      );
    });

    it('does not warn for index.html.liquid', async () => {
      const offenses = await check(
        { 'app/views/pages/index.html.liquid': `---\nslug: /\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses.some((o) => o.message.includes('home.html.liquid'))).toBe(false);
    });

    it('does not warn for files whose name contains home but is not home.html.liquid', async () => {
      const offenses = await check(
        { 'app/views/pages/homepage.html.liquid': `{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses.some((o) => o.message.includes('home.html.liquid'))).toBe(false);
    });
  });

  // ── Unknown key validation ────────────────────────────────────────────────

  describe('unknown key validation', () => {
    it('warns on unknown keys in Page', async () => {
      const offenses = await check(
        { [PAGE]: `---\nmy_custom_field: value\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense("Unknown frontmatter field 'my_custom_field' in Page file");
    });

    it('warns on unknown keys in FormConfiguration', async () => {
      const offenses = await check(
        { [FORM]: `---\nname: my_form\nunknown_field: value\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "Unknown frontmatter field 'unknown_field' in FormConfiguration file",
      );
    });

    it('warns on unknown keys in AuthorizationPolicy', async () => {
      const offenses = await check(
        { [AUTH]: `---\nname: my_policy\nunknown_field: value\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "Unknown frontmatter field 'unknown_field' in AuthorizationPolicy file",
      );
    });

    it('flash_notice is not valid in AuthorizationPolicy (only flash_alert is)', async () => {
      const offenses = await check(
        { [AUTH]: `---\nname: my_policy\nflash_notice: Denied\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "Unknown frontmatter field 'flash_notice' in AuthorizationPolicy file",
      );
    });

    it('warns on unknown keys in Email', async () => {
      const offenses = await check(
        { [EMAIL]: `---\nname: my_email\nto: u@e.com\nsubject: Hi\nunknown_field: value\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "Unknown frontmatter field 'unknown_field' in Email file",
      );
    });

    it('accepts unique_args in Email (valid server-side field)', async () => {
      const offenses = await check(
        { [EMAIL]: `---\nname: my_email\nto: u@e.com\nsubject: Hi\nunique_args:\n  campaign: welcome\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses.some((o) => o.message.includes("'unique_args'"))).toBe(false);
    });

    it('warns on unknown keys in SMS', async () => {
      const offenses = await check(
        { [SMS]: `---\nname: my_sms\nto: "+15550001234"\ncontent: Hello\nunknown_field: value\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "Unknown frontmatter field 'unknown_field' in SMS file",
      );
    });

    it('warns on unknown keys in ApiCall', async () => {
      const offenses = await check(
        { [API_CALL]: `---\nname: my_call\nto: https://example.com\nrequest_type: GET\nunknown_field: value\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "Unknown frontmatter field 'unknown_field' in ApiCall file",
      );
    });

    it('warns on unknown keys in Layout', async () => {
      const offenses = await check(
        { [LAYOUT]: `---\nunknown_field: value\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "Unknown frontmatter field 'unknown_field' in Layout file",
      );
    });

    it('name is not a valid Layout frontmatter field (derived from file path)', async () => {
      const offenses = await check(
        { [LAYOUT]: `---\nname: my_layout\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "Unknown frontmatter field 'name' in Layout file",
      );
    });

    it('warns on unknown keys in Partial', async () => {
      const offenses = await check(
        { [PARTIAL]: `---\nunknown_field: value\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses).to.containOffense(
        "Unknown frontmatter field 'unknown_field' in Partial file",
      );
    });

    it('does not validate Migration files (no schema — arbitrary frontmatter allowed)', async () => {
      const offenses = await check(
        { [MIGRATION]: `---\ncustom_key: value\nanother_key: 123\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses.some((o) => o.message.includes('Unknown frontmatter'))).toBe(false);
    });
  });

  // ── Union-type field validation ───────────────────────────────────────────

  describe('union-type fields', () => {
    it('accepts trigger_condition as boolean in Email', async () => {
      const offenses = await check(
        { [EMAIL]: `---\ntrigger_condition: true\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses.some((o) => o.message.includes("'trigger_condition'"))).toBe(false);
    });

    it('accepts trigger_condition as string in Email', async () => {
      const offenses = await check(
        { [EMAIL]: `---\ntrigger_condition: "{{ context.current_user != blank }}"\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses.some((o) => o.message.includes("'trigger_condition'"))).toBe(false);
    });

    it('accepts trigger_condition as boolean in SMS', async () => {
      const offenses = await check(
        { [SMS]: `---\ntrigger_condition: false\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses.some((o) => o.message.includes("'trigger_condition'"))).toBe(false);
    });

    it('accepts trigger_condition as boolean in ApiCall', async () => {
      const offenses = await check(
        { [API_CALL]: `---\nto: https://example.com\nrequest_type: POST\ntrigger_condition: true\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses.some((o) => o.message.includes("'trigger_condition'"))).toBe(false);
    });

    it('accepts default_payload as string in FormConfiguration', async () => {
      const offenses = await check(
        { [FORM]: `---\ndefault_payload: "{}"\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses.some((o) => o.message.includes("'default_payload'"))).toBe(false);
    });

    it('accepts resource as string in FormConfiguration', async () => {
      const offenses = await check(
        { [FORM]: `---\nresource: User\n---\n` },
        [ValidFrontmatter],
      );
      expect(offenses.some((o) => o.message.includes("'resource'"))).toBe(false);
    });
  });

  // ── Unrecognized file type ────────────────────────────────────────────────

  describe('unknown file type', () => {
    it('skips files in unknown directories', async () => {
      const offenses = await check(
        { 'some/random/path/file.liquid': `---\nfoo: bar\n---\n{{ content }}` },
        [ValidFrontmatter],
      );
      expect(offenses).to.have.length(0);
    });
  });
});
