import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CryptoService } from '../common/crypto/crypto.service'
import { ConnectStoreDto } from './dto/connect-store.dto'
import { EntitlementsService } from '../entitlements/entitlements.service'

@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async connect(organizationId: string, dto: ConnectStoreDto) {
    await this.entitlements.assertWithinLimit(organizationId, 'stores')
    const store = await this.prisma.store.create({
      data: {
        organizationId,
        platform: dto.platform,
        name: dto.name,
        domain: dto.domain,
        status: 'connected',
        webhookStatus: 'pending',
      },
    })
    await this.prisma.storeCredential.create({
      data: {
        storeId: store.id,
        accessTokenEnc: dto.accessToken ? this.crypto.encrypt(dto.accessToken) : null,
        consumerKeyEnc: dto.consumerKey ? this.crypto.encrypt(dto.consumerKey) : null,
        consumerSecretEnc: dto.consumerSecret ? this.crypto.encrypt(dto.consumerSecret) : null,
        webhookSecretEnc: dto.webhookSecret ? this.crypto.encrypt(dto.webhookSecret) : null,
        scopes: dto.scopes ?? [],
      },
    })
    return store
  }

  async list(organizationId: string) {
    return this.prisma.store.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' } })
  }

  async get(organizationId: string, id: string) {
    const store = await this.prisma.store.findFirst({ where: { id, organizationId } })
    if (!store) throw new NotFoundException('Store not found')
    return store
  }

  /** Returns the store (scoped by webhook route) with its decrypted webhook secret. */
  async getForWebhook(storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: { credentials: true },
    })
    if (!store) return null
    const secretEnc = store.credentials?.webhookSecretEnc
    return {
      store,
      webhookSecret: secretEnc ? this.crypto.decrypt(Buffer.from(secretEnc)) : null,
    }
  }

  async recordSync(storeId: string, status: 'connected' | 'error') {
    return this.prisma.store.update({
      where: { id: storeId },
      data: { status, lastSyncedAt: new Date(), webhookStatus: status === 'connected' ? 'healthy' : 'error' },
    })
  }

  /** Mark a store disconnected (e.g. Shopify app/uninstalled webhook). */
  async markDisconnected(storeId: string) {
    return this.prisma.store.update({
      where: { id: storeId },
      data: { status: 'disconnected', webhookStatus: 'error' },
    })
  }

  /**
   * Idempotent connect used by the Shopify OAuth app and self-registering
   * plugins (WooCommerce / custom). Upserts by (org, platform, domain) so a
   * re-install refreshes credentials instead of creating a duplicate store.
   * The plan's store limit is enforced only when creating a brand-new store.
   */
  async upsertConnected(
    organizationId: string,
    input: {
      platform: 'shopify' | 'woocommerce' | 'ghl' | 'custom'
      name: string
      domain: string
      accessToken?: string | null
      consumerKey?: string | null
      consumerSecret?: string | null
      webhookSecret?: string | null
      scopes?: string[]
    },
  ) {
    const existing = await this.prisma.store.findFirst({
      where: { organizationId, platform: input.platform as any, domain: input.domain },
    })

    let store
    if (existing) {
      store = await this.prisma.store.update({
        where: { id: existing.id },
        data: { name: input.name, status: 'connected', webhookStatus: 'healthy', lastSyncedAt: new Date() },
      })
    } else {
      await this.entitlements.assertWithinLimit(organizationId, 'stores')
      store = await this.prisma.store.create({
        data: {
          organizationId,
          platform: input.platform as any,
          name: input.name,
          domain: input.domain,
          status: 'connected',
          webhookStatus: 'healthy',
          lastSyncedAt: new Date(),
        },
      })
    }

    // Only overwrite credential fields that were explicitly provided.
    const update: Record<string, unknown> = { rotatedAt: new Date() }
    if (input.accessToken !== undefined)
      update.accessTokenEnc = input.accessToken ? this.crypto.encrypt(input.accessToken) : null
    if (input.consumerKey !== undefined)
      update.consumerKeyEnc = input.consumerKey ? this.crypto.encrypt(input.consumerKey) : null
    if (input.consumerSecret !== undefined)
      update.consumerSecretEnc = input.consumerSecret ? this.crypto.encrypt(input.consumerSecret) : null
    if (input.webhookSecret !== undefined)
      update.webhookSecretEnc = input.webhookSecret ? this.crypto.encrypt(input.webhookSecret) : null
    if (input.scopes !== undefined) update.scopes = input.scopes

    await this.prisma.storeCredential.upsert({
      where: { storeId: store.id },
      create: {
        storeId: store.id,
        accessTokenEnc: input.accessToken ? this.crypto.encrypt(input.accessToken) : null,
        consumerKeyEnc: input.consumerKey ? this.crypto.encrypt(input.consumerKey) : null,
        consumerSecretEnc: input.consumerSecret ? this.crypto.encrypt(input.consumerSecret) : null,
        webhookSecretEnc: input.webhookSecret ? this.crypto.encrypt(input.webhookSecret) : null,
        scopes: input.scopes ?? [],
      },
      update: update as any,
    })

    return store
  }
}
