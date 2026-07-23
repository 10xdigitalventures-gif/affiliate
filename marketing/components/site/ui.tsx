import Link from 'next/link'
import type { ReactNode } from 'react'

export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={'mx-auto w-full max-w-6xl px-5 sm:px-8 ' + className}>{children}</div>
}

export function Section({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={'py-16 sm:py-24 ' + className}>
      {children}
    </section>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand">
      {children}
    </span>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  center = true,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  center?: boolean
}) {
  return (
    <div className={(center ? 'text-center mx-auto ' : '') + 'max-w-2xl'}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-4xl">{title}</h2>
      {subtitle ? <p className="mt-4 text-lg leading-relaxed text-muted">{subtitle}</p> : null}
    </div>
  )
}

type ButtonProps = {
  href: string
  children: ReactNode
  variant?: 'primary' | 'outline' | 'ghost' | 'white'
  size?: 'md' | 'lg'
  external?: boolean
  className?: string
}

export function Button({ href, children, variant = 'primary', size = 'md', external, className = '' }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2'
  const sizes = size === 'lg' ? 'px-6 py-3 text-base' : 'px-4 py-2.5 text-sm'
  const variants: Record<string, string> = {
    primary: 'bg-brand text-white hover:bg-brand-600 shadow-lift',
    outline: 'border border-line bg-white text-ink hover:border-brand hover:text-brand',
    ghost: 'text-ink hover:bg-brand-50 hover:text-brand',
    white: 'bg-white text-brand hover:bg-brand-50',
  }
  const cls = base + ' ' + sizes + ' ' + variants[variant] + ' ' + className
  if (external) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    )
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={'rounded-2xl border border-line bg-white p-6 shadow-card ' + className}>{children}</div>
}
