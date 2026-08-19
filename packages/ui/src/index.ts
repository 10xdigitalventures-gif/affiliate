/**
 * @affiliate/ui - Shared component library
 *
 * Usage in web/ or portal/:
 *   import { Button, Badge, Card } from '@affiliate/ui'
 *
 * Add this package to workspace:
 *   web/package.json: { "dependencies": { "@affiliate/ui": "workspace:*" } }
 */

// Re-export primitive components
export { Button, type ButtonProps } from './components/button'
export { Badge,  type BadgeProps  } from './components/badge'
export { Card,   type CardProps   } from './components/card'
export { Input,  type InputProps  } from './components/input'
