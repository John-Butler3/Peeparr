import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/** A passkey ceremony's answer from the browser, for the challenge it was given. */
export class PasskeyResponseDto {
  @IsString()
  @MaxLength(64)
  challengeId!: string;

  // Checked by the WebAuthn verification itself.
  @IsObject()
  response!: Record<string, unknown>;
}

export class RegisterPasskeyDto extends PasskeyResponseDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}
