/**
 * Frontmatter schema definitions for platformOS Liquid file types.
 *
 * Each Liquid file type in platformOS has a YAML frontmatter section at the
 * top of the file that configures server-side behaviour. The schema for each
 * type is different — Pages have slug/layout, Emails have to/from/subject, etc.
 *
 * This module provides:
 *   - FrontmatterFieldSchema  — type definition for a single field
 *   - FrontmatterSchema       — type definition for a complete schema
 *   - FRONTMATTER_SCHEMAS     — per-type schemas keyed by PlatformOSFileType
 *   - getFrontmatterSchema()  — convenience lookup that returns undefined for
 *                               types without a frontmatter schema
 */

import { PlatformOSFileType } from './path-utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FrontmatterFieldType = 'string' | 'boolean' | 'integer' | 'number' | 'array' | 'object';

export interface FrontmatterFieldSchema {
  /** The expected YAML type(s) for this field's value. */
  type: FrontmatterFieldType | FrontmatterFieldType[];
  /** Whether this field must be present. */
  required?: boolean;
  /** Human-readable description of this field. */
  description?: string;
  /** Whether this field name is deprecated in favour of a newer one. */
  deprecated?: boolean;
  /** Message shown when this deprecated field is used. */
  deprecatedMessage?: string;
  /**
   * Allowed values for this field. When set, a validator should warn if the
   * field value is not one of these entries.
   */
  enumValues?: (string | number)[];
}

