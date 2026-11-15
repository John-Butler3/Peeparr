import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminSessionGuard } from './admin-session.guard';
import { LoginAttemptService } from './login-attempt.service';
import { PasskeyController } from './passkey.controller';
import { PasskeyService } from './passkey.service';
import { PasswordResetService } from './password-reset.service';
import { SessionCookieService } from './session-cookie.service';
import { StreamTokenService } from './stream-token.service';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController, PasskeyController],
  providers: [
    AuthService,
    SessionCookieService,
    LoginAttemptService,
    PasswordResetService,
    PasskeyService,
    StreamTokenService,
    Reflector,
    {
      provide: APP_GUARD,
      useClass: AdminSessionGuard,
    },
  ],
  exports: [AuthService, StreamTokenService],
})
export class AuthModule {}
