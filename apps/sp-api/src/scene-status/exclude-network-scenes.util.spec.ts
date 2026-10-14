import { SceneStatusDto } from './dto/scene-status.dto';
import { filterExcludedNetworkScenes } from './exclude-network-scenes.util';

describe('filterExcludedNetworkScenes', () => {
  const scenes = [
    { id: 'a', isFromExcludedNetwork: false },
    { id: 'b', isFromExcludedNetwork: true },
    { id: 'c', isFromExcludedNetwork: true },
  ];

  it('returns every scene unchanged when the setting is off', () => {
    const statuses = new Map<string, SceneStatusDto>();

    expect(filterExcludedNetworkScenes(scenes, statuses, false)).toEqual(scenes);
  });

  it('drops excluded-network scenes that are not already in the library', () => {
    const statuses = new Map<string, SceneStatusDto>([
      ['b', { state: 'NOT_REQUESTED' }],
      ['c', { state: 'AVAILABLE' }],
    ]);

    const result = filterExcludedNetworkScenes(scenes, statuses, true);

    expect(result.map((scene) => scene.id)).toEqual(['a', 'c']);
  });

  it('keeps a non-excluded-network scene even with no status entry', () => {
    const statuses = new Map<string, SceneStatusDto>();

    const result = filterExcludedNetworkScenes(scenes, statuses, true);

    expect(result.map((scene) => scene.id)).toEqual(['a']);
  });
});
