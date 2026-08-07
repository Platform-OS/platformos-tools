import { Context, SourceCodeType, Schema, RelativePath } from '../types';

export async function doesFileExist<T extends SourceCodeType, S extends Schema>(
  context: Context<T, S>,
  relativePath: RelativePath,
): Promise<boolean> {
  const uri = context.toUri(relativePath);
  return await context.fileExists(uri);
}
