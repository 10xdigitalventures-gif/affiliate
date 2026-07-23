import { Radar, Percent, GitBranch, Wallet, ShieldCheck, BarChart3, Palette, Users } from 'lucide-react'
import type { LucideProps } from 'lucide-react'

const map: Record<string, React.ComponentType<LucideProps>> = {
  Radar,
  Percent,
  GitBranch,
  Wallet,
  ShieldCheck,
  BarChart3,
  Palette,
  Users,
}

export function FeatureIcon({ name, ...props }: { name: string } & LucideProps) {
  const C = map[name] || Radar
  return <C {...props} />
}
