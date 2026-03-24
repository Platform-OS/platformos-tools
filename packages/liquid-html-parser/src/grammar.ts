import { grammars, Grammar } from 'ohm-js';

const grammarSource: string = (() => {
  const raw = require('../grammar/liquid-html.ohm.js');
  return typeof raw === 'string' ? raw : raw.default;
})();

export const liquidHtmlGrammars = grammars(grammarSource);

export const TextNodeGrammar = liquidHtmlGrammars['Helpers'];
export const LiquidDocGrammar = liquidHtmlGrammars['LiquidDoc'];

export interface LiquidGrammars {
  Liquid: Grammar;
  LiquidHTML: Grammar;
  LiquidStatement: Grammar;
}

export const strictGrammars: LiquidGrammars = {
  Liquid: liquidHtmlGrammars['StrictLiquid'],
  LiquidHTML: liquidHtmlGrammars['StrictLiquidHTML'],
  LiquidStatement: liquidHtmlGrammars['StrictLiquidStatement'],
};

export const tolerantGrammars: LiquidGrammars = {
  Liquid: liquidHtmlGrammars['Liquid'],
  LiquidHTML: liquidHtmlGrammars['LiquidHTML'],
  LiquidStatement: liquidHtmlGrammars['LiquidStatement'],
};

export const placeholderGrammars: LiquidGrammars = {
  Liquid: liquidHtmlGrammars['WithPlaceholderLiquid'],
  LiquidHTML: liquidHtmlGrammars['WithPlaceholderLiquidHTML'],
  LiquidStatement: liquidHtmlGrammars['WithPlaceholderLiquidStatement'],
};

// see ../../grammar/liquid-html.ohm for full list
export const BLOCKS = (strictGrammars.LiquidHTML.rules as any).blockName.body.factors[0].terms.map(
  (x: any) => x.obj,
) as string[];

// see ../../grammar/liquid-html.ohm for full list
export const RAW_TAGS = (() => {
  const rule = (strictGrammars.LiquidHTML.rules as any).liquidRawTag;
  // When there's only one alternative, body is the Apply node directly (no .terms)
  const terms = rule.body.terms ? rule.body.terms : [rule.body];
  return terms.map((term: any) => term.args[0].obj).concat('comment') as string[];
})();

// see ../../grammar/liquid-html.ohm for full list
export const VOID_ELEMENTS = (
  strictGrammars.LiquidHTML.rules as any
).voidElementName.body.factors[0].terms.map((x: any) => x.args[0].obj) as string[];

export const TAGS_WITHOUT_MARKUP = ['else', 'break', 'continue', 'comment', 'raw', 'doc', 'try'];
