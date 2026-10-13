// Brand mark: dark tile, mint facet with three inner edges (same as favicon / app icon).
export function Logo({ size = 20 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <rect width="64" height="64" rx="14" className="fill-surface-3" />
      <path d="M32 10 52 25.2 44.4 48H19.6L12 25.2Z" className="fill-accent" />
      <path d="M32 10v38M12 25.2 32 48l20-22.8" className="stroke-surface-3" strokeWidth="3" fill="none" />
    </svg>
  )
}
