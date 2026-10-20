import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class DeleteLibrarySceneDto {
  /** The Stash scenes (copies) to delete: their files go too. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Matches(/^\d{1,12}$/, { each: true })
  stashSceneIds!: string[];

  /** The catalog scene they are, if any: taken out of Whisparr too. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  catalogSceneId?: string | null;

  /** Keep Whisparr from downloading it again (an import exclusion). */
  @IsOptional()
  @IsBoolean()
  keepAway?: boolean;
}

export class DeleteLibrarySceneResponseDto {
  deletedStashSceneIds!: string[];
  /** Taken out of Whisparr (false when it wasn't there, or Whisparr isn't set up). */
  removedFromWhisparr!: boolean;
}
