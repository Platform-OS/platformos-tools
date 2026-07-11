/**
 * Shared input for the request-path I/O adapters (`lint/`, `impact/`).
 *
 * Both adapters receive the identical `{ projectDir, filePath, content }` and
 * must agree on the buffer's absolute path, so the shape and the
 * absolute-path resolution live here rather than being duplicated per adapter.
 */
import { isAbsolute, join } from 'node:path';

export interface AdapterInput {
  /** Absolute project root the buffer is validated against. */
  projectDir: string;
  /** File under edit — absolute, or relative to `projectDir`. */
  filePath: string;
  /** In-memory buffer contents. */
  content: string;
}

/**
 * Resolve the file under edit to an absolute path: returned as-is when already
 * absolute, else joined onto the project root.
 */
export function toAbsoluteFilePath(projectDir: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : join(projectDir, filePath);
}
