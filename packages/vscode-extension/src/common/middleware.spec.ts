import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockStat, MockDocumentLink } = vi.hoisted(() => {
  class MockDocumentLink {
    constructor(
      public range: any,
      public target?: any,
    ) {}
  }
  return { mockStat: vi.fn(), MockDocumentLink };
});

vi.mock('vscode', () => ({
  workspace: { fs: { stat: mockStat } },
}));

import { middleware } from './middleware';

const EXISTING_URI = { toString: () => 'file:///project/app/views/partials/exists.liquid' };
const MISSING_URI = { toString: () => 'file:///project/app/views/partials/missing.liquid' };

const fakeRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } };
const fakeDocument = {} as any;
const fakeToken = {} as any;

function makeLink(target: any) {
  return new MockDocumentLink(fakeRange, target) as any;
}

describe('provideDocumentLinks middleware', () => {
  const { provideDocumentLinks } = middleware;

  beforeEach(() => vi.clearAllMocks());

  it('returns null when next returns null', async () => {
    const next = vi.fn().mockResolvedValue(null);
    expect(await provideDocumentLinks!(fakeDocument, fakeToken, next)).to.equal(null);
  });

  it('returns links unchanged when all targets exist', async () => {
    mockStat.mockResolvedValue({});
    const link = makeLink(EXISTING_URI);
    const result = await provideDocumentLinks!(
      fakeDocument,
      fakeToken,
      vi.fn().mockResolvedValue([link]),
    );
    expect(result).to.deep.equal([link]);
  });

  it('removes link when target file is missing — ctrl+click falls through to go-to-definition', async () => {
    mockStat.mockRejectedValue(new Error('file not found'));
    const result = await provideDocumentLinks!(
      fakeDocument,
      fakeToken,
      vi.fn().mockResolvedValue([makeLink(MISSING_URI)]),
    );
    expect(result).to.deep.equal([]);
  });

  it('keeps existing links, removes missing ones', async () => {
    mockStat.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('not found'));
    const existingLink = makeLink(EXISTING_URI);
    const result = (await provideDocumentLinks!(
      fakeDocument,
      fakeToken,
      vi.fn().mockResolvedValue([existingLink, makeLink(MISSING_URI)]),
    )) as any[];
    expect(result).to.deep.equal([existingLink]);
  });

  it('passes through links with no target unchanged', async () => {
    const link = makeLink(undefined);
    const result = await provideDocumentLinks!(
      fakeDocument,
      fakeToken,
      vi.fn().mockResolvedValue([link]),
    );
    expect(result).to.deep.equal([link]);
    expect(mockStat).not.toHaveBeenCalled();
  });
});
