export class WatchProgressItemDto {
  /** Stash scene id. */
  id!: string;
  /** The active catalog's scene id, when the Stash scene is linked. */
  activeCatalogSceneId!: string | null;
  /** 1-100; 100 once played through. */
  progressPercent!: number;
}

export class WatchProgressResponseDto {
  items!: WatchProgressItemDto[];
}
