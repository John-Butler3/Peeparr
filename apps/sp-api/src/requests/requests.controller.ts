import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { DownloadProfileOptionsDto } from './dto/download-profile-options.dto';
import { RequestOptionsDto } from './dto/request-options.dto';
import { SubmitSceneRequestDto } from './dto/submit-scene-request.dto';
import { SubmitSceneRequestResponseDto } from './dto/submit-scene-request-response.dto';
import { RequestsService } from './requests.service';

@Controller('api/requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  // Static route declared before the :stashId/... routes below so it isn't
  // shadowed (matters if a real stashId could ever collide with "options").
  @Get('options')
  getDownloadProfileOptions(): Promise<DownloadProfileOptionsDto> {
    return this.requestsService.getDownloadProfileOptions();
  }

  @Get(':stashId/options')
  getRequestOptions(
    @Param('stashId') stashId: string,
  ): Promise<RequestOptionsDto> {
    return this.requestsService.getRequestOptions(stashId);
  }

  @Post(':stashId')
  submitSceneRequest(
    @Param('stashId') stashId: string,
    @Body() payload: SubmitSceneRequestDto,
  ): Promise<SubmitSceneRequestResponseDto> {
    return this.requestsService.submitSceneRequest(stashId, payload);
  }

  @Delete(':stashId')
  removeSceneRequest(
    @Param('stashId') stashId: string,
    @Query('deleteFiles') deleteFiles?: string,
    @Query('addImportExclusion') addImportExclusion?: string,
  ) {
    return this.requestsService.removeSceneRequest(stashId, {
      deleteFiles: deleteFiles === 'true',
      addImportExclusion: addImportExclusion === 'true',
    });
  }
}
