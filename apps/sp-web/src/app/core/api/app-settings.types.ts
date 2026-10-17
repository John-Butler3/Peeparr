export interface AppSettings {
  hideAmateurNetworkResults: boolean;
  /** Scenes from Pornhub play in Peeparr (Pornhub's embed player). */
  streamFromPornhub: boolean;
  defaultRootFolderPath: string | null;
  defaultQualityProfileId: number | null;
  defaultMonitored: boolean;
  defaultSearchForMovie: boolean;
  defaultTagIds: number[];
}

export type UpdateAppSettingsPayload = Partial<AppSettings>;
