import { BasicParamTypes } from '@platformos/platformos-check-common';

export type TagType = 'function' | 'render' | 'include';

export interface ArgumentInfo {
  name: string;
  inferredType: BasicParamTypes;
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
