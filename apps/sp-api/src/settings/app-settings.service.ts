import { Injectable } from '@nestjs/common';
import { AppSettings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsDto, UpdateAppSettingsDto } from './dto/app-settings.dto';

@Injectable()
export class AppSettingsService {
  private static readonly SINGLETON_KEY = 1;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<AppSettingsDto> {
    const settings = await this.prisma.appSettings.upsert({
      where: { singletonKey: AppSettingsService.SINGLETON_KEY },
      create: { singletonKey: AppSettingsService.SINGLETON_KEY },
      update: {},
    });

    return this.toDto(settings);
  }

  async update(patch: UpdateAppSettingsDto): Promise<AppSettingsDto> {
    const data = {
      ...(patch.hideAmateurNetworkResults !== undefined
        ? { hideAmateurNetworkResults: patch.hideAmateurNetworkResults }
        : {}),
      ...(patch.defaultRootFolderPath !== undefined
        ? { defaultRootFolderPath: patch.defaultRootFolderPath }
        : {}),
      ...(patch.defaultQualityProfileId !== undefined
        ? { defaultQualityProfileId: patch.defaultQualityProfileId }
        : {}),
      ...(patch.defaultMonitored !== undefined
        ? { defaultMonitored: patch.defaultMonitored }
        : {}),
      ...(patch.defaultSearchForMovie !== undefined
        ? { defaultSearchForMovie: patch.defaultSearchForMovie }
        : {}),
      ...(patch.defaultTagIds !== undefined ? { defaultTagIds: patch.defaultTagIds } : {}),
    };

    const settings = await this.prisma.appSettings.upsert({
      where: { singletonKey: AppSettingsService.SINGLETON_KEY },
      create: { singletonKey: AppSettingsService.SINGLETON_KEY, ...data },
      update: data,
    });

    return this.toDto(settings);
  }

  private toDto(settings: AppSettings): AppSettingsDto {
    return {
      hideAmateurNetworkResults: settings.hideAmateurNetworkResults,
      defaultRootFolderPath: settings.defaultRootFolderPath,
      defaultQualityProfileId: settings.defaultQualityProfileId,
      defaultMonitored: settings.defaultMonitored,
      defaultSearchForMovie: settings.defaultSearchForMovie,
      defaultTagIds: settings.defaultTagIds,
    };
  }
}
