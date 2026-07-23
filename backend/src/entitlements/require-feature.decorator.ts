import { SetMetadata } from '@nestjs/common'
import type { FeatureKey } from './entitlements.constants'

export const FEATURE_KEY = 'requiredFeature'

/**
 * Gate a route behind a plan feature flag. Use together with FeatureGuard:
 *   @UseGuards(JwtAuthGuard, FeatureGuard)
 *   @RequireFeature('customDomain')
 */
export const RequireFeature = (feature: FeatureKey) => SetMetadata(FEATURE_KEY, feature)
