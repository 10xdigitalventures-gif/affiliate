import { Module } from '@nestjs/common'
import { ApplicationsService } from './applications.service'
import { ApplicationsController } from './applications.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { MailModule } from '../mail/mail.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [PrismaModule, MailModule, NotificationsModule, AuthModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
