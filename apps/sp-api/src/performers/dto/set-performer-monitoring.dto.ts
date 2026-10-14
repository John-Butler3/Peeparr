import { IsBoolean } from 'class-validator';

export class SetPerformerMonitoringDto {
  @IsBoolean()
  monitored!: boolean;
}
