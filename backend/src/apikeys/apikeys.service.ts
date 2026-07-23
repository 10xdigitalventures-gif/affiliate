import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { createHash, randomBytes } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { CreateApiKeyDto } from './dto/create-apikey.dto'
import { EntitlementsService } from '../entitlements/entitlements.service'

/** Raw key prefix — makes it easy to identify leaked keys. */
const PREFIX = 'aff_live_'

function generateRawKey(): string {
  return PREFIX + randomBytes(24).toString('hex')
}

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Create a new API key. Returns the raw key ONCE — never stored in plaintext. */
  async create(organizationId: string, dto: CreateApiKeyDto) {
    await this.entitlements.assertFeature(organizationId, 'apiAccess')
    await this.entitlements.assertWithinLimit(organizationId, 'apiKeys')
    const raw = generateRawKey()
    const hash = hashKey(raw)
    const record = await this.prisma.apiKey.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        keyHash: hash,
        scopes: dto.scopes ?? ['orders.write'],
      },
    })
    return {
      id: record.id,
      name: record.name,
      scopes: record.scopes,
      createdAt: record.createdAt,
      // Shown only once
      key: raw,
    }
  }

  /** List all API keys for an org (hash never exposed). */
  async list(organizationId: string) {
    return this.prisma.apiKey.findMany({
      where: { organizationId },
      select: { id: true, name: true, scopes: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  /** Revoke (delete) an API key. */
  async revoke(organizationId: string, id: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, organizationId } })
    if (!key) throw new NotFoundException('API key not found')
    await this.prisma.apiKey.delete({ where: { id } })
    return { revoked: true }
  }

  /**
   * Verify a raw API key from an incoming request.
   * Returns the key record + organizationId if valid.
   * Throws UnauthorizedException if not found.
   */
  async verify(rawKey: string) {
    if (!rawKey.startsWith(PREFIX)) throw new UnauthorizedException('Invalid API key')
    const hash = hashKey(rawKey)
    const record = await this.prisma.apiKey.findFirst({
      where: { keyHash: hash },
      include: { organization: true },
    })
    if (!record) throw new UnauthorizedException('Invalid API key')
    if (record.organization.status === 'suspended') {
      throw new UnauthorizedException('Workspace is suspended')
    }
    // Re-check the live subscription on every use. This closes the downgrade
    // bypass where an API key created on a paid plan remained usable forever.
    try {
      await this.entitlements.assertFeature(record.organizationId, 'apiAccess')
    } catch {
      throw new UnauthorizedException('API access is not enabled for this workspace')
    }
    // Fire-and-forget lastUsedAt update
    this.prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
    return record
  }
}
