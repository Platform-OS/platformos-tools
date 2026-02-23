import { Corrector, SourceCodeType } from '../../types';
import { JSONCorrector } from './json-corrector';
import { StringCorrector } from './string-corrector';
import { GraphQLCorrector } from './graphql-corrector';

export { JSONCorrector, StringCorrector, GraphQLCorrector };

export function createCorrector<S extends SourceCodeType>(
  sourceCodeType: S,
  source: string,
): Corrector<S> {
  switch (sourceCodeType) {
    case SourceCodeType.JSON: {
      return new JSONCorrector(source) as Corrector<typeof sourceCodeType>;
    }
    case SourceCodeType.LiquidHtml: {
      return new StringCorrector(source) as Corrector<typeof sourceCodeType>;
    }
    case SourceCodeType.GraphQL:
      return new GraphQLCorrector(source) as Corrector<typeof sourceCodeType>;
    case SourceCodeType.YAML: {
      // YAML autofix is not yet supported; this case should not be reached
      throw new Error('YAML autofix is not supported');
    }
    default: {
      return assertNever(sourceCodeType);
    }
  }
}

function assertNever(x: never): never {
  throw new Error(`Case statement not exhausted: ${x}`);
}
