import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  DeleteLibrarySceneDto,
  DeleteLibrarySceneResponseDto,
} from './dto/delete-library-scene.dto';
import { LibraryDeletionService } from './library-deletion.service';

@Controller('api/library')
export class LibraryDeletionController {
  constructor(
    private readonly libraryDeletionService: LibraryDeletionService,
  ) {}

  // Deletes for good: the files, from Stash and Whisparr.
  @Post('delete-scene')
  @HttpCode(200)
  deleteScene(
    @Body() body: DeleteLibrarySceneDto,
  ): Promise<DeleteLibrarySceneResponseDto> {
    return this.libraryDeletionService.deleteScene(body);
  }
}
