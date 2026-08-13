import { Controller, Get } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { PrismaService } from '../prisma/prisma.service'

/**
 * Health & readiness probes for load balancers / Docker / Kubernetes.
 * Not rate limited (monitors poll these frequently).
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: process is up. */
  @Get()
  liveness() {
    return { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() }
  }

  /** Readiness: dependencies (DB) reachable. */
  @Get('ready')
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return { status: 'ready', db: 'up' }
    } catch {
      return { status: 'degraded', db: 'down' }
    }
  }
}
