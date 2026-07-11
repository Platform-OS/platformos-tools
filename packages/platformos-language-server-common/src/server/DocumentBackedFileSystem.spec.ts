import { AbstractFileSystem, FileType } from '@platformos/platformos-common';
import { MockFileSystem } from '@platformos/platformos-check-common/src/test';
import { beforeEach, describe, expect, it } from 'vitest';
import { DocumentManager } from '../documents';
import { DocumentBackedFileSystem } from './DocumentBackedFileSystem';

describe('Module: DocumentBackedFileSystem', () => {
  const rootUri = 'mock-fs:';
  const fooUri = 'mock-fs:/app/views/partials/foo.liquid';
  const barUri = 'mock-fs:/app/views/partials/bar.liquid';
  let diskFs: AbstractFileSystem;
  let documentManager: DocumentManager;
  let fs: DocumentBackedFileSystem;

  beforeEach(() => {
    diskFs = new MockFileSystem(
      {
        'app/views/partials/foo.liquid': 'saved foo',
        'app/views/partials/bar.liquid': 'saved bar',
      },
      rootUri,
    );
    documentManager = new DocumentManager(diskFs);
    fs = new DocumentBackedFileSystem(diskFs, documentManager);
  });

  it('serves the in-editor buffer for a tracked document instead of the disk content', async () => {
    documentManager.open(fooUri, 'edited foo', 1);

    expect(await fs.readFile(fooUri)).to.equal('edited foo');
  });

  it('reflects later edits to a tracked document without any cache invalidation', async () => {
    documentManager.open(fooUri, 'edited foo', 1);
    documentManager.change(fooUri, 'edited foo again', 2);

    expect(await fs.readFile(fooUri)).to.equal('edited foo again');
  });

  it('falls back to the underlying filesystem for untracked documents', async () => {
    expect(await fs.readFile(barUri)).to.equal('saved bar');
  });

  it('delegates readDirectory to the underlying filesystem', async () => {
    expect(await fs.readDirectory('mock-fs:/app/views/partials')).to.deep.equal([
      ['mock-fs:/app/views/partials/foo.liquid', FileType.File],
      ['mock-fs:/app/views/partials/bar.liquid', FileType.File],
    ]);
  });

  it('delegates stat to the underlying filesystem', async () => {
    expect(await fs.stat(fooUri)).to.deep.equal({ type: FileType.File, size: 'saved foo'.length });
  });
});
