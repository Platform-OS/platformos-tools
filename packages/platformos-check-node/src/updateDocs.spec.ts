import { describe, it, expect, vi, afterEach } from 'vitest';
import { updateDocs } from './index';

vi.mock('@platformos/platformos-check-docs-updater', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    downloadPlatformOSLiquidDocs: vi.fn(),
  };
});

describe('Unit: updateDocs', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls downloadPlatformOSLiquidDocs with the cache root and provided log function', async () => {
    const { downloadPlatformOSLiquidDocs, root } =
      await import('@platformos/platformos-check-docs-updater');
    const log = vi.fn();

    await updateDocs(log);

    expect(vi.mocked(downloadPlatformOSLiquidDocs)).toHaveBeenCalledOnce();
    expect(vi.mocked(downloadPlatformOSLiquidDocs)).toHaveBeenCalledWith(root, log);
  });

  it('uses a no-op log by default', async () => {
    const { downloadPlatformOSLiquidDocs } =
      await import('@platformos/platformos-check-docs-updater');

    await updateDocs();

    expect(vi.mocked(downloadPlatformOSLiquidDocs)).toHaveBeenCalledOnce();
    expect(vi.mocked(downloadPlatformOSLiquidDocs)).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
    );
  });
});
