import { SceneStatusDto } from '../../scene-status/dto/scene-status.dto';
import { type CatalogProviderKey } from '../../providers/catalog/catalog-provider.util';

export class DiscoverItemDto {
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
  /** A Pornhub video, not in the library, that plays streamed (Settings). */
  streamable?: boolean;
}

export class DiscoverResponseDto {
  total!: number;
  page!: number;
  perPage!: number;
  hasMore!: boolean;
  items!: DiscoverItemDto[];
}
