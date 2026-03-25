import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockShowTextDocument, mockStat, MockDocumentLink } = vi.hoisted(() => {
  class MockDocumentLink {
    constructor(
      public range: any,
      public target?: any,
    ) {}
  }
  return {
    mockShowTextDocument: vi.fn(),
    mockStat: vi.fn(),
    MockDocumentLink,
  };
});

vi.mock('vscode', () => ({
  DocumentLink: MockDocumentLink,
  Uri: {
    parse: (str: string) => ({ toString: () => str, _str: str }),
  },
  window: { showTextDocument: mockShowTextDocument },
  workspace: { fs: { stat: mockStat } },
}));

import { buildMiddleware, openFileMissingCommand } from './middleware';

const EXISTING_URI = { toString: () => 'file:///project/app/views/partials/exists.liquid' };
const MISSING_URI = { toString: () => 'file:///project/app/views/partials/missing.liquid' };

const fakeRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } };
const fakeDocument = {} as any;
const fakePosition = {} as any;
const fakeToken = {} as any;

function makeLink(target: any) {
  return new MockDocumentLink(fakeRange, target) as any;
}

describe('middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('openFileMissingCommand', () => {
    it('calls window.showTextDocument with a parsed URI', () => {
      openFileMissingCommand('file:///project/app/views/partials/new.liquid');
      expect(mockShowTextDocument).toHaveBeenCalledOnce();
      expect(mockShowTextDocument.mock.calls[0][0].toString()).to.equal(
        'file:///project/app/views/partials/new.liquid',
      );
    });
  });

  describe('provideDocumentLinks', () => {
    const { provideDocumentLinks } = buildMiddleware();

    it('returns null when next returns null', async () => {
      const next = vi.fn().mockResolvedValue(null);
      const result = await provideDocumentLinks!(fakeDocument, fakeToken, next);
      expect(result).to.equal(null);
    });

    it('returns links unchanged when all targets exist', async () => {
      mockStat.mockResolvedValue({});
      const link = makeLink(EXISTING_URI);
      const next = vi.fn().mockResolvedValue([link]);

      const result = await provideDocumentLinks!(fakeDocument, fakeToken, next);

      expect(result).to.deep.equal([link]);
      expect(mockStat).toHaveBeenCalledWith(EXISTING_URI);
    });

    it('replaces target with command URI when file is missing', async () => {
      mockStat.mockRejectedValue(new Error('file not found'));
      const link = makeLink(MISSING_URI);
      const next = vi.fn().mockResolvedValue([link]);

      const result = (await provideDocumentLinks!(fakeDocument, fakeToken, next)) as any[];

      expect(result).toHaveLength(1);
      const commandArg = encodeURIComponent(JSON.stringify([MISSING_URI.toString()]));
      expect(result[0].target.toString()).to.equal(
        `command:platformosLiquid.openFile?${commandArg}`,
      );
      expect(result[0].range).to.equal(fakeRange);
    });

    it('handles mixed links: existing unchanged, missing gets command URI', async () => {
      mockStat
        .mockResolvedValueOnce({}) // first link exists
        .mockRejectedValueOnce(new Error('not found')); // second link missing

      const existingLink = makeLink(EXISTING_URI);
      const missingLink = makeLink(MISSING_URI);
      const next = vi.fn().mockResolvedValue([existingLink, missingLink]);

      const result = (await provideDocumentLinks!(fakeDocument, fakeToken, next)) as any[];

      expect(result).toHaveLength(2);
      expect(result[0]).to.equal(existingLink);
      expect(result[1].target.toString()).to.include('command:platformosLiquid.openFile');
    });

    it('passes through links with no target unchanged', async () => {
      const link = makeLink(undefined);
      const next = vi.fn().mockResolvedValue([link]);

      const result = await provideDocumentLinks!(fakeDocument, fakeToken, next);

      expect(result).to.deep.equal([link]);
      expect(mockStat).not.toHaveBeenCalled();
    });
  });

  describe('provideDefinition', () => {
    const { provideDefinition } = buildMiddleware();

    it('returns null when next returns null', async () => {
      const next = vi.fn().mockResolvedValue(null);
      const result = await provideDefinition!(fakeDocument, fakePosition, fakeToken, next);
      expect(result).to.equal(null);
    });

    it('returns result unchanged when target file exists (Location shape)', async () => {
      mockStat.mockResolvedValue({});
      const location = { uri: EXISTING_URI };
      const next = vi.fn().mockResolvedValue(location);

      const result = await provideDefinition!(fakeDocument, fakePosition, fakeToken, next);

      expect(result).to.equal(location);
      expect(mockShowTextDocument).not.toHaveBeenCalled();
    });

    it('returns result unchanged when target file exists (LocationLink shape)', async () => {
      mockStat.mockResolvedValue({});
      const locationLink = {
        targetUri: EXISTING_URI,
        targetRange: fakeRange,
        originSelectionRange: fakeRange,
      };
      const next = vi.fn().mockResolvedValue([locationLink]);

      const result = await provideDefinition!(fakeDocument, fakePosition, fakeToken, next);

      expect(result).to.deep.equal([locationLink]);
      expect(mockShowTextDocument).not.toHaveBeenCalled();
    });

    it('opens missing file and returns null (Location shape)', async () => {
      mockStat.mockRejectedValue(new Error('not found'));
      const location = { uri: MISSING_URI };
      const next = vi.fn().mockResolvedValue(location);

      const result = await provideDefinition!(fakeDocument, fakePosition, fakeToken, next);

      expect(result).to.equal(null);
      expect(mockShowTextDocument).toHaveBeenCalledWith(MISSING_URI);
    });

    it('opens missing file and returns null (LocationLink shape)', async () => {
      mockStat.mockRejectedValue(new Error('not found'));
      const locationLink = { targetUri: MISSING_URI, targetRange: fakeRange };
      const next = vi.fn().mockResolvedValue([locationLink]);

      const result = await provideDefinition!(fakeDocument, fakePosition, fakeToken, next);

      expect(result).to.equal(null);
      expect(mockShowTextDocument).toHaveBeenCalledWith(MISSING_URI);
    });
  });
});
