import { LiquidType } from '@platformos/platformos-check-common';

export type TagType = 'function' | 'render' | 'include';

export interface ArgumentInfo {
  name: string;
  /**
   * DECLARABLE, not merely inferred. This ends up inside a `{% doc %}` block in the user's file,
   * so it may only be a type `@param` accepts — see `declarableParamType`.
   */
  inferredType: LiquidType;
  usageCount: number;
}

export interface PartialUsage {
  partialPath: string;
  tagType: TagType;
  arguments: Map<string, ArgumentInfo>;
}

export interface BackfillOptions {
  rootPath: string;
  dryRun?: boolean;
  markRequired?: boolean;
  verbose?: boolean;
}

export interface BackfillResult {
  modified: string[];
  skipped: string[];
  errors: Array<{ file: string; error: string }>;
}

export interface ExistingParam {
  name: string;
  type: string | null;
  description: string | null;
  required: boolean;
}
