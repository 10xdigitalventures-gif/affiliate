import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { TrackClickDto } from './track-click.dto'

describe('TrackClickDto', () => {
  it('trims the referral and accepts the documented browser beacon fields', async () => {
    const dto = plainToInstance(TrackClickDto, {
      ref: '  PARTNER-1  ',
      org: '123e4567-e89b-42d3-a456-426614174000',
      u: 'https://store.example/products/one',
      utm_source: 'newsletter',
      gclid: 'click-id',
    })
    await expect(validate(dto)).resolves.toHaveLength(0)
    expect(dto.ref).toBe('PARTNER-1')
  })

  it('rejects oversized or malformed public identifiers', async () => {
    const dto = plainToInstance(TrackClickDto, {
      ref: 'R'.repeat(65),
      org: 'not-an-organization-id',
    })
    expect((await validate(dto)).length).toBeGreaterThanOrEqual(2)
  })
})
