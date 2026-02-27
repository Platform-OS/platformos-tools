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

import { PlatformOSFileType } from '@platformos/platformos-common';

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
 * Field lists are based on real-world usage in platformOS apps. Set
 * `allowAdditionalFields: true` (the default) everywhere so that apps using
 * custom/undocumented keys don't get false-positive warnings until the schemas
 * are finalised.
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
        description: 'HTTP method this page responds to (get, post, put, patch, delete).',
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
    },
    allowAdditionalFields: true,
  },

  // ── Layout ───────────────────────────────────────────────────────────────────
  [PlatformOSFileType.Layout]: {
    name: 'Layout',
    fields: {
      name: {
        type: 'string',
        description: 'Identifier used to reference this layout from pages.',
      },
    },
    allowAdditionalFields: true,
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
    },
    allowAdditionalFields: true,
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
    },
    allowAdditionalFields: true,
  },

  // ── Email ────────────────────────────────────────────────────────────────────
  [PlatformOSFileType.Email]: {
    name: 'Email',
    fields: {
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
      layout_path: {
        type: 'string',
        description: 'Layout partial to wrap the email body.',
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
    },
    allowAdditionalFields: true,
  },

  // ── ApiCall ──────────────────────────────────────────────────────────────────
  [PlatformOSFileType.ApiCall]: {
    name: 'ApiCall',
    fields: {
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
    },
    allowAdditionalFields: true,
  },

  // ── Sms ──────────────────────────────────────────────────────────────────────
  [PlatformOSFileType.Sms]: {
    name: 'SMS',
    fields: {
      to: {
        type: 'string',
        required: true,
        description: 'Recipient phone number in E.164 format (may use Liquid).',
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
    },
    allowAdditionalFields: true,
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
      redirect_to: {
        type: 'string',
        description: 'URL to redirect to after a successful form submission.',
      },
      flash_notice: {
        type: 'string',
        description: 'Flash notice message shown after a successful submission.',
      },
      flash_alert: {
        type: 'string',
        description: 'Flash alert message shown after a failed submission.',
      },
    },
    allowAdditionalFields: true,
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
