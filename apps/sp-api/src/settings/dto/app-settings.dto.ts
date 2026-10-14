import { IsArray, IsBoolean, IsInt, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class AppSettingsDto {
  hideAmateurNetworkResults!: boolean;
  defaultRootFolderPath!: string | null;
  defaultQualityProfileId!: number | null;
  defaultMonitored!: boolean;
  defaultSearchForMovie!: boolean;
  defaultTagIds!: number[];
}

export class UpdateAppSettingsDto {
  @IsOptional()
  @IsBoolean()
  hideAmateurNetworkResults?: boolean;

  // Nullable so the frontend can explicitly clear a saved default; @IsOptional()
  // skips validation for both undefined (field omitted) and null (field cleared).
  @IsOptional()
  @IsString()
  @MinLength(1)
  defaultRootFolderPath?: string | null;

  @IsOptional()
  @IsInt()
  @IsPositive()
  defaultQualityProfileId?: number | null;

  @IsOptional()
  @IsBoolean()
  defaultMonitored?: boolean;

  @IsOptional()
  @IsBoolean()
  defaultSearchForMovie?: boolean;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  defaultTagIds?: number[];
}
