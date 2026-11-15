import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Request, Response } from 'express';
import { Public } from './decorators/public.decorator';
import { PasskeyResponseDto, RegisterPasskeyDto } from './dto/passkey.dto';
import { PasskeyService } from './passkey.service';

/** Signing in with a passkey (Face ID / Touch ID), and managing them. */
@Controller('api/auth/passkeys')
export class PasskeyController {
  constructor(private readonly passkeyService: PasskeyService) {}

  @Get()
  list(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.passkeyService.list(request, response);
  }

  @Post('register/options')
  registrationOptions(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.passkeyService.registrationOptions(request, response);
  }

  @Post('register')
  register(
    @Body() dto: RegisterPasskeyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.passkeyService.register(request, response, {
      challengeId: dto.challengeId,
      response: dto.response as unknown as RegistrationResponseJSON,
      name: dto.name,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id') id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.passkeyService.remove(request, response, id);
  }

  @Public()
  @Post('login/options')
  @HttpCode(HttpStatus.OK)
  authenticationOptions(@Req() request: Request) {
    return this.passkeyService.authenticationOptions(request);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @Body() dto: PasskeyResponseDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.passkeyService.login(request, response, {
      challengeId: dto.challengeId,
      response: dto.response as unknown as AuthenticationResponseJSON,
    });
  }
}
