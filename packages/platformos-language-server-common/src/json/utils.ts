export function fileMatch(uri: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(uri));
}
