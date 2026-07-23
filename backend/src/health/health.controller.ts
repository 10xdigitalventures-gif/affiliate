import { Controller, Get, Res } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import type { Response } from 'express'
import { PrismaService } from '../prisma/prisma.service'
import { QueueService } from '../queue/queue.service'

/**
 * Health & readiness probes for load balancers / Docker / Kubernetes.
 * Not rate limited (monitors poll these frequently).
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /** Liveness: process is up. */
  @Get()
  liveness() {
    return { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() }
  }

  /** Readiness: both PostgreSQL and Redis dependencies are reachable. */
  @Get('ready')
  async readiness(@Res({ passthrough: true }) response: Response) {
    const timeout = (label: string) => new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} probe timed out`)), 3_000)
    })
    const database = Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout('database')])
      .then(() => 'up' as const)
      .catch(() => 'down' as const)
    const redis = Promise.race([
      this.queue.queue.client.then((client) => (client as any).ping()),
      timeout('redis'),
    ])
      .then(() => 'up' as const)
      .catch(() => 'down' as const)
    const [db, cache] = await Promise.all([database, redis])
    const ready = db === 'up' && cache === 'up'
    if (!ready) response.status(503)
    return {
      status: ready ? 'ready' : 'degraded',
      db,
      redis: cache,
      timestamp: new Date().toISOString(),
    }
  }
}
