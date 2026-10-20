import { BadGatewayException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { RequestsService } from '../requests/requests.service';
import { LibraryDeletionService } from './library-deletion.service';

describe('LibraryDeletionService', () => {
  const destroyScenes = jest.fn();
  const removeSceneRequest = jest.fn();
  const deleteMany = jest.fn();
  const prisma = {
    integrationConfig: {
      findUnique: jest.fn().mockResolvedValue({
        enabled: true,
        status: 'CONFIGURED',
        baseUrl: 'http://stash.local',
        apiKey: 'k',
      }),
    },
    librarySceneIndex: { deleteMany },
  } as unknown as PrismaService;
  const service = new LibraryDeletionService(
    prisma,
    { destroyScenes } as unknown as StashAdapter,
    { removeSceneRequest } as unknown as RequestsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    destroyScenes.mockResolvedValue(undefined);
    deleteMany.mockResolvedValue({ count: 1 });
    removeSceneRequest.mockResolvedValue({
      removed: true,
      stashId: 'cat-1',
      whisparrMovieId: 7,
    });
  });

  it('deletes the files in Stash, takes it out of Whisparr, and out of the library at once', async () => {
    await expect(
      service.deleteScene({
        stashSceneIds: ['412'],
        catalogSceneId: 'cat-1',
        keepAway: true,
      }),
    ).resolves.toEqual({
      deletedStashSceneIds: ['412'],
      removedFromWhisparr: true,
    });

    expect(destroyScenes).toHaveBeenCalledWith(['412'], {
      baseUrl: 'http://stash.local',
      apiKey: 'k',
    });
    expect(removeSceneRequest).toHaveBeenCalledWith('cat-1', {
      deleteFiles: true,
      addImportExclusion: true,
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { stashSceneId: { in: ['412'] } },
    });
  });

  it('touches nothing else when Stash fails to delete', async () => {
    destroyScenes.mockRejectedValue(new Error('permission denied'));

    await expect(
      service.deleteScene({ stashSceneIds: ['412'], catalogSceneId: 'cat-1' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(removeSceneRequest).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('is still deleted when Whisparr is not set up', async () => {
    removeSceneRequest.mockRejectedValue(
      new Error('WHISPARR integration is not configured.'),
    );

    await expect(
      service.deleteScene({ stashSceneIds: ['412'], catalogSceneId: 'cat-1' }),
    ).resolves.toEqual({
      deletedStashSceneIds: ['412'],
      removedFromWhisparr: false,
    });
  });
});
