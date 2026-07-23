import { Module } from '@nestjs/common'
import { PayoutsService } from './payouts.service'
import { PayoutsController } from './payouts.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { AuditModule } from '../audit/audit.module'
import { MailModule } from '../mail/mail.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { PayoutProviderService } from './providers/payout-provider.service'
import { StripePayoutProvider } from './providers/stripe.provider'
import { WisePayoutProvider } from './providers/wise.provider'
import { PayPalPayoutProvider } from './providers/paypal.provider'
import { ManualPayoutProvider } from './providers/manual.provider'
import { TaxModule } from '../tax/tax.module'

@Module({
  imports: [PrismaModule, AuditModule, MailModule, NotificationsModule, TaxModule],
  controllers: [PayoutsController],
  providers: [
    PayoutsService,
    PayoutProviderService,
    StripePayoutProvider,
    WisePayoutProvider,
    PayPalPayoutProvider,
    ManualPayoutProvider,
  ],
  exports: [PayoutsService],
})
export class PayoutsModule {}
