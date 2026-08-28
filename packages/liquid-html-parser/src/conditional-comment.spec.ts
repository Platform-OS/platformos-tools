import { describe, expect, it } from 'vitest';
import { getConditionalComment } from './conditional-comment';

/**
 * The subject is always the WHOLE source of an `HtmlComment` node, and the printer
 * regenerates that comment from the three pieces returned here — so anything outside them
 * is deleted from the author's file. That makes the start anchor part of the contract and
 * not a detail: an unanchored `<!--\[if` found the marker mid-comment and silently dropped
 * everything before it.
 */
describe('Unit: getConditionalComment', () => {
  it('splits a downlevel-hidden conditional comment into its three pieces', () => {
    expect(getConditionalComment('<!--[if IE 9]> <p>old</p> <![endif]-->')).toEqual({
      startTag: '<!--[if IE 9]>',
      body: '<p>old</p>',
      endTag: '<![endif]-->',
    });
  });

  it('keeps a multi-line body whole', () => {
    expect(
      getConditionalComment('<!--[if lt IE 9]>\n  <p>a</p>\n  <p>b</p>\n<![endif]-->'),
    ).toEqual({
      startTag: '<!--[if lt IE 9]>',
      body: '<p>a</p>\n  <p>b</p>',
      endTag: '<![endif]-->',
    });
  });

  it('does not claim a comment whose conditional marker is not at the start', () => {
    // Claiming it would hand the printer three pieces that do not add up to the source,
    // and `<!-- a note ` would not survive the next format.
    expect(getConditionalComment('<!-- a note <!--[if IE]> <p>x</p> <![endif]-->')).toBe(undefined);
  });

  it('does not claim an ordinary comment', () => {
    expect(getConditionalComment('<!-- just a comment -->')).toBe(undefined);
  });

  it('does not claim a start tag with no end tag', () => {
    expect(getConditionalComment('<!--[if IE]> <p>x</p> -->')).toBe(undefined);
  });
});
