import { Body, Controller, Get, Patch } from '@nestjs/common';
import { AppSettingsService } from './app-settings.service';
import { AppSettingsDto, UpdateAppSettingsDto } from './dto/app-settings.dto';

@Controller('api/settings/preferences')
export class AppSettingsController {
  constructor(private readonly appSettingsService: AppSettingsService) {}

  @Get()
  get(): Promise<AppSettingsDto> {
    return this.appSettingsService.get();
  }

  @Patch()
  update(@Body() dto: UpdateAppSettingsDto): Promise<AppSettingsDto> {
    return this.appSettingsService.update(dto);
  }
}
