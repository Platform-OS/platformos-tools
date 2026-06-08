/**
 * Suppression of upstream `ValidFrontmatter` rows that overlap with our
 * richer `pos-supervisor:InvalidLayout` / `pos-supervisor:InvalidFrontMatter`
 * structural checks (pos-cli 6.0.7 alignment, 2026-04-25).
 *
 * Line-anchored: YAML frontmatter is one key per line, so a line collision
 * is a reliable signal of the same root cause.
 */

import { describe, it, expect } from 'vitest';
import {
  suppressUpstreamFrontmatterDup,
  type PipelineDiagnostic,
  type PipelineResult,
} from './diagnostic-pipeline';

function makeResult(
  opts: {
    errors?: PipelineDiagnostic[];
    warnings?: PipelineDiagnostic[];
    infos?: PipelineDiagnostic[];
  } = {},
): PipelineResult {
  return {
    errors: [...(opts.errors ?? [])],
    warnings: [...(opts.warnings ?? [])],
    infos: [...(opts.infos ?? [])],
  };
}

describe('suppressUpstreamFrontmatterDup', () => {
  it('drops ValidFrontmatter when pos-supervisor:InvalidLayout shares its line', () => {
    const result = makeResult({
      warnings: [
        {
          check: 'ValidFrontmatter',
          severity: 'warning',
          message: "Layout 'nonexistent_layout_xyz' does not exist",
          line: 3,
        },
        {
          check: 'pos-supervisor:InvalidLayout',
          severity: 'warning',
          message: 'Layout `nonexistent_layout_xyz` not found. Expected file: …',
          line: 3,
        },
      ],
    });

    const removed = suppressUpstreamFrontmatterDup(result);

    expect(removed).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.check).toBe('pos-supervisor:InvalidLayout');
    expect(result.infos.some((i) => i.check === 'pos-supervisor:DuplicateFrontmatterCheck')).toBe(
      true,
    );
  });

  it('drops ValidFrontmatter when pos-supervisor:InvalidFrontMatter shares its line (error severity)', () => {
    const result = makeResult({
      errors: [
        {
          check: 'pos-supervisor:InvalidFrontMatter',
          severity: 'error',
          message: '`cache` is not a front matter option. Use `{% cache key, expire: 3600 %}`.',
          line: 3,
        },
      ],
      warnings: [
        {
          check: 'ValidFrontmatter',
          severity: 'warning',
          message: "Unknown frontmatter field 'cache' in Page file",
          line: 3,
        },
      ],
    });

    const removed = suppressUpstreamFrontmatterDup(result);

    expect(removed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('keeps ValidFrontmatter rows that do NOT overlap with our checks', () => {
    // Upstream catches deprecated `layout_name` — we don't have a structural
    // check for this, so the warning should survive untouched.
    const result = makeResult({
      warnings: [
        {
          check: 'ValidFrontmatter',
          severity: 'warning',
          message: "Use 'layout' instead of deprecated 'layout_name'",
          line: 4,
        },
        {
          check: 'pos-supervisor:InvalidLayout',
          severity: 'warning',
          message: 'Layout `application` not found.',
          line: 2,
        },
      ],
    });

    const removed = suppressUpstreamFrontmatterDup(result);

    expect(removed).toBe(0);
    expect(result.warnings).toHaveLength(2);
    expect(result.infos).toHaveLength(0);
  });

  it('is a no-op when no pos-supervisor structural check is present', () => {
    const result = makeResult({
      warnings: [
        {
          check: 'ValidFrontmatter',
          severity: 'warning',
          message: "Layout 'foo' does not exist",
          line: 3,
        },
      ],
    });

    expect(suppressUpstreamFrontmatterDup(result)).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.infos).toHaveLength(0);
  });

  it('is a no-op when no ValidFrontmatter row is present', () => {
    const result = makeResult({
      warnings: [
        {
          check: 'pos-supervisor:InvalidLayout',
          severity: 'warning',
          message: 'Layout `application` not found.',
          line: 3,
        },
      ],
    });

    expect(suppressUpstreamFrontmatterDup(result)).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.infos).toHaveLength(0);
  });

  it('idempotent — second call after dedup is a no-op', () => {
    const result = makeResult({
      warnings: [
        { check: 'ValidFrontmatter', severity: 'warning', message: 'x', line: 3 },
        { check: 'pos-supervisor:InvalidLayout', severity: 'warning', message: 'y', line: 3 },
      ],
    });

    expect(suppressUpstreamFrontmatterDup(result)).toBe(1);
    expect(suppressUpstreamFrontmatterDup(result)).toBe(0);
    expect(result.warnings).toHaveLength(1);
    // Only one info note was added — no duplicate from the second call.
    expect(
      result.infos.filter((i) => i.check === 'pos-supervisor:DuplicateFrontmatterCheck'),
    ).toHaveLength(1);
  });

  it('drops both ValidFrontmatter rows when multiple of our checks fire', () => {
    const result = makeResult({
      errors: [
        { check: 'pos-supervisor:InvalidFrontMatter', severity: 'error', message: 'a', line: 3 },
      ],
      warnings: [
        { check: 'pos-supervisor:InvalidLayout', severity: 'warning', message: 'b', line: 4 },
        { check: 'ValidFrontmatter', severity: 'warning', message: 'a-upstream', line: 3 },
        { check: 'ValidFrontmatter', severity: 'warning', message: 'b-upstream', line: 4 },
        { check: 'ValidFrontmatter', severity: 'warning', message: 'novel-upstream', line: 5 },
      ],
    });

    const removed = suppressUpstreamFrontmatterDup(result);

    expect(removed).toBe(2);
    // The line-5 ValidFrontmatter is novel and survives.
    expect(result.warnings.find((w) => w.check === 'ValidFrontmatter')?.line).toBe(5);
  });
});
