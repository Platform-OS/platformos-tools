import { describe, it, expect, beforeEach } from 'vitest';
import { getContentTriggers, _resetKnowledge } from './knowledge-loader';

beforeEach(() => {
  _resetKnowledge();
});

// ── Content trigger matching ──────────────────────────────────────────────────

describe('content-triggers: pattern matching', () => {
  it('triggers session_security when context.session is used', () => {
    const triggers = getContentTriggers('{% assign x = context.session.cart %}', 'pages');
    expect(triggers.some((t) => t.id === 'session_security')).toBe(true);
    expect(triggers.find((t) => t.id === 'session_security')?.severity).toBe('security');
  });

  it('triggers form_csrf when <form> tag is present', () => {
    const triggers = getContentTriggers('<form action="/submit" method="post">', 'partials');
    expect(triggers.some((t) => t.id === 'form_csrf')).toBe(true);
  });

  it('triggers raw_filter_xss when | raw is used', () => {
    const triggers = getContentTriggers('{{ user_input | raw }}', 'partials');
    expect(triggers.some((t) => t.id === 'raw_filter_xss')).toBe(true);
    expect(triggers.find((t) => t.id === 'raw_filter_xss')?.severity).toBe('security');
  });

  it('triggers cache_patterns when {% cache %} is used', () => {
    const triggers = getContentTriggers('{% cache "products_list", expire: 3600 %}', 'pages');
    expect(triggers.some((t) => t.id === 'cache_patterns')).toBe(true);
  });

  it('triggers redirect_patterns when redirect_to is used', () => {
    const triggers = getContentTriggers('{% redirect_to "/login" %}', 'pages');
    expect(triggers.some((t) => t.id === 'redirect_patterns')).toBe(true);
  });

  it('triggers asset_url_pipeline when | asset_url is used', () => {
    const triggers = getContentTriggers('{{ "styles.css" | asset_url }}', 'layouts');
    expect(triggers.some((t) => t.id === 'asset_url_pipeline')).toBe(true);
  });

  it('triggers background_job when {% background %} is used', () => {
    const triggers = getContentTriggers('{% background source_name: "email" %}', 'pages');
    expect(triggers.some((t) => t.id === 'background_job')).toBe(true);
  });

  it('triggers log_tag when {% log %} is used', () => {
    const triggers = getContentTriggers('{% log "debug info", type: "info" %}', 'commands');
    expect(triggers.some((t) => t.id === 'log_tag')).toBe(true);
  });

  it('triggers content_for_slots when {% content_for %} is used', () => {
    const triggers = getContentTriggers(
      '{% content_for "title" %}My Page{% endcontent_for %}',
      'pages',
    );
    expect(triggers.some((t) => t.id === 'content_for_slots')).toBe(true);
  });

  it('triggers json_response when | json is used in a page', () => {
    const triggers = getContentTriggers('{{ result | json }}', 'pages');
    expect(triggers.some((t) => t.id === 'json_response')).toBe(true);
  });

  it('triggers api_call_tag when {% api_call %} is used', () => {
    const triggers = getContentTriggers(
      "{% api_call result, url: 'https://example.com/api' %}",
      'pages',
    );
    expect(triggers.some((t) => t.id === 'api_call_tag')).toBe(true);
  });
});

// ── Domain filtering ──────────────────────────────────────────────────────────

describe('content-triggers: domain filtering', () => {
  it('does not trigger content_for_slots in partials', () => {
    const triggers = getContentTriggers(
      '{% content_for "title" %}...{% endcontent_for %}',
      'partials',
    );
    expect(triggers.some((t) => t.id === 'content_for_slots')).toBe(false);
  });

  it('does not trigger json_response in partials', () => {
    const triggers = getContentTriggers('{{ result | json }}', 'partials');
    expect(triggers.some((t) => t.id === 'json_response')).toBe(false);
  });

  it('triggers session_security in commands', () => {
    const triggers = getContentTriggers('{% assign x = context.session %}', 'commands');
    expect(triggers.some((t) => t.id === 'session_security')).toBe(true);
  });

  it('does not trigger session_security in graphql domain', () => {
    const triggers = getContentTriggers('context.session', 'graphql');
    expect(triggers.some((t) => t.id === 'session_security')).toBe(false);
  });

  it('triggers log_tag in queries', () => {
    const triggers = getContentTriggers('{% log "query debug" %}', 'queries');
    expect(triggers.some((t) => t.id === 'log_tag')).toBe(true);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('content-triggers: edge cases', () => {
  it('returns empty for empty content', () => {
    const triggers = getContentTriggers('', 'pages');
    expect(triggers).toHaveLength(0);
  });

  it('returns empty for null content', () => {
    // The public signature accepts `string`; pass null via cast to exercise
    // the runtime guard documented in `knowledge-loader.ts`.
    const triggers = getContentTriggers(null as unknown as string, 'pages');
    expect(triggers).toHaveLength(0);
  });

  it('returns empty for null domain', () => {
    const triggers = getContentTriggers('some content', null as unknown as string);
    expect(triggers).toHaveLength(0);
  });

  it('can return multiple triggers for rich content', () => {
    const content = `
      {% assign cart = context.session.cart %}
      <form action="/checkout" method="post">
        {{ cart | json }}
        {% cache "cart_display", expire: 60 %}
          {{ user_comment | raw }}
        {% endcache %}
      </form>
    `;
    const triggers = getContentTriggers(content, 'pages');
    // Should match: session_security, form_csrf, json_response, cache_patterns, raw_filter_xss
    expect(triggers.length).toBeGreaterThanOrEqual(4);
  });

  it('all triggers have required fields', () => {
    const content =
      '{% assign x = context.session %}\n{{ x | raw }}\n{% cache "k" %}{% endcache %}';
    const triggers = getContentTriggers(content, 'pages');
    for (const t of triggers) {
      expect(t.id).toBeTruthy();
      expect(t.message).toBeTruthy();
      expect(t.severity).toBeTruthy();
    }
  });
});
