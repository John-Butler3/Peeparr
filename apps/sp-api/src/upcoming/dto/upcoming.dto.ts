import { ScenesFeedItemDto } from '../../scenes/dto/scenes-feed.dto';

/** Why a scene is on the calendar. */
export interface UpcomingReasonDto {
  kind: 'REQUESTED' | 'PERFORMER' | 'STUDIO';
  /** The favourite performer's or site's catalog id. */
  id: string | null;
  name: string | null;
}

export interface UpcomingItemDto extends ScenesFeedItemDto {
  releaseDate: string;
  reasons: UpcomingReasonDto[];
}

export interface UpcomingResponseDto {
  /** The window shown, as YYYY-MM-DD (from includes the last week). */
  from: string;
  to: string;
  today: string;
  items: UpcomingItemDto[];
}
