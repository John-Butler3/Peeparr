import { IsString, Matches } from 'class-validator';
import { DiscoverQueryDto } from '../../discover/dto/discover-query.dto';

/** A page of the library in a shuffled order: the same seed, the same order. */
export class LibraryShuffleQueryDto extends DiscoverQueryDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  seed!: string;
}
