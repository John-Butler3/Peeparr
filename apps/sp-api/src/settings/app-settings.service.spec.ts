import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from './app-settings.service';

interface Row {
  singletonKey: number;
  hideAmateurNetworkResults: boolean;
  defaultRootFolderPath: string | null;
  defaultQualityProfileId: number | null;
  defaultMonitored: boolean;
  defaultSearchForMovie: boolean;
  defaultTagIds: number[];
}

const DEFAULT_ROW_DTO = {
  hideAmateurNetworkResults: false,
  defaultRootFolderPath: null,
  defaultQualityProfileId: null,
  defaultMonitored: true,
  defaultSearchForMovie: true,
  defaultTagIds: [],
};

describe('AppSettingsService', () => {
  let row: Row | null;

  const prisma = {
    appSettings: {
      upsert: jest.fn(
        async ({
          create,
          update,
        }: {
          where: { singletonKey: number };
          create: Partial<Row> & { singletonKey: number };
          update: Partial<Row>;
        }) => {
          if (!row) {
            row = {
              singletonKey: create.singletonKey,
              hideAmateurNetworkResults: create.hideAmateurNetworkResults ?? false,
              defaultRootFolderPath: create.defaultRootFolderPath ?? null,
              defaultQualityProfileId: create.defaultQualityProfileId ?? null,
              defaultMonitored: create.defaultMonitored ?? true,
              defaultSearchForMovie: create.defaultSearchForMovie ?? true,
              defaultTagIds: create.defaultTagIds ?? [],
            };
          } else {
            row = { ...row, ...update };
          }

          return row;
        },
      ),
    },
  } as unknown as PrismaService;

  let service: AppSettingsService;

  beforeEach(() => {
    row = null;
    jest.clearAllMocks();
    service = new AppSettingsService(prisma);
  });

  it('defaults every field on first read', async () => {
    const settings = await service.get();

    expect(settings).toEqual(DEFAULT_ROW_DTO);
  });

  it('persists an update and reflects it on subsequent reads', async () => {
    await service.update({ hideAmateurNetworkResults: true });

    const settings = await service.get();

    expect(settings).toEqual({ ...DEFAULT_ROW_DTO, hideAmateurNetworkResults: true });
  });

  it('leaves the stored value untouched when the patch omits the field', async () => {
    await service.update({ hideAmateurNetworkResults: true });

    const settings = await service.update({});

    expect(settings).toEqual({ ...DEFAULT_ROW_DTO, hideAmateurNetworkResults: true });
  });

  it('saves the default download profile fields together', async () => {
    const settings = await service.update({
      defaultRootFolderPath: '/data/scenes',
      defaultQualityProfileId: 4,
      defaultMonitored: false,
      defaultSearchForMovie: false,
      defaultTagIds: [1, 2],
    });

    expect(settings).toEqual({
      hideAmateurNetworkResults: false,
      defaultRootFolderPath: '/data/scenes',
      defaultQualityProfileId: 4,
      defaultMonitored: false,
      defaultSearchForMovie: false,
      defaultTagIds: [1, 2],
    });
  });

  it('allows clearing a saved root folder/quality profile back to null', async () => {
    await service.update({ defaultRootFolderPath: '/data/scenes', defaultQualityProfileId: 4 });

    const settings = await service.update({
      defaultRootFolderPath: null,
      defaultQualityProfileId: null,
    });

    expect(settings.defaultRootFolderPath).toBeNull();
    expect(settings.defaultQualityProfileId).toBeNull();
  });
});
