import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateAffiliateDto } from './create-affiliate.dto'

describe('CreateAffiliateDto', () => {
  it('normalizes and accepts safe affiliate identifiers', async () => {
    const dto = plainToInstance(CreateAffiliateDto, {
      affiliateCode: ' summer_10 ',
      referralSlug: ' Offer-10 ',
    })

    await expect(validate(dto)).resolves.toHaveLength(0)
    expect(dto.affiliateCode).toBe('SUMMER_10')
    expect(dto.referralSlug).toBe('offer-10')
  })

  it('rejects path-like and script-like identifiers', async () => {
    const dto = plainToInstance(CreateAffiliateDto, {
      affiliateCode: '../ADMIN',
      referralSlug: '<script>',
    })

    expect(await validate(dto)).toHaveLength(2)
  })
})
