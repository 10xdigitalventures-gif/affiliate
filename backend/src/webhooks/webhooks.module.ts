import { Module } from '@nestjs/common'
import { StoresModule } from '../stores/stores.module'
import { OrdersModule } from '../orders/orders.module'
import { IntegrationsModule } from '../integrations/integrations.module'
import { QueueModule } from '../queue/queue.module'
import { WebhooksController } from './webhooks.controller'
import { WebhooksService } from './webhooks.service'
import { WebhookRetryWorker } from './webhook-retry.worker'

@Module({
  imports: [StoresModule, OrdersModule, IntegrationsModule, QueueModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookRetryWorker],
})
export class WebhooksModule {}
