'use client'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Check, Globe, MessageSquare, Rss, Twitter, Youtube, Instagram, Linkedin, Facebook } from 'lucide-react'

type Variant = 'primary' | 'outline' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  children: ReactNode
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-ink-2 border border-ink',
  outline: 'bg-surface text-ink border border-line-2 hover:border-ink hover:bg-surface-2',
  ghost: 'bg-transparent text-ink-3 border border-transparent hover:text-ink hover:bg-surface-2',
}

export function Button({ variant = 'outline', children, className = '', ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 h-9 px-4 text-[13px] font-medium rounded-md transition-colors disabled:opacity-40 disabled:pointer-events-none ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function MonoCaption({ children, className = '', title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={`font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-4 ${className}`} title={title}>
      {children}
    </span>
  )
}

export function Badge({ children, muted = false, tone = 'default' }: { children: ReactNode; muted?: boolean; tone?: 'default' | 'err' | 'warn' | 'ok' }) {
  const base = 'inline-flex items-center h-[18px] px-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] rounded-[4px] border'
  let style = muted ? 'border-line text-ink-4 bg-surface-2' : 'border-line-2 text-ink-3 bg-surface'
  if (tone === 'err') style = 'border-ink text-ink bg-surface'
  if (tone === 'warn') style = 'border-line-2 text-ink-2 bg-surface-2'
  if (tone === 'ok') style = 'border-ink text-ink bg-surface'
  return <span className={`${base} ${style}`}>{children}</span>
}

export type DesignSourceType = 'rss' | 'web' | 'reddit' | 'x' | 'youtube' | 'ig' | 'linkedin' | 'fb'

export function SourceGlyph({ type, className = 'h-3.5 w-3.5' }: { type: string; className?: string }) {
  const props = { className, strokeWidth: 1.5 }
  switch (type) {
    case 'reddit':
      return <MessageSquare {...props} />
    case 'x':
      return <Twitter {...props} />
    case 'yt':
    case 'youtube':
      return <Youtube {...props} />
    case 'ig':
      return <Instagram {...props} />
    case 'linkedin':
      return <Linkedin {...props} />
    case 'fb':
      return <Facebook {...props} />
    case 'web':
      return <Globe {...props} />
    case 'rss':
    case 'hn':
    case 'arxiv':
    default:
      return <Rss {...props} />
  }
}

export function Checkbox({ checked, onClick }: { checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
        checked ? 'bg-ink border-ink text-white' : 'bg-surface border-line-2 hover:border-ink'
      }`}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={2.5} />}
    </button>
  )
}
