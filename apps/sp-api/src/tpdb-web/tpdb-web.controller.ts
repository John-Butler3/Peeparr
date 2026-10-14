import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { SaveTpdbWebAccountDto } from './dto/save-tpdb-web-account.dto';
import { TpdbWebService, type TpdbWebStatus } from './tpdb-web.service';

// Settings for the optional ThePornDB website login (popular scenes).
@Controller('api/tpdb-web')
export class TpdbWebController {
  constructor(private readonly tpdbWebService: TpdbWebService) {}

  @Get()
  getStatus(): Promise<TpdbWebStatus> {
    return this.tpdbWebService.getStatus();
  }

  @Put()
  save(@Body() dto: SaveTpdbWebAccountDto): Promise<TpdbWebStatus> {
    return this.tpdbWebService.saveAccount(dto.email, dto.password);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(): Promise<void> {
    return this.tpdbWebService.removeAccount();
  }

  /** Signs in and reads the homepage now; errors come back in the status. */
  @Post('refresh')
  async refresh(): Promise<TpdbWebStatus> {
    try {
      return await this.tpdbWebService.refreshNow();
    } catch {
      return this.tpdbWebService.getStatus();
    }
  }
}
