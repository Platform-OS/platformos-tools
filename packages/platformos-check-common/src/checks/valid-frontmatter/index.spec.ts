import { expect, describe, it } from 'vitest';
import { ValidFrontmatter } from '.';
import { check } from '../../test';

const PAGE = 'app/views/pages/test.html.liquid';
const FORM = 'app/form_configurations/test.liquid';
const AUTH = 'app/authorization_policies/test.liquid';
const EMAIL = 'app/notifications/email_notifications/test.liquid';

describe('ValidFrontmatter', () => {
  // ── Required fields ───────────────────────────────────────────────────────

  describe('required fields', () => {
    it('reports missing required name in FormConfiguration', async () => {
      const files = {
        [FORM]: `---\nredirect_to: /home\n---\n`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense(
        "Missing required frontmatter field 'name' in FormConfiguration file",
      );
    });

    it('reports missing required name in AuthorizationPolicy', async () => {
      const files = {
        [AUTH]: `---\nredirect_to: /home\n---\n`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense(
        "Missing required frontmatter field 'name' in AuthorizationPolicy file",
      );
    });

    it('reports missing required to in Email notification', async () => {
      const files = {
        [EMAIL]: `---\nname: my_email\nfrom: sender@example.com\nsubject: Hello\n---\nHi`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense(
        "Missing required frontmatter field 'to' in Email file",
      );
    });

    it('does not report when required fields are present', async () => {
      const files = {
        [FORM]: `---\nname: my_form\n---\n`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.have.length(0);
    });

    it('does not report on Page files (no required fields)', async () => {
      const files = {
        [PAGE]: `---\nslug: /test\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.have.length(0);
    });

    it('does not report when there is no frontmatter', async () => {
      const files = {
        [FORM]: `{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.have.length(0);
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

    it('warns on deprecated headers field in ApiCall', async () => {
      const files = {
        'app/notifications/api_call_notifications/test.liquid': `---\nname: my_api_call\nto: https://example.com\nrequest_type: GET\nheaders: "{}"\n---\n`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
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
    it('reports invalid method on Page', async () => {
      const files = {
        [PAGE]: `---\nmethod: invalid\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense(
        "Invalid value 'invalid' for 'method'. Must be one of: delete, get, patch, post, put, options",
      );
    });

    it('accepts all valid method values on Page', async () => {
      for (const method of ['get', 'post', 'put', 'patch', 'delete', 'options']) {
        const files = {
          [PAGE]: `---\nmethod: ${method}\n---\n{{ content }}`,
        };
        const offenses = await check(files, [ValidFrontmatter]);
        expect(offenses).to.have.length(0);
      }
    });

    it('is case-insensitive for method values', async () => {
      const files = {
        [PAGE]: `---\nmethod: GET\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.have.length(0);
    });

    it('reports invalid redirect_code on Page', async () => {
      const files = {
        [PAGE]: `---\nredirect_to: /home\nredirect_code: 200\n---\n`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense(
        "Invalid value '200' for 'redirect_code'. Must be one of: 301, 302, 307",
      );
    });

    it('accepts valid redirect_code values', async () => {
      for (const code of [301, 302, 307]) {
        const files = {
          [PAGE]: `---\nredirect_to: /home\nredirect_code: ${code}\n---\n`,
        };
        const offenses = await check(files, [ValidFrontmatter]);
        expect(offenses).to.have.length(0);
      }
    });

    it('reports invalid http_status on AuthorizationPolicy', async () => {
      const files = {
        [AUTH]: `---\nname: my_policy\nhttp_status: 500\n---\n`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense(
        "Invalid value '500' for 'http_status'. Must be one of: 403, 404",
      );
    });

    it('accepts valid http_status values', async () => {
      for (const status of [403, 404]) {
        const files = {
          [AUTH]: `---\nname: my_policy\nhttp_status: ${status}\n---\n`,
        };
        const offenses = await check(files, [ValidFrontmatter]);
        expect(offenses).to.have.length(0);
      }
    });

    it('does not validate method on non-Page files', async () => {
      const files = {
        [FORM]: `---\nname: my_form\nmethod: invalid\n---\n`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      // Only the method offense would be wrong — no offense expected for method on forms
      expect(offenses.some((o) => o.message.includes("for 'method'"))).toBe(false);
    });
  });

  // ── Layout association ────────────────────────────────────────────────────

  describe('layout association', () => {
    it('reports missing layout file on Page', async () => {
      const files = {
        [PAGE]: `---\nlayout: nonexistent\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense("Layout 'nonexistent' does not exist");
    });

    it('does not report when layout file exists', async () => {
      const files = {
        'app/views/layouts/application.liquid': `{{ content }}`,
        [PAGE]: `---\nlayout: application\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.have.length(0);
    });

    it('reports missing module layout (public path)', async () => {
      const files = {
        [PAGE]: `---\nlayout: modules/my-module/layouts/email\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
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

    it('reports layout: false (boolean) and suggests empty string', async () => {
      const files = {
        [PAGE]: `---\nlayout: false\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense(
        "`layout: false` falls back to the default layout. Use `layout: ''` to disable layout rendering.",
      );
    });
  });

  // ── Authorization policy association ─────────────────────────────────────

  describe('authorization_policies association', () => {
    it('reports missing authorization policy file', async () => {
      const files = {
        [PAGE]: `---\nauthorization_policies:\n  - missing_policy\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense("Authorization policy 'missing_policy' does not exist");
    });

    it('does not report when authorization policy file exists', async () => {
      const files = {
        'app/authorization_policies/require_login.liquid': `---\nname: require_login\n---\n`,
        [PAGE]: `---\nauthorization_policies:\n  - require_login\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      // Only check for authorization_policies offense (policy file exists so no offense)
      expect(offenses.some((o) => o.message.includes('Authorization policy'))).toBe(false);
    });

    it('reports each missing policy in the list', async () => {
      const files = {
        [PAGE]: `---\nauthorization_policies:\n  - policy_a\n  - policy_b\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense("Authorization policy 'policy_a' does not exist");
      expect(offenses).to.containOffense("Authorization policy 'policy_b' does not exist");
    });
  });

  // ── Form notification associations ───────────────────────────────────────

  describe('form notification associations', () => {
    it('reports missing email notification', async () => {
      const files = {
        [FORM]: `---\nname: my_form\nemail_notifications:\n  - missing_email\n---\n`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense("Email notification 'missing_email' does not exist");
    });

    it('reports missing SMS notification', async () => {
      const files = {
        [FORM]: `---\nname: my_form\nsms_notifications:\n  - missing_sms\n---\n`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense("SMS notification 'missing_sms' does not exist");
    });

    it('reports missing API call notification', async () => {
      const files = {
        [FORM]: `---\nname: my_form\napi_call_notifications:\n  - missing_api_call\n---\n`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense(
        "API call notification 'missing_api_call' does not exist",
      );
    });

    it('does not report when email notification file exists', async () => {
      const files = {
        'app/notifications/email_notifications/welcome.liquid': `---\nname: welcome\nto: user@example.com\nsubject: Welcome\n---\n`,
        [FORM]: `---\nname: my_form\nemail_notifications:\n  - welcome\n---\n`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses.some((o) => o.message.includes('Email notification'))).toBe(false);
    });
  });

  // ── home.html.liquid deprecation ─────────────────────────────────────────

  describe('home.html.liquid deprecation', () => {
    it('warns when home.html.liquid is used', async () => {
      const files = {
        'app/views/pages/home.html.liquid': `---\nslug: /\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense(
        "'home.html.liquid' is deprecated. Rename to 'index.html.liquid' to serve as the root page.",
      );
    });

    it('does not warn for index.html.liquid', async () => {
      const files = {
        'app/views/pages/index.html.liquid': `---\nslug: /\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses.some((o) => o.message.includes('home.html.liquid'))).toBe(false);
    });

    it('does not warn for files whose name contains home but is not home.html.liquid', async () => {
      const files = {
        'app/views/pages/homepage.html.liquid': `{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses.some((o) => o.message.includes('home.html.liquid'))).toBe(false);
    });
  });

  // ── Unknown key validation ────────────────────────────────────────────────

  describe('unknown key validation', () => {
    it('warns on unknown keys in Page', async () => {
      const files = {
        [PAGE]: `---\nmy_custom_field: value\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense("Unknown frontmatter field 'my_custom_field' in Page file");
    });

    it('warns on unknown keys in FormConfiguration', async () => {
      const files = {
        [FORM]: `---\nname: my_form\nunknown_field: value\n---\n`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.containOffense("Unknown frontmatter field 'unknown_field' in FormConfiguration file");
    });
  });

  // ── Unrecognized file type ────────────────────────────────────────────────

  describe('unknown file type', () => {
    it('skips files in unknown directories', async () => {
      const files = {
        'some/random/path/file.liquid': `---\nfoo: bar\n---\n{{ content }}`,
      };
      const offenses = await check(files, [ValidFrontmatter]);
      expect(offenses).to.have.length(0);
    });
  });
});
