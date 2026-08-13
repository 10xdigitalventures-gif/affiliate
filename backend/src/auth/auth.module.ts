import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { JwtStrategy } from './jwt.strategy'
import { IdentityService } from './identity.service'
import { MailModule } from '../mail/mail.module'
import { TenantModule } from '../common/tenant/tenant.module'

@Module({
  imports: [
    MailModule,
    TenantModule,
    PassportModule,
    JwtModule.register({
      // No fallback — the startup guard in main.ts ensures JWT_ACCESS_SECRET is set.
      secret: process.env.JWT_ACCESS_SECRET,
      signOptions: { expiresIn: Number(process.env.JWT_ACCESS_TTL) || 900 },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, IdentityService],
  // IdentityService is exported so any module that changes a user's status,
  // roles or password can invalidate the cached identity immediately.
  exports: [AuthService, IdentityService],
})
export class AuthModule {}
