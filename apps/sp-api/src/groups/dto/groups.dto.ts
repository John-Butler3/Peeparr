import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { LibrarySceneFeedItemDto } from '../../library/dto/library-scenes-feed.dto';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class GroupsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : undefined,
  )
  @IsString()
  query?: string;
}

export class CreateGroupDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(5000)
  synopsis?: string;

  /** Optional Stash scene id to add as the first part. */
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  sceneId?: string;
}

export class UpdateGroupDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(5000)
  synopsis?: string;
}

export class AddGroupSceneDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  sceneId!: string;
}

export class ReorderGroupScenesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  sceneIds!: string[];
}

export interface GroupSummaryDto {
  /** Stash group id. */
  id: string;
  name: string;
  date: string | null;
  studio: string | null;
  sceneCount: number;
  coverImageUrl: string;
}

export interface GroupsFeedDto {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: GroupSummaryDto[];
}

export interface GroupSceneDto extends LibrarySceneFeedItemDto {
  /** Position within the group (Stash scene_index); null when unset. */
  sceneIndex: number | null;
}

export interface GroupDetailDto extends GroupSummaryDto {
  synopsis: string | null;
  viewUrl: string;
  scenes: GroupSceneDto[];
}

export interface SceneGroupMembershipDto {
  id: string;
  name: string;
  sceneIndex: number | null;
}
