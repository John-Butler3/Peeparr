import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { SetPerformerMonitoringDto } from './dto/set-performer-monitoring.dto';
import {
  PerformerMonitoringService,
  PerformerMonitoringState,
} from './performer-monitoring.service';

@Controller('api/performers/:performerId/monitoring')
export class PerformerMonitoringController {
  constructor(
    private readonly performerMonitoringService: PerformerMonitoringService,
  ) {}

  @Get()
  getMonitoring(
    @Param('performerId') performerId: string,
  ): Promise<PerformerMonitoringState> {
    return this.performerMonitoringService.getState(performerId);
  }

  @Put()
  setMonitoring(
    @Param('performerId') performerId: string,
    @Body() body: SetPerformerMonitoringDto,
  ): Promise<PerformerMonitoringState> {
    return this.performerMonitoringService.setMonitored(
      performerId,
      body.monitored,
    );
  }
}
