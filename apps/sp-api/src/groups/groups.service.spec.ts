import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IntegrationStatus } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { LibrarySceneQueryService } from '../library/library-scene-query.service';
import { GroupsService } from './groups.service';
import {
  StashGroupRecord,
  StashGroupSceneRecord,
  StashGroupsClient,
} from './stash-groups.client';

function scene(
  id: string,
  groups: Array<[groupId: string, sceneIndex: number | null]>,
  overrides: Partial<StashGroupSceneRecord> = {},
): StashGroupSceneRecord {
  return {
    id,
    title: `Scene ${id}`,
    files: [{ basename: `scene-${id}.mp4`, duration: 600.4 }],
    paths: { screenshot: `http://stash.local/scene/${id}/screenshot` },
    performers: [{ name: 'Performer One' }],
    groups: groups.map(([groupId, sceneIndex]) => ({
      group: { id: groupId },
      scene_index: sceneIndex,
    })),
    ...overrides,
  };
}

describe('GroupsService', () => {
  const client = {
    findGroups: jest.fn(),
    findGroup: jest.fn(),
    findSceneGroups: jest.fn(),
    createGroup: jest.fn(),
    updateGroup: jest.fn(),
    destroyGroup: jest.fn(),
    setSceneGroups: jest.fn(),
    resolveSceneViewUrl: jest.fn((_config, id: string) => `http://stash.local/scenes/${id}`),
    resolveGroupViewUrl: jest.fn((_config, id: string) => `http://stash.local/groups/${id}`),
  };
  const libraryQuery = { getScenesByIds: jest.fn() };
  const integrations = {
    findOne: jest.fn().mockResolvedValue({
      enabled: true,
      status: IntegrationStatus.CONFIGURED,
      baseUrl: 'http://stash.local',
      apiKey: 'key',
    }),
  };

  let service: GroupsService;
  let group: StashGroupRecord;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GroupsService(
      integrations as unknown as IntegrationsService,
      client as unknown as StashGroupsClient,
      libraryQuery as unknown as LibrarySceneQueryService,
    );
    // Parts out of order, one unnumbered; scene 12 is also in group 9.
    group = {
      id: '5',
      name: 'Trilogy',
      scene_count: 3,
      scenes: [
        scene('13', [['5', null]], { title: 'Bonus' }),
        scene('12', [['9', 4], ['5', 2]]),
        scene('11', [['5', 1]]),
      ],
    };
    client.findGroup.mockImplementation(async () => group);
    libraryQuery.getScenesByIds.mockResolvedValue([]);
  });

  it('lists the parts in order, unnumbered last, preferring library index data', async () => {
    libraryQuery.getScenesByIds.mockResolvedValue([
      { id: '12', title: 'Indexed Twelve', activeCatalogSceneId: 'catalog-12' },
    ]);

    const result = await service.getGroup('5');

    expect(result.scenes.map((item) => [item.id, item.sceneIndex])).toEqual([
      ['11', 1],
      ['12', 2],
      ['13', null],
    ]);
    expect(result.scenes[1]).toEqual(
      expect.objectContaining({ title: 'Indexed Twelve', activeCatalogSceneId: 'catalog-12' }),
    );
    expect(result.scenes[0]).toEqual(
      expect.objectContaining({
        title: 'Scene 11',
        duration: 600,
        imageUrl: '/api/media/stash/scenes/11/screenshot',
        viewUrl: 'http://stash.local/scenes/11',
        activeCatalogSceneId: null,
      }),
    );
    expect(result.coverImageUrl).toBe('/api/media/stash/groups/5/cover');
  });

  it('appends a scene as the last part, keeping its other groups', async () => {
    client.findSceneGroups.mockResolvedValue([{ group: { id: '9', name: 'Other' }, scene_index: 3 }]);

    await service.addScene('5', '20');

    expect(client.setSceneGroups).toHaveBeenCalledWith(expect.anything(), '20', [
      { groupId: '9', sceneIndex: 3 },
      { groupId: '5', sceneIndex: 3 },
    ]);
  });

  it('leaves a scene alone when it is already part of the series', async () => {
    client.findSceneGroups.mockResolvedValue([{ group: { id: '5' }, scene_index: 1 }]);

    await service.addScene('5', '11');

    expect(client.setSceneGroups).not.toHaveBeenCalled();
  });

  it('removes a scene from just this series', async () => {
    client.findSceneGroups.mockResolvedValue([
      { group: { id: '9' }, scene_index: 4 },
      { group: { id: '5' }, scene_index: 2 },
    ]);

    await service.removeScene('5', '12');

    expect(client.setSceneGroups).toHaveBeenCalledWith(expect.anything(), '12', [
      { groupId: '9', sceneIndex: 4 },
    ]);
  });

  it('renumbers parts 1..n in the new order, only rewriting scenes that moved', async () => {
    await service.reorderScenes('5', ['12', '11', '13']);

    expect(client.setSceneGroups.mock.calls.map(([, id, groups]) => [id, groups])).toEqual([
      ['12', [{ groupId: '9', sceneIndex: 4 }, { groupId: '5', sceneIndex: 1 }]],
      ['11', [{ groupId: '5', sceneIndex: 2 }]],
      ['13', [{ groupId: '5', sceneIndex: 3 }]],
    ]);
  });

  it("rejects a reorder that doesn't list exactly the series' scenes", async () => {
    await expect(service.reorderScenes('5', ['11', '12'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.reorderScenes('5', ['11', '12', '12'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.reorderScenes('5', ['11', '12', '99'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(client.setSceneGroups).not.toHaveBeenCalled();
  });

  it('creates a series with a first scene, checking the scene before creating anything', async () => {
    client.findSceneGroups.mockResolvedValueOnce(null);

    await expect(
      service.createGroup({ name: 'New', sceneId: '404' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(client.createGroup).not.toHaveBeenCalled();

    client.findSceneGroups.mockResolvedValue([]);
    client.createGroup.mockResolvedValue('5');
    await service.createGroup({ name: 'New', sceneId: '20' });

    expect(client.createGroup).toHaveBeenCalledWith(expect.anything(), { name: 'New' });
    expect(client.setSceneGroups).toHaveBeenCalledWith(expect.anything(), '20', [
      { groupId: '5', sceneIndex: 3 },
    ]);
  });

  it('rejects non-numeric ids before calling Stash', async () => {
    await expect(service.getGroup('abc')).rejects.toBeInstanceOf(BadRequestException);
    expect(client.findGroup).not.toHaveBeenCalled();
  });

  it('reports a missing series as not found', async () => {
    client.findGroup.mockResolvedValue(null);

    await expect(service.getGroup('77')).rejects.toBeInstanceOf(NotFoundException);
  });
});
