import { createHmac } from 'crypto'
import { GatewayError } from './gateway.types'
import { WhopGateway } from './whop.gateway'

function signedRequest(ageSeconds = 0, companyId = 'biz_test') {
  const secretBytes = Buffer.alloc(32, 7)
  const secret = `whsec_${secretBytes.toString('base64')}`
  const id = 'msg_test_123'
  const timestamp = String(Math.floor(Date.now() / 1000) - ageSeconds)
  const rawBody = JSON.stringify({ id, type: 'invoice.paid', company_id: companyId, data: { id: 'inv_1' } })
  const signature = createHmac('sha256', secretBytes)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64')
  return {
    gateway: new WhopGateway({ provider: 'whop', companyId: 'biz_test', webhookSecret: secret, isLive: false }),
    request: {
      rawBody,
      headers: {
        'webhook-id': id,
        'webhook-timestamp': timestamp,
        'webhook-signature': `v1,${signature}`,
      },
    },
  }
}

describe('WhopGateway webhook verification', () => {
  it('accepts a current Standard Webhooks signature', () => {
    const { gateway, request } = signedRequest()
    expect(gateway.verifyAndParseWebhook(request)).toMatchObject({
      id: 'msg_test_123',
      type: 'invoice.paid',
      data: { id: 'inv_1' },
    })
  })

  it('rejects a correctly signed but stale replay', () => {
    const { gateway, request } = signedRequest(601)
    expect(() => gateway.verifyAndParseWebhook(request)).toThrow(GatewayError)
  })

  it('rejects an event for a different configured company', () => {
    const { gateway, request } = signedRequest(0, 'biz_other')
    expect(() => gateway.verifyAndParseWebhook(request)).toThrow('company does not match')
  })
})
