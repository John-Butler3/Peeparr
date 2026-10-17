import { SceneStatusDto } from '../../scene-status/dto/scene-status.dto';
import { type CatalogProviderKey } from '../../providers/catalog/catalog-provider.util';

export class ScenesFeedItemDto {
  id!: string;
  title!: string;
  description!: string | null;
  imageUrl!: string | null;
  cardImageUrl!: string | null;
  studioId!: string | null;
  studio!: string | null;
  studioImageUrl!: string | null;
  releaseDate!: string | null;
  duration!: number | null;
  type!: 'SCENE';
  source!: CatalogProviderKey;
  status!: SceneStatusDto;
  requestable!: boolean;
  /** A Pornhub video, not in the library, that plays streamed (Settings). */
  streamable?: boolean;
}

export class ScenesFeedResponseDto {
  total!: number;
  page!: number;
  perPage!: number;
  hasMore!: boolean;
  items!: ScenesFeedItemDto[];
  /**
   * TPDB "Popular" was asked for but the website's popular list isn't
   * available (no TPDB website login, or it isn't working): these are the
   * latest releases instead.
   */
  popularUnavailable?: boolean;
}

export class SimilarScenesResponseDto {
  items!: ScenesFeedItemDto[];
}
