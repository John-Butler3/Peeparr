import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  StartStashScanDto,
  StashScanStartedDto,
} from './dto/start-stash-scan.dto';
import { StashScanService } from './stash-scan.service';

@Controller('api/stash')
export class StashScanController {
  constructor(private readonly stashScanService: StashScanService) {}

  /** Queues a scan in Stash and returns as soon as Stash has it. */
  @Post('scan')
  @HttpCode(202)
  startScan(@Body() body: StartStashScanDto): Promise<StashScanStartedDto> {
    return this.stashScanService.start(body.target);
  }
}
