import { IsNotEmpty, IsString } from 'class-validator';

export class SetPerformerMainImageDto {
  @IsString()
  @IsNotEmpty()
  imageUrl!: string;
}
