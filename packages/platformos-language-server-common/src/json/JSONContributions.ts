import {
  CompletionsCollector,
  JSONPath,
  JSONWorkerContribution,
  MarkedString,
} from 'vscode-json-languageservice';
import { AugmentedSourceCode, DocumentManager } from '../documents';
import { JSONCompletionProvider } from './completions/JSONCompletionProvider';
import { JSONHoverProvider } from './hover/JSONHoverProvider';
import { TranslationPathHoverProvider } from './hover/providers/TranslationPathHoverProvider';
import { RequestContext } from './RequestContext';

/** The getInfoContribution API will only fallback if we return undefined synchronously */
const SKIP_CONTRIBUTION = undefined as any;

/**
 * I'm not a fan of how json-languageservice does its feature contributions. It's too different
 * from everything else we do in here.
 *
 * Instead, we'll have this little adapter that makes the completions and hover providers feel
 * a bit more familiar.
 */
export class JSONContributions implements JSONWorkerContribution {
  private hoverProviders: JSONHoverProvider[];
  private completionProviders: JSONCompletionProvider[];

  constructor(private documentManager: DocumentManager) {
    this.hoverProviders = [new TranslationPathHoverProvider()];
    this.completionProviders = [];
  }

  async getInfoContribution(uri: string, location: JSONPath): Promise<MarkedString[]> {
    const doc = this.documentManager.get(uri);
    if (!doc) return SKIP_CONTRIBUTION;
    const context = await this.getContext(doc);
    const provider = this.hoverProviders.find((p) => p.canHover(context, location));
    if (!provider) return SKIP_CONTRIBUTION;
    return provider.hover(context, location);
  }

  async collectPropertyCompletions(
    uri: string,
    location: JSONPath,
    // Don't know what those three are for.
    _currentWord: string,
    _addValue: boolean,
    _isLast: boolean,
    result: CompletionsCollector,
  ): Promise<void> {
    const doc = this.documentManager.get(uri);
    if (!doc || doc.ast instanceof Error) return;

    const providers = this.completionProviders.filter((provider) => provider.completeProperty);
    const data = [];
    for (const provider of providers) {
      data.push(await provider.completeProperty!(await this.getContext(doc), location));
    }
    const items = await Promise.all(data);

    for (const item of items.flat()) {
      result.add(item);
    }
  }

  async collectValueCompletions(
    uri: string,
    location: JSONPath,
    propertyKey: string,
    result: CompletionsCollector,
  ): Promise<void> {
    const doc = this.documentManager.get(uri);
    if (!doc || doc.ast instanceof Error) return;
    const providers = this.completionProviders.filter((provider) => provider.completeValue);
    const data = [];
    for (const provider of providers) {
      data.push(
        await provider.completeValue!(await this.getContext(doc), location.concat(propertyKey)),
      );
    }
    const items = await Promise.all(data);

    for (const item of items.flat()) {
      result.add(item);
    }
  }

  /** I'm not sure we want to do anything with that... but TS requires us to have it */
  async collectDefaultCompletions(_uri: string, _result: CompletionsCollector): Promise<void> {}

  private async getContext(doc: AugmentedSourceCode): Promise<RequestContext> {
    return { doc };
  }
}
