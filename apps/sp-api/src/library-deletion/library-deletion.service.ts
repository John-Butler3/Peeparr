import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { RequestsService } from '../requests/requests.service';
import { DeleteLibrarySceneResponseDto } from './dto/delete-library-scene.dto';

/**
 * Deleting a scene from the library for good: Stash deletes its video file,
 * what it generated for it and its record; Whisparr forgets it (deleting
 * its file too, if it still has one), optionally kept from downloading it
 * again; and it's gone from Peeparr's library straight away.
 */
@Injectable()
export class LibraryDeletionService {
  private readonly logger = new Logger(LibraryDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stashAdapter: StashAdapter,
    private readonly requestsService: RequestsService,
  ) {}

  async deleteScene(input: {
    stashSceneIds: string[];
    catalogSceneId?: string | null;
    keepAway?: boolean;
  }): Promise<DeleteLibrarySceneResponseDto> {
    const stashSceneIds = [
      ...new Set(input.stashSceneIds.map((id) => id.trim())),
    ];
    const config = await this.getStashConfig();

    try {
      await this.stashAdapter.destroyScenes(stashSceneIds, config);
    } catch (error) {
      this.logger.error(
        `Stash couldn't delete scene(s) ${stashSceneIds.join(', ')}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadGatewayException(
        "Stash couldn't delete the scene (does it have permission to delete files in your library?).",
      );
    }
    this.logger.log(
      `Deleted scene(s) ${stashSceneIds.join(', ')} from Stash, with their files.`,
    );

    await this.prisma.librarySceneIndex
      .deleteMany({ where: { stashSceneId: { in: stashSceneIds } } })
      .catch(() => null);

    let removedFromWhisparr = false;
    const catalogSceneId = input.catalogSceneId?.trim();
    if (catalogSceneId) {
      try {
        const removed = await this.requestsService.removeSceneRequest(
          catalogSceneId,
          {
            deleteFiles: true,
            addImportExclusion: input.keepAway === true,
          },
        );
        removedFromWhisparr = removed.whisparrMovieId !== null;
      } catch (error) {
        // Deleted from the library either way; Whisparr may not be set up.
        this.logger.warn(
          `Deleted from Stash, but not removed from Whisparr: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { deletedStashSceneIds: stashSceneIds, removedFromWhisparr };
  }

  private async getStashConfig(): Promise<{
    baseUrl: string;
    apiKey?: string | null;
  }> {
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { type: 'STASH' },
    });
    const baseUrl = integration?.baseUrl?.trim();
    if (
      !integration ||
      !integration.enabled ||
      integration.status !== 'CONFIGURED' ||
      !baseUrl
    ) {
      throw new ServiceUnavailableException('Stash is not set up.');
    }
    return { baseUrl, apiKey: integration.apiKey };
  }
}
