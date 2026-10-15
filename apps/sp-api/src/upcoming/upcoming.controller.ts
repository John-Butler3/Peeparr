import { Controller, Get } from '@nestjs/common';
import { UpcomingResponseDto } from './dto/upcoming.dto';
import { UpcomingService } from './upcoming.service';

@Controller('api/upcoming')
export class UpcomingController {
  constructor(private readonly upcomingService: UpcomingService) {}

  @Get()
  getUpcoming(): Promise<UpcomingResponseDto> {
    return this.upcomingService.getUpcoming();
  }
}
