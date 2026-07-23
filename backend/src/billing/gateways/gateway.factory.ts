import { Injectable } from '@nestjs/common'
import type { PaymentGatewayConfig } from '@prisma/client'
import { CryptoService } from '../../common/crypto/crypto.service'
import { GatewayCredentials, PaymentGateway } from './gateway.types'
import { WhopGateway } from './whop.gateway'
import { SwichGateway } from './swich.gateway'

/**
 * Builds a concrete PaymentGateway from a stored config row, decrypting the
 * API key + webhook secret on the fly. Add new providers here.
 */
@Injectable()
export class GatewayFactory {
  constructor(private readonly crypto: CryptoService) {}

  credentialsFor(config: PaymentGatewayConfig): GatewayCredentials {
    return {
      provider: config.provider as GatewayCredentials['provider'],
      companyId: config.companyId ?? null,
      apiKey: config.apiKeyEnc ? this.crypto.decrypt(Buffer.from(config.apiKeyEnc)) : null,
      webhookSecret: config.webhookSecretEnc ? this.crypto.decrypt(Buffer.from(config.webhookSecretEnc)) : null,
      isLive: config.isLive,
    }
  }

  build(config: PaymentGatewayConfig): PaymentGateway {
    const creds = this.credentialsFor(config)
    switch (config.provider) {
      case 'whop':
        return new WhopGateway(creds)
      case 'swich':
        return new SwichGateway(creds)
      default:
        throw new Error(`Unsupported gateway provider: ${config.provider}`)
    }
  }
}
