import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { LibrarySceneQueryService } from '../library/library-scene-query.service';
import { StashAdapterBaseConfig } from '../providers/stash/stash.adapter';
import {
  GroupDetailDto,
  GroupSceneDto,
  GroupSummaryDto,
  GroupsFeedDto,
  SceneGroupMembershipDto,
} from './dto/groups.dto';
import {
  StashGroupRecord,
  StashGroupSceneRecord,
  StashGroupsClient,
} from './stash-groups.client';

// "Series" in the UI: Stash Groups, i.e. ordered collections of scenes.
@Injectable()
export class GroupsService {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 24;

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly stashGroups: StashGroupsClient,
    private readonly librarySceneQueryService: LibrarySceneQueryService,
  ) {}

  async getGroups(
    page = GroupsService.DEFAULT_PAGE,
    perPage = GroupsService.DEFAULT_PER_PAGE,
    query?: string,
  ): Promise<GroupsFeedDto> {
    const config = await this.getStashConfig();
    const result = await this.stashGroups.findGroups(config, { page, perPage, query });

    return {
      total: result.total,
      page,
      perPage,
      hasMore: page * perPage < result.total,
      items: result.groups.map((group) => this.toSummary(group)),
    };
  }

  async getGroup(groupId: string): Promise<GroupDetailDto> {
    const config = await this.getStashConfig();
    const group = await this.requireGroup(config, groupId);
    const orderedScenes = this.orderScenes(group);
    const indexedItems = await this.librarySceneQueryService.getScenesByIds(
      orderedScenes.map(({ scene }) => scene.id),
    );
    const indexedById = new Map(indexedItems.map((item) => [item.id, item]));

    return {
      ...this.toSummary(group),
      synopsis: group.synopsis?.trim() || null,
      viewUrl: this.stashGroups.resolveGroupViewUrl(config, group.id),
      scenes: orderedScenes.map(({ scene, sceneIndex }) => ({
        // Prefer the library index's projection (it carries the catalog link);
        // fall back to Stash's own data for scenes not indexed yet.
        ...(indexedById.get(scene.id) ?? this.toSceneItem(config, scene)),
        sceneIndex,
      })),
    };
  }

  async getGroupsForScene(sceneId: string): Promise<SceneGroupMembershipDto[]> {
    const config = await this.getStashConfig();
    const groups = await this.requireSceneGroups(config, sceneId);

    return groups
      .filter((entry) => entry.group?.id)
      .map((entry) => ({
        id: entry.group!.id,
        name: entry.group!.name ?? '',
        sceneIndex: entry.scene_index ?? null,
      }));
  }

  async createGroup(input: {
    name: string;
    synopsis?: string;
    sceneId?: string;
  }): Promise<GroupDetailDto> {
    const config = await this.getStashConfig();
    // Check the scene first so a bad id doesn't leave an empty group behind.
    if (input.sceneId) {
      await this.requireSceneGroups(config, input.sceneId);
    }

    const groupId = await this.stashGroups.createGroup(config, {
      name: input.name,
      ...(input.synopsis ? { synopsis: input.synopsis } : {}),
    });
    if (input.sceneId) {
      await this.addScene(groupId, input.sceneId);
    }

    return this.getGroup(groupId);
  }

  async updateGroup(
    groupId: string,
    input: { name?: string; synopsis?: string },
  ): Promise<GroupDetailDto> {
    const config = await this.getStashConfig();
    await this.requireGroup(config, groupId);
    await this.stashGroups.updateGroup(config, groupId, input);
    return this.getGroup(groupId);
  }

  async deleteGroup(groupId: string): Promise<void> {
    const config = await this.getStashConfig();
    await this.requireGroup(config, groupId);
    // Deletes only the group; its scenes stay in Stash.
    await this.stashGroups.destroyGroup(config, groupId);
  }

  // Appends the scene as the group's last part. No-op if it's already in it.
  async addScene(groupId: string, sceneId: string): Promise<GroupDetailDto> {
    const config = await this.getStashConfig();
    const group = await this.requireGroup(config, groupId);
    const sceneGroups = await this.requireSceneGroups(config, sceneId);

    if (!sceneGroups.some((entry) => entry.group?.id === groupId)) {
      const lastIndex = this.orderScenes(group).reduce(
        (max, { sceneIndex }) => Math.max(max, sceneIndex ?? 0),
        0,
      );
      await this.stashGroups.setSceneGroups(config, sceneId, [
        ...this.toGroupInputs(sceneGroups),
        { groupId, sceneIndex: lastIndex + 1 },
      ]);
    }

    return this.getGroup(groupId);
  }

  async removeScene(groupId: string, sceneId: string): Promise<GroupDetailDto> {
    const config = await this.getStashConfig();
    await this.requireGroup(config, groupId);
    const sceneGroups = await this.requireSceneGroups(config, sceneId);

    if (sceneGroups.some((entry) => entry.group?.id === groupId)) {
      await this.stashGroups.setSceneGroups(
        config,
        sceneId,
        this.toGroupInputs(sceneGroups).filter((entry) => entry.groupId !== groupId),
      );
    }

    return this.getGroup(groupId);
  }

  // Renumbers the group's parts 1..n in the given order. sceneIds must be
  // exactly the group's current scenes.
  async reorderScenes(groupId: string, sceneIds: string[]): Promise<GroupDetailDto> {
    const config = await this.getStashConfig();
    const group = await this.requireGroup(config, groupId);
    const current = this.orderScenes(group);
    const requested = sceneIds.map((id) => id.trim());

    const currentIds = new Set(current.map(({ scene }) => scene.id));
    if (
      new Set(requested).size !== requested.length ||
      requested.length !== currentIds.size ||
      requested.some((id) => !currentIds.has(id))
    ) {
      throw new BadRequestException(
        "sceneIds must list each of the series' scenes exactly once.",
      );
    }

    const currentIndexById = new Map(
      current.map(({ scene, sceneIndex }) => [scene.id, sceneIndex]),
    );
    const sceneById = new Map(current.map(({ scene }) => [scene.id, scene]));
    for (const [position, sceneId] of requested.entries()) {
      const sceneIndex = position + 1;
      if (currentIndexById.get(sceneId) === sceneIndex) {
        continue;
      }

      // The group scene list already carries each scene's full membership.
      const otherGroups = this.toGroupInputs(sceneById.get(sceneId)?.groups ?? []).filter(
        (entry) => entry.groupId !== groupId,
      );
      await this.stashGroups.setSceneGroups(config, sceneId, [
        ...otherGroups,
        { groupId, sceneIndex },
      ]);
    }

    return this.getGroup(groupId);
  }

  // The group's scenes by part number (unnumbered ones last, by title).
  private orderScenes(
    group: StashGroupRecord,
  ): Array<{ scene: StashGroupSceneRecord; sceneIndex: number | null }> {
    return (group.scenes ?? [])
      .map((scene) => ({
        scene,
        sceneIndex:
          scene.groups?.find((entry) => entry.group?.id === group.id)?.scene_index ?? null,
      }))
      .sort((a, b) => {
        if (a.sceneIndex !== b.sceneIndex) {
          if (a.sceneIndex === null) return 1;
          if (b.sceneIndex === null) return -1;
          return a.sceneIndex - b.sceneIndex;
        }
        return this.sceneTitle(a.scene).localeCompare(this.sceneTitle(b.scene));
      });
  }

  private toGroupInputs(
    entries: StashGroupSceneRecord['groups'],
  ): Array<{ groupId: string; sceneIndex: number | null }> {
    return (entries ?? [])
      .filter((entry) => entry.group?.id)
      .map((entry) => ({ groupId: entry.group!.id, sceneIndex: entry.scene_index ?? null }));
  }

  private toSummary(group: StashGroupRecord): GroupSummaryDto {
    return {
      id: group.id,
      name: group.name,
      date: group.date?.trim() || null,
      studio: group.studio?.name ?? null,
      sceneCount: group.scene_count ?? group.scenes?.length ?? 0,
      // Proxied: Stash's own URLs need its API key and may be plain HTTP.
      coverImageUrl: `/api/media/stash/groups/${encodeURIComponent(group.id)}/cover`,
    };
  }

  private toSceneItem(
    config: StashAdapterBaseConfig,
    scene: StashGroupSceneRecord,
  ): Omit<GroupSceneDto, 'sceneIndex'> {
    const screenshotUrl = scene.paths?.screenshot
      ? `/api/media/stash/scenes/${encodeURIComponent(scene.id)}/screenshot`
      : null;
    const duration = scene.files?.[0]?.duration;
    const createdAt = scene.created_at ? new Date(scene.created_at) : null;

    return {
      id: scene.id,
      activeCatalogSceneId: null,
      title: this.sceneTitle(scene),
      description: scene.details?.trim() || null,
      imageUrl: screenshotUrl,
      cardImageUrl: screenshotUrl ? `${screenshotUrl}?w=640` : null,
      // Stash-local studio ids aren't catalog ids -- see
      // library-scene-query.service.ts.
      studioId: null,
      studio: scene.studio?.name ?? null,
      studioImageUrl:
        scene.studio?.id && scene.studio.image_path
          ? `/api/media/stash/studios/${encodeURIComponent(scene.studio.id)}/logo`
          : null,
      performerNames: (scene.performers ?? []).map((performer) => performer.name),
      releaseDate: scene.date?.trim() || null,
      duration: typeof duration === 'number' ? Math.round(duration) : null,
      localCreatedAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
      type: 'SCENE',
      source: 'STASH',
      viewUrl: this.stashGroups.resolveSceneViewUrl(config, scene.id),
    };
  }

  private sceneTitle(scene: StashGroupSceneRecord): string {
    return scene.title?.trim() || scene.files?.[0]?.basename?.trim() || `Scene ${scene.id}`;
  }

  private async requireGroup(
    config: StashAdapterBaseConfig,
    groupId: string,
  ): Promise<StashGroupRecord> {
    const group = await this.stashGroups.findGroup(config, this.requireId(groupId));
    if (!group) {
      throw new NotFoundException(`Series ${groupId} not found.`);
    }

    return group;
  }

  private async requireSceneGroups(
    config: StashAdapterBaseConfig,
    sceneId: string,
  ): Promise<NonNullable<StashGroupSceneRecord['groups']>> {
    const groups = await this.stashGroups.findSceneGroups(config, this.requireId(sceneId));
    if (!groups) {
      throw new NotFoundException(`Stash scene ${sceneId} not found.`);
    }

    return groups;
  }

  // Stash ids are numeric; reject anything else before it reaches GraphQL.
  private requireId(id: string): string {
    const normalized = id.trim();
    if (!/^\d+$/.test(normalized)) {
      throw new BadRequestException(`Invalid Stash id: ${id}`);
    }

    return normalized;
  }

  private async getStashConfig(): Promise<StashAdapterBaseConfig> {
    const integration = await this.integrationsService.findOne(IntegrationType.STASH);
    const baseUrl = integration.baseUrl?.trim();
    if (
      !integration.enabled ||
      integration.status !== IntegrationStatus.CONFIGURED ||
      !baseUrl
    ) {
      throw new NotFoundException('Stash integration is not configured.');
    }

    return { baseUrl, apiKey: integration.apiKey };
  }
}
