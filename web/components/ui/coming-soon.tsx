import { PageHeader } from './page-header'

export function ComingSoon({ title, subtitle, phase }: { title: string; subtitle: string; phase: string }) {
  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader title={title} subtitle={subtitle} />
      <div className="rounded-lg border border-dashed border-line bg-white grid place-items-center h-48 text-center">
        <div>
          <p className="text-sm font-medium">Coming in {phase}</p>
          <p className="text-xs text-muted mt-0.5">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}
