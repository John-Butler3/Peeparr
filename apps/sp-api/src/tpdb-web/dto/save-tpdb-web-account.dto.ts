import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SaveTpdbWebAccountDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  email!: string;

  /** Leave out to keep the saved password. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}
