import { SceneStatusDto } from './dto/scene-status.dto';

/**
 * When hideAmateurNetworkResults is on, drops scenes from a known
 * amateur/creator network (ManyVids, FansDB, ...) unless the scene is
 * already available in the user's local Stash library -- a scene they've
 * already imported should never disappear just because of where it
 * originated.
 */
export function filterExcludedNetworkScenes<
  T extends { id: string; isFromExcludedNetwork: boolean },
>(scenes: T[], statuses: Map<string, SceneStatusDto>, hideAmateurNetworkResults: boolean): T[] {
  if (!hideAmateurNetworkResults) {
    return scenes;
  }

  return scenes.filter((scene) => {
    if (!scene.isFromExcludedNetwork) {
      return true;
    }

    const status = statuses.get(scene.id) ?? { state: 'NOT_REQUESTED' };
    return status.state === 'AVAILABLE';
  });
}
