import type { CandidateBrand } from "@/lib/brand"

interface CandidateBrandMarkProps {
  brand: CandidateBrand
  compact?: boolean
}

export function CandidateBrandMark({ brand, compact = false }: CandidateBrandMarkProps) {
  if (brand.logoUrl) {
    return (
      <img
        src={brand.logoUrl}
        alt={brand.organizationName}
        className={compact ? "h-10 w-auto max-w-[160px] object-contain" : "h-14 w-auto max-w-[240px] object-contain"}
      />
    )
  }

  return (
    <div
      className={
        compact
          ? "flex h-10 w-10 items-center justify-center rounded-md bg-slate-950 text-sm font-semibold text-white"
          : "flex h-14 w-14 items-center justify-center rounded-md bg-slate-950 text-base font-semibold text-white"
      }
    >
      {brand.shortName}
    </div>
  )
}
