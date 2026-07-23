import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Worker, Job } from 'bullmq'
import { WEBHOOK_RETRY_QUEUE } from '../queue/queue.service'
import { WebhooksService } from './webhooks.service'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class WebhookRetryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('WebhookRetryWorker')
  private worker!: Worker

  constructor(
    private readonly webhooks: WebhooksService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(
      WEBHOOK_RETRY_QUEUE,
      async (job: Job<{ eventId: string; attempt: number }>) => {
        const { eventId, attempt } = job.data
        this.logger.log(`Retrying webhook event ${eventId} (attempt ${attempt + 1})`)

        const event = await this.prisma.webhookEvent.findUnique({ where: { id: eventId } })
        if (!event) { this.logger.warn(`Event ${eventId} not found`); return }
        if (event.status === 'processed') { this.logger.log(`Event ${eventId} already processed`); return }

        await this.webhooks.reprocessEvent(event)
      },
      {
        connection: {
          host: process.env.REDIS_HOST || '127.0.0.1',
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
          password: process.env.REDIS_PASSWORD || undefined,
        },
        concurrency: 3,
      },
    )

    this.worker.on('completed', (job) => {
      this.logger.log(`Retry job ${job.id} completed`)
    })
    this.worker.on('failed', (job, err) => {
      this.logger.error(`Retry job ${job?.id} failed: ${err.message}`)
    })
  }

  async onModuleDestroy() {
    await this.worker?.close()
  }
}
