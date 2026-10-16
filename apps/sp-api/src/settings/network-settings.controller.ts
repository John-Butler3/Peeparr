import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { NetworkSettingsDto, NetworkSettingsService } from './network-settings.service';

export class UpdateNetworkSettingsDto {
  // Null or empty: no proxy.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  trustProxy?: string | null;
}

@Controller('api/settings/network')
export class NetworkSettingsController {
  constructor(private readonly networkSettingsService: NetworkSettingsService) {}

  @Get()
  get(@Req() request: Request): Promise<NetworkSettingsDto> {
    return this.networkSettingsService.get(request);
  }

  @Put()
  update(@Body() dto: UpdateNetworkSettingsDto, @Req() request: Request): Promise<NetworkSettingsDto> {
    return this.networkSettingsService.update(dto.trustProxy ?? null, request);
  }
}
