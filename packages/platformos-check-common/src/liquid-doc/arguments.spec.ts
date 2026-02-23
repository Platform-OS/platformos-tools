import { describe, expect, it } from 'vitest';
import { applyFixToString, createCorrector } from '../fixes';
import { makeAddArgumentCorrector, makeRemoveArgumentCorrector } from './arguments';
import { DocumentNode, LiquidTag, RenderMarkup } from '@platformos/liquid-html-parser';
import { SourceCodeType, toLiquidHTMLAST } from '..';

describe('Arguments', () => {
  describe('makeAddArgumentCorrector', () => {
    const requiredParam = {
      name: 'required_string',
      type: 'string',
      description: null,
      required: true,
      nodeType: 'param' as 'param',
    };

    it('should suggest adding missing required arguments when none already exist', () => {
      const node = makeRenderMarkup(`{% render 'partial', some-arg: '' %}`);

      const fixer = createCorrector(SourceCodeType.LiquidHtml, node.source);

      makeAddArgumentCorrector(node, requiredParam)(fixer);

      expect(applyFixToString(node.source, fixer.fix)).toBe(
        `{% render 'partial', some-arg: '', required_string: '' %}`,
      );
    });

    it('should suggest adding missing required arguments and correcting trailing comma + whitespace', () => {
      const node = makeRenderMarkup(`{% render 'partial', some-arg: '',    %}`);

      const fixer = createCorrector(SourceCodeType.LiquidHtml, node.source);

      makeAddArgumentCorrector(node, requiredParam)(fixer);

      expect(applyFixToString(node.source, fixer.fix)).toBe(
        `{% render 'partial', some-arg: '', required_string: '' %}`,
      );
    });

    it('should suggest adding missing required arguments and correcting trailing spaces + comma', () => {
      const node = makeRenderMarkup(`{% render 'partial', some-arg: ''    ,    %}`);

      const fixer = createCorrector(SourceCodeType.LiquidHtml, node.source);

      makeAddArgumentCorrector(node, requiredParam)(fixer);

      expect(applyFixToString(node.source, fixer.fix)).toBe(
        `{% render 'partial', some-arg: '', required_string: '' %}`,
      );
    });
  });

  describe('makeRemoveArgumentCorrector', () => {
    it("should remove the last argument and it's leading comma", () => {
      const node = makeRenderMarkup(`{% render 'partial', id: 'fake', some-arg: '' %}`);

      const argToRemove = node.args.at(-1)!;

      const fixer = createCorrector(SourceCodeType.LiquidHtml, node.source);

      makeRemoveArgumentCorrector(node, argToRemove)(fixer);

      expect(applyFixToString(node.source, fixer.fix)).toBe(`{% render 'partial', id: 'fake' %}`);
    });

    it('should remove an argument in the middle', () => {
      const node = makeRenderMarkup(`{% render 'partial', id: 'fake', some-arg: '' %}`);

      const argToRemove = node.args.at(-2)!;

      const fixer = createCorrector(SourceCodeType.LiquidHtml, node.source);

      makeRemoveArgumentCorrector(node, argToRemove)(fixer);

      expect(applyFixToString(node.source, fixer.fix)).toBe(`{% render 'partial', some-arg: '' %}`);
    });

    it('should remove an argument with trailing comma', () => {
      const node = makeRenderMarkup(`{% render 'partial', id: 'fake', some-arg: '', %}`);

      const argToRemove = node.args.at(-1)!;

      const fixer = createCorrector(SourceCodeType.LiquidHtml, node.source);

      makeRemoveArgumentCorrector(node, argToRemove)(fixer);

      expect(applyFixToString(node.source, fixer.fix)).toBe(`{% render 'partial', id: 'fake' %}`);
    });
  });

  it('should remove an argument with trailing space', () => {
    const node = makeRenderMarkup(`{% render 'partial', id: 'fake'     , some-arg: '' %}`);

    const argToRemove = node.args.at(-2)!;

    const fixer = createCorrector(SourceCodeType.LiquidHtml, node.source);

    makeRemoveArgumentCorrector(node, argToRemove)(fixer);

    expect(applyFixToString(node.source, fixer.fix)).toBe(`{% render 'partial', some-arg: '' %}`);
  });

  it('should remove an argument with leading space', () => {
    const node = makeRenderMarkup(`{% render 'partial', id: 'fake',    some-arg: '' %}`);

    const argToRemove = node.args.at(-1)!;

    const fixer = createCorrector(SourceCodeType.LiquidHtml, node.source);

    makeRemoveArgumentCorrector(node, argToRemove)(fixer);

    expect(applyFixToString(node.source, fixer.fix)).toBe(`{% render 'partial', id: 'fake' %}`);
  });
});

function makeRenderMarkup(source: string): RenderMarkup {
  const ast = toLiquidHTMLAST(source) as DocumentNode;
  return (ast.children[0] as LiquidTag).markup as RenderMarkup;
}
