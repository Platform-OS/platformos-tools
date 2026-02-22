import {
  Config,
  Dependencies as CheckDependencies,
} from '@platformos/platformos-check-common';
import { AbstractFileSystem } from '@platformos/platformos-common';
import { URI } from 'vscode-languageserver';
import * as rpc from 'vscode-jsonrpc';

import { WithOptional } from './utils';
import { Range } from 'vscode-json-languageservice';
import { Reference } from '@platformos/platformos-graph';

export type Dependencies = WithOptional<RequiredDependencies, 'log'>;

export interface RequiredDependencies {
  /**
   * A basic logging function.
   *
   * You might want console.log in development, and bugsnag in production.
   */
  log(message: string): void;

  /**
   * loadConfig(uri)
   *
   * In local environments, it's possible for one Language Server to deal
   * with a workspace that contains many different configurations. In the
   * browser, it isn't.
   *
   * loadConfig is the runtime-agnostic solution.
   *
   * @example
   *
   * Here's an example VS Code workspace a developer could run
   * ```
   * my-app/
   *   .pos
   *   app/
   *     views/
   *       layouts/
   *       pages/
   *       partials/
   *     lib/
   *     assets/
   * another-app/
   *   .pos
   *   app/
   *     views/
   *       pages/
   * ```
   *
   * In this situation, we have 2 different "roots."
   *
   * @param uri - a file path
   * @returns {Promise<Config>}
   */
  loadConfig(uri: URI, fs: AbstractFileSystem): Promise<Config>;

  /**
   * In local environments, the Language Server can download the latest versions
   * of the platformOS Liquid docset. In the browser, the docset must be
   * precompiled into the bundle at build time.
   */
  platformosDocset: NonNullable<CheckDependencies['platformosDocset']>;

  /**
   * In local environments, the Language Server can download the latest JSON
   * validation schemas. In browser environments, schemas must be precompiled
   * into validators prior to platformos-check instantiation.
   */
  jsonValidationSet: NonNullable<CheckDependencies['jsonValidationSet']>;

  /**
   * A file system abstraction that allows the Language Server to read files by URI.
   *
   * In Node.js, this is a wrapper around node:fs/promises.
   *
   * In VS Code, this is a wrapper around the VS Code API.
   *
   * The browser accepts a custom implementation.
   */
  fs: AbstractFileSystem;

}

export namespace AppGraphReferenceRequest {
  export const method = 'appGraph/references';
  export const type = new rpc.RequestType<Params, Response, void>(method);
  export interface Params {
    uri: string;
    offset?: number;
    includeIndirect?: boolean;
  }
  export type Response = AugmentedReference[];
}

export namespace AppGraphDependenciesRequest {
  export const method = 'appGraph/dependencies';
  export const type = new rpc.RequestType<Params, Response, void>(method);
  export interface Params {
    uri: string;
    offset?: number;
    includeIndirect?: boolean;
  }
  export type Response = AugmentedReference[];
}

export namespace AppGraphRootRequest {
  export const method = 'appGraph/rootUri';
  export const type = new rpc.RequestType<Params, Response, void>(method);
  export interface Params {
    uri: string;
  }
  export type Response = string;
}

export namespace AppGraphDidUpdateNotification {
  export const method = 'appGraph/onDidChangeTree';
  export const type = new rpc.NotificationType<Params>(method);
  export interface Params {
    uri: string;
  }
}

export type AugmentedLocationWithExistence = {
  uri: string;
  range: undefined;
  excerpt: undefined;
  position: undefined;
  exists: boolean;
};

export type AugmentedLocationWithExcerpt = {
  uri: string;
  range: [number, number];
  excerpt: string;
  position: Range;
  exists: boolean;
};

export type AugmentedLocation = AugmentedLocationWithExistence | AugmentedLocationWithExcerpt;

export interface AugmentedReference extends Reference {
  source: AugmentedLocation;
  target: AugmentedLocation;
  indirect: boolean;
}
