'use client'
import { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'outline' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const styles: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-600',
  outline: 'border border-line bg-white text-ink hover:bg-gray-50',
  ghost: 'text-muted hover:bg-gray-50',
  danger: 'border border-danger/30 text-danger hover:bg-danger/5',
}

const sizes: Record<Size, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-xs',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-md font-medium transition cursor-pointer disabled:opacity-50 disabled:cursor-default ${sizes[size]} ${styles[variant]} ${className}`}
      {...props}
    />
  )
}
