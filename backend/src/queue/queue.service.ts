import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { Queue } from 'bullmq'

export const WEBHOOK_RETRY_QUEUE = 'webhook-retry'

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger('QueueService')
  readonly queue: Queue

  constructor() {
    this.queue = new Queue(WEBHOOK_RETRY_QUEUE, {
      connection: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200 },
    })
    this.logger.log('Webhook retry queue ready')
  }

  /**
   * Enqueue a retry job for a failed webhook event.
   * Exponential backoff: attempt 0 -> 5s, 1 -> 30s, 2 -> 5min (last try).
   */
  async addRetry(eventId: string, attempt: number): Promise<void> {
    if (attempt >= 3) {
      this.logger.warn(`WebhookEvent ${eventId} exceeded max retries`)
      return
    }
    const delays = [5_000, 30_000, 300_000]
    const delay = delays[attempt] ?? 300_000
    await this.queue.add('retry', { eventId, attempt }, { delay })
    this.logger.log(`Enqueued retry for event ${eventId} in ${delay}ms (attempt ${attempt + 1})`)
  }

  async onModuleDestroy() {
    await this.queue.close()
  }
}
