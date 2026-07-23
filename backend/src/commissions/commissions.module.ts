import { Module } from '@nestjs/common'
import { AuditModule } from '../audit/audit.module'
import { MailModule } from '../mail/mail.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { CommissionsController } from './commissions.controller'
import { CommissionsService } from './commissions.service'
import { CommissionRulesController } from './commission-rules.controller'
import { CommissionRulesService } from './commission-rules.service'

@Module({
  imports: [AuditModule, MailModule, NotificationsModule],
  controllers: [CommissionsController, CommissionRulesController],
  providers: [CommissionsService, CommissionRulesService],
  exports: [CommissionsService, CommissionRulesService],
})
export class CommissionsModule {}
