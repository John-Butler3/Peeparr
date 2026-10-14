import { IsNumber, IsOptional, Min } from 'class-validator';

export class SaveScenePlaybackProgressDto {
  @IsNumber()
  @Min(0)
  resumeSeconds!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  playDuration?: number;
}
