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
        password: process.env.REDIS_PASSWORD || undefined,
      },
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200 },
    })
    this.logger.log('Webhook retry queue ready')
  }

  /**
   * Enqueue a retry job for a failed webhook event.
   * Exponential backoff for at most three total processing attempts:
   * retry index 0 -> 5s, index 1 -> 30s, then stop.
   */
  async addRetry(eventId: string, retryIndex: number): Promise<void> {
    if (retryIndex >= 2) {
      this.logger.warn(`WebhookEvent ${eventId} exceeded max delivery attempts`)
      return
    }
    const delays = [5_000, 30_000]
    const delay = delays[retryIndex]
    await this.queue.add('retry', { eventId, attempt: retryIndex }, { delay })
    this.logger.log(`Enqueued retry for event ${eventId} in ${delay}ms (attempt ${retryIndex + 2})`)
  }

  async onModuleDestroy() {
    await this.queue.close()
  }
}
