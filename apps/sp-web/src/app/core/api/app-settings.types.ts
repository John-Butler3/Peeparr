export interface AppSettings {
  hideAmateurNetworkResults: boolean;
  defaultRootFolderPath: string | null;
  defaultQualityProfileId: number | null;
  defaultMonitored: boolean;
  defaultSearchForMovie: boolean;
  defaultTagIds: number[];
}

export type UpdateAppSettingsPayload = Partial<AppSettings>;