export interface FrontmatterSchema {
  /** Human-readable name of the file type, used in diagnostics. */
  name: string;
  /**
   * Known frontmatter fields.
   * Checks can use this to surface unknown keys or missing required keys.
   */
  fields: Record<string, FrontmatterFieldSchema>;
  /**
   * Whether fields not listed in `fields` are allowed without a warning.
   * Defaults to true — schemas are additive and may not be exhaustive.
   */
  allowAdditionalFields?: boolean;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

/**
 * Per-type frontmatter schemas.
 *
 * Only Liquid file types are present here — GraphQL, YAML, and Asset types
 * do not use frontmatter.
 *
 * Field lists are based on FRONTMATTER.md and real-world usage in platformOS
 * apps. Enum constraints mirror the server-side converter validations.
 * Set `allowAdditionalFields: true` (the default) everywhere so that apps
 * using custom/undocumented keys don't get false-positive warnings until the
 * schemas are finalised.
 */
export const FRONTMATTER_SCHEMAS: Partial<Record<PlatformOSFileType, FrontmatterSchema>> = {
  // ── Page ─────────────────────────────────────────────────────────────────────
  [PlatformOSFileType.Page]: {
    name: 'Page',
    fields: {
      slug: {
        type: 'string',
        description: 'URL slug for this page. Supports dynamic segments (e.g. users/:id).',
      },
      layout: {
        type: 'string',
        description: 'Layout template to wrap this page (path relative to app root, no extension).',
      },
      layout_name: {
        type: 'string',
        description: 'Alias for layout.',
        deprecated: true,
        deprecatedMessage: 'Use `layout` instead of `layout_name`.',
      },
      method: {
        type: 'string',
        description: 'HTTP method this page responds to.',
        enumValues: ['delete', 'get', 'patch', 'post', 'put', 'options'],
      },
      redirect_to: {
        type: 'string',
        description: 'URL to redirect to.',
      },
      redirect_url: {
        type: 'string',
        description: 'Alias for redirect_to.',
      },
      redirect_code: {
        type: 'integer',
        description: 'HTTP redirect status code.',
        enumValues: [301, 302, 307],
      },
      authorization_policies: {
        type: 'array',
        description: 'List of authorization policy names that must pass before rendering.',
      },
      response_headers: {
        type: 'string',
        description: 'Liquid template that renders a JSON object of HTTP response headers.',
      },
      metadata: {
        type: 'object',
        description: 'Arbitrary metadata object (e.g. SEO title/description, robots directives).',
      },
      max_deep_level: {
        type: 'integer',
        description: 'Maximum number of dynamic URL segments to capture.',
      },
      searchable: {
        type: 'boolean',
        description: 'Whether this page is included in platformOS search indexes.',
      },
      format: {
        type: 'string',
        description: 'Response format (html, json, xml, csv, …). Often encoded in the filename.',
      },
      default_layout: {
        type: 'boolean',
        description: 'Use the instance default layout.',
      },
      handler: {
        type: 'string',
        description: 'Template handler type.',
      },
      converter: {
        type: 'string',
        description: 'Content converter, e.g. `markdown`.',
      },
      dynamic_cache: {
        type: 'object',
        description: 'Dynamic cache settings: { key, layout, expire }.',
      },
      static_cache: {
        type: 'object',
        description: 'Static cache settings: { expire }.',
      },
      cache_for: {
        type: 'integer',
        description: 'Static cache expiration in seconds.',
      },
      subdomain: {
        type: 'string',
        description: 'Subdomain routing.',
      },
      require_verified_user: {
        type: 'boolean',
      },
      admin_page: {
        type: 'boolean',
      },
      enable_profiler: {
        type: 'boolean',
      },
      metadata_title: {
        type: 'string',
        description: 'SEO <title> shorthand (alias for metadata.title).',
      },
      metadata_meta_description: {
        type: 'string',
        description: 'SEO meta description shorthand (alias for metadata.meta_description).',
      },
      metadata_canonical_url: {
        type: 'string',
        description: 'Canonical URL shorthand (alias for metadata.canonical_url).',
      },
    },
    allowAdditionalFields: false,
  },

  // ── Layout ───────────────────────────────────────────────────────────────────
  [PlatformOSFileType.Layout]: {
    name: 'Layout',
    fields: {
      name: {
        type: 'string',
        description: 'Identifier used to reference this layout from pages.',
      },
      converter: {
        type: 'string',
        description: 'Content converter, e.g. `markdown`.',
      },
      metadata: {
        type: 'object',
      },
    },
    allowAdditionalFields: false,
  },

  // ── Partial ──────────────────────────────────────────────────────────────────
  [PlatformOSFileType.Partial]: {
    name: 'Partial',
    fields: {
      metadata: {
        type: 'object',
        description:
          'Partial metadata. `metadata.params` declares accepted parameters; `metadata.name` is a human-readable label for the style guide.',
      },
      converter: {
        type: 'string',
        description: 'Content converter, e.g. `markdown`.',
      },
    },
    allowAdditionalFields: false,
  },

  // ── AuthorizationPolicy ──────────────────────────────────────────────────────
  [PlatformOSFileType.Authorization]: {
    name: 'AuthorizationPolicy',
    fields: {
      name: {
        type: 'string',
        required: true,
        description: 'Unique identifier for this authorization policy.',
      },
      redirect_to: {
        type: 'string',
        description: 'URL to redirect the user to when the policy fails.',
      },
      flash_alert: {
        type: 'string',
        description: 'Flash alert message shown after a failed authorization redirect.',
      },
      flash_notice: {
        type: 'string',
        description: 'Flash notice message shown after a failed authorization redirect.',
      },
      http_status: {
        type: 'integer',
        description: 'HTTP status code returned on policy failure.',
        enumValues: [403, 404],
      },
      metadata: {
        type: 'object',
      },
    },
    allowAdditionalFields: false,
  },

  // ── Email ────────────────────────────────────────────────────────────────────
  [PlatformOSFileType.Email]: {
    name: 'Email',
    fields: {
      name: {
        type: 'string',
        required: true,
        description: 'Unique identifier for this email notification.',
      },
      to: {
        type: 'string',
        required: true,
        description: 'Recipient email address (may use Liquid).',
      },
      from: {
        type: 'string',
        description: 'Sender email address.',
      },
      reply_to: {
        type: 'string',
        description: 'Reply-to email address.',
      },
      cc: {
        type: 'string',
        description: 'Carbon-copy recipients.',
      },
      bcc: {
        type: 'string',
        description: 'Blind carbon-copy recipients.',
      },
      subject: {
        type: 'string',
        required: true,
        description: 'Email subject line (may use Liquid).',
      },
      layout: {
        type: 'string',
        description: 'Layout partial to wrap the email body.',
      },
      layout_path: {
        type: 'string',
        description: 'Alias for layout.',
        deprecated: true,
        deprecatedMessage: 'Use `layout` instead of `layout_path`.',
      },
      delay: {
        type: 'integer',
        description: 'Seconds to delay delivery after being triggered.',
      },
      enabled: {
        type: 'boolean',
        description: 'When false, this email is never sent. Defaults to true.',
      },
      trigger_condition: {
        type: ['boolean', 'string'],
        description:
          'Liquid expression or boolean; email is only sent when this evaluates to true.',
      },
      locale: {
        type: 'string',
        description: 'Locale for the email.',
      },
      forced: {
        type: 'boolean',
      },
      attachments: {
        type: 'string',
      },
      metadata: {
        type: 'object',
      },
    },
    allowAdditionalFields: false,
  },

  // ── ApiCall ──────────────────────────────────────────────────────────────────
  [PlatformOSFileType.ApiCall]: {
    name: 'ApiCall',
    fields: {
      name: {
        type: 'string',
        required: true,
        description: 'Unique identifier for this API call notification.',
      },
      to: {
        type: 'string',
        required: true,
        description: 'Target URL for the HTTP request (may use Liquid).',
      },
      request_type: {
        type: 'string',
        required: true,
        description: 'HTTP method: GET, POST, PUT, PATCH, or DELETE.',
      },
      request_headers: {
        type: 'string',
        description: 'Liquid template rendering a JSON object of request headers.',
      },
      headers: {
        type: 'string',
        description: 'Alias for request_headers.',
        deprecated: true,
        deprecatedMessage: 'Use `request_headers` instead of `headers`.',
      },
      callback: {
        type: 'string',
        description: 'Liquid template executed after the HTTP response is received.',
      },
      delay: {
        type: 'integer',
        description: 'Seconds to delay the request after being triggered.',
      },
      enabled: {
        type: 'boolean',
        description: 'When false, this API call is never executed. Defaults to true.',
      },
      trigger_condition: {
        type: ['boolean', 'string'],
        description: 'Liquid expression or boolean; call is only made when this evaluates to true.',
      },
      format: {
        type: 'string',
        description: 'Request body encoding format (http, json, …).',
      },
      locale: {
        type: 'string',
      },
      metadata: {
        type: 'object',
      },
    },
    allowAdditionalFields: false,
  },

  // ── Sms ──────────────────────────────────────────────────────────────────────
  [PlatformOSFileType.Sms]: {
    name: 'SMS',
    fields: {
      name: {
        type: 'string',
        required: true,
        description: 'Unique identifier for this SMS notification.',
      },
      to: {
        type: 'string',
        required: true,
        description: 'Recipient phone number in E.164 format (may use Liquid).',
      },
      content: {
        type: 'string',
        required: true,
        description: 'SMS body (may use Liquid).',
      },
      delay: {
        type: 'integer',
        description: 'Seconds to delay sending after being triggered.',
      },
      enabled: {
        type: 'boolean',
        description: 'When false, this SMS is never sent. Defaults to true.',
      },
      trigger_condition: {
        type: ['boolean', 'string'],
        description: 'Liquid expression or boolean; SMS is only sent when this evaluates to true.',
      },
      locale: {
        type: 'string',
      },
      metadata: {
        type: 'object',
      },
    },
    allowAdditionalFields: false,
  },

  // ── Migration ────────────────────────────────────────────────────────────────
  [PlatformOSFileType.Migration]: {
    name: 'Migration',
    fields: {},
    allowAdditionalFields: true,
  },

  // ── FormConfiguration ────────────────────────────────────────────────────────
  [PlatformOSFileType.FormConfiguration]: {
    name: 'FormConfiguration',
    fields: {
      name: {
        type: 'string',
        required: true,
        description: 'Unique identifier for this form, used in include_form / function calls.',
      },
      resource: {
        type: ['string', 'object'],
        description: 'Model or resource type this form operates on.',
      },
      resource_owner: {
        type: 'string',
        description: 'Who owns the resource being created/updated.',
      },
      fields: {
        type: 'object',
        description: 'Field definitions — what data this form accepts and validates.',
      },
      configuration: {
        type: 'object',
        description: 'Alias for fields.',
      },
      redirect_to: {
        type: 'string',
        description: 'URL to redirect to after a successful form submission.',
      },
      return_to: {
        type: 'string',
        description: 'Alias for redirect_to.',
        deprecated: true,
        deprecatedMessage: 'Use `redirect_to` instead of `return_to`.',
      },
      flash_notice: {
        type: 'string',
        description: 'Flash notice message shown after a successful submission.',
      },
      flash_alert: {
        type: 'string',
        description: 'Flash alert message shown after a failed submission.',
      },
      spam_protection: {
        type: 'string',
        description: 'Spam protection mechanism to use.',
        enumValues: ['recaptcha', 'recaptcha_v2', 'recaptcha_v3', 'hcaptcha'],
      },
      request_allowed: {
        type: 'boolean',
        description: 'Whether the request is allowed. Default: true.',
      },
      live_reindex: {
        type: 'boolean',
      },
      default_payload: {
        type: ['string', 'object'],
      },
      callback_actions: {
        type: 'string',
        description: 'Liquid template with GraphQL mutations to run after submission.',
      },
      async_callback_actions: {
        type: 'object',
        description: 'Async callback settings: { content, delay, max_attempts, priority }.',
      },
      email_notifications: {
        type: 'array',
        description: 'Email notification names to trigger after successful form submission.',
      },
      sms_notifications: {
        type: 'array',
        description: 'SMS notification names to trigger after successful form submission.',
      },
      api_call_notifications: {
        type: 'array',
        description: 'API call notification names to trigger after successful form submission.',
      },
      response_headers: {
        type: ['string', 'object'],
      },
      metadata: {
        type: 'object',
      },
    },
    allowAdditionalFields: false,
  },
};

// ─── Lookup helper ────────────────────────────────────────────────────────────

/**
 * Returns the frontmatter schema for a given file type, or undefined if no
 * schema is defined for that type (e.g. GraphQL, YAML, Asset types).
 */
export function getFrontmatterSchema(
  fileType: PlatformOSFileType | undefined,
): FrontmatterSchema | undefined {
  if (fileType === undefined) return undefined;
  return FRONTMATTER_SCHEMAS[fileType];
}
