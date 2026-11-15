import { IsBoolean, IsOptional } from 'class-validator';

export class LockDto {
  /** The app was closed: end the session now rather than after the grace time. */
  @IsOptional()
  @IsBoolean()
  now?: boolean;
}

export class LockOnCloseDto {
  @IsBoolean()
  enabled!: boolean;
}
