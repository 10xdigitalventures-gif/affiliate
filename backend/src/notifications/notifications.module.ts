import { Module } from '@nestjs/common'
import { NotificationsService } from './notifications.service'
import { NotificationsController } from './notifications.controller'

// PrismaService is provided globally, so no PrismaModule import is required.
// Exported so feature modules (commissions, payouts, applications) can inject it.
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
