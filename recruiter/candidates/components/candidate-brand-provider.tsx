"use client"

import { createContext, useEffect, useState } from "react"
import { CANDIDATE_BRANDS, detectCandidateBrandFromHostname, type CandidateBrand } from "@/lib/brand"

export const CandidateBrandContext = createContext<CandidateBrand>(CANDIDATE_BRANDS.seemplify)

export function CandidateBrandProvider({
  children,
  initialBrand,
}: {
  children: React.ReactNode
  initialBrand: CandidateBrand
}) {
  const [brand, setBrand] = useState(initialBrand)

  useEffect(() => {
    setBrand(detectCandidateBrandFromHostname(window.location.hostname))
  }, [])

  return (
    <CandidateBrandContext.Provider value={brand}>
      {children}
    </CandidateBrandContext.Provider>
  )
}
