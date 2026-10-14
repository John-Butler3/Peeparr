import { Injectable } from '@nestjs/common';
import {
  StashAdapter,
  StashAdapterBaseConfig,
} from '../providers/stash/stash.adapter';

export interface StashGroupSceneRecord {
  id: string;
  title?: string | null;
  details?: string | null;
  date?: string | null;
  created_at?: string | null;
  files?: Array<{ basename?: string | null; duration?: number | null }>;
  paths?: { screenshot?: string | null };
  studio?: { id: string; name: string; image_path?: string | null } | null;
  performers?: Array<{ name: string }>;
  groups?: StashSceneGroupRecord[];
}

export interface StashSceneGroupRecord {
  group?: { id: string; name?: string | null } | null;
  scene_index?: number | null;
}

export interface StashGroupRecord {
  id: string;
  name: string;
  date?: string | null;
  synopsis?: string | null;
  scene_count?: number | null;
  studio?: { name: string } | null;
  scenes?: StashGroupSceneRecord[];
}

const GROUP_SUMMARY_FIELDS = `
  id
  name
  date
  scene_count
  studio {
    name
  }
`;

const GROUP_SCENE_FIELDS = `
  id
  title
  details
  date
  created_at
  files {
    basename
    duration
  }
  paths {
    screenshot
  }
  studio {
    id
    name
    image_path
  }
  performers {
    name
  }
  groups {
    group {
      id
    }
    scene_index
  }
`;

// Stash Groups (v0.27+, formerly Movies) over the Stash GraphQL API. A scene's
// membership and position live on the scene (SceneUpdateInput.groups, a full
// replacement list), so changing one group's scenes means rewriting each
// affected scene's whole group list -- see GroupsService.
@Injectable()
export class StashGroupsClient {
  constructor(private readonly stashAdapter: StashAdapter) {}

  async findGroups(
    config: StashAdapterBaseConfig,
    options: { page: number; perPage: number; query?: string },
  ): Promise<{ total: number; groups: StashGroupRecord[] }> {
    const data = await this.stashAdapter.graphql<{
      findGroups?: { count?: number; groups?: StashGroupRecord[] };
    }>(
      config,
      `
        query FindGroups($filter: FindFilterType) {
          findGroups(filter: $filter) {
            count
            groups {
              ${GROUP_SUMMARY_FIELDS}
            }
          }
        }
      `,
      {
        filter: {
          page: options.page,
          per_page: options.perPage,
          sort: 'name',
          direction: 'ASC',
          ...(options.query ? { q: options.query } : {}),
        },
      },
    );

    return {
      total: data?.findGroups?.count ?? 0,
      groups: data?.findGroups?.groups ?? [],
    };
  }

  async findGroup(
    config: StashAdapterBaseConfig,
    groupId: string,
  ): Promise<StashGroupRecord | null> {
    const data = await this.stashAdapter.graphql<{
      findGroup?: StashGroupRecord | null;
    }>(
      config,
      `
        query FindGroup($id: ID!) {
          findGroup(id: $id) {
            ${GROUP_SUMMARY_FIELDS}
            synopsis
            scenes {
              ${GROUP_SCENE_FIELDS}
            }
          }
        }
      `,
      { id: groupId },
    );

    return data?.findGroup ?? null;
  }

  async findSceneGroups(
    config: StashAdapterBaseConfig,
    sceneId: string,
  ): Promise<StashSceneGroupRecord[] | null> {
    const data = await this.stashAdapter.graphql<{
      findScene?: { id: string; groups?: StashSceneGroupRecord[] } | null;
    }>(
      config,
      `
        query FindSceneGroups($id: ID!) {
          findScene(id: $id) {
            id
            groups {
              group {
                id
                name
              }
              scene_index
            }
          }
        }
      `,
      { id: sceneId },
    );

    return data?.findScene ? (data.findScene.groups ?? []) : null;
  }

  async createGroup(
    config: StashAdapterBaseConfig,
    input: { name: string; synopsis?: string },
  ): Promise<string> {
    const data = await this.stashAdapter.graphql<{
      groupCreate?: { id: string } | null;
    }>(
      config,
      `
        mutation GroupCreate($input: GroupCreateInput!) {
          groupCreate(input: $input) {
            id
          }
        }
      `,
      { input },
    );

    const id = data?.groupCreate?.id;
    if (!id) {
      throw new Error('Stash did not return the created group.');
    }

    return id;
  }

  async updateGroup(
    config: StashAdapterBaseConfig,
    groupId: string,
    input: { name?: string; synopsis?: string },
  ): Promise<void> {
    await this.stashAdapter.graphql(
      config,
      `
        mutation GroupUpdate($input: GroupUpdateInput!) {
          groupUpdate(input: $input) {
            id
          }
        }
      `,
      { input: { id: groupId, ...input } },
    );
  }

  async destroyGroup(config: StashAdapterBaseConfig, groupId: string): Promise<void> {
    await this.stashAdapter.graphql(
      config,
      `
        mutation GroupDestroy($input: GroupDestroyInput!) {
          groupDestroy(input: $input)
        }
      `,
      { input: { id: groupId } },
    );
  }

  async setSceneGroups(
    config: StashAdapterBaseConfig,
    sceneId: string,
    groups: Array<{ groupId: string; sceneIndex: number | null }>,
  ): Promise<void> {
    await this.stashAdapter.graphql(
      config,
      `
        mutation SceneUpdateGroups($input: SceneUpdateInput!) {
          sceneUpdate(input: $input) {
            id
          }
        }
      `,
      {
        input: {
          id: sceneId,
          groups: groups.map((entry) => ({
            group_id: entry.groupId,
            scene_index: entry.sceneIndex,
          })),
        },
      },
    );
  }

  resolveSceneViewUrl(config: StashAdapterBaseConfig, sceneId: string): string {
    return this.stashAdapter.resolveSceneViewUrl(config.baseUrl, sceneId);
  }

  resolveGroupViewUrl(config: StashAdapterBaseConfig, groupId: string): string {
    const parsed = new URL(config.baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = `${cleanPath}/groups/${encodeURIComponent(groupId)}`;
    parsed.search = '';
    return parsed.toString();
  }
}
