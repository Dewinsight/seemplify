"use client"

import { createContext, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { CANDIDATE_BRANDS, detectCandidateBrandFromHostname, type CandidateBrand } from "@/lib/brand"

export const CandidateBrandContext = createContext<CandidateBrand>(CANDIDATE_BRANDS.seemplify)

export function CandidateBrandProvider({
  children,
  initialBrand,
}: {
  children: ReactNode
  initialBrand: CandidateBrand
}) {
  const [brand, setBrand] = useState(initialBrand)

  useEffect(() => {
    const requestedBrand = new URLSearchParams(window.location.search).get("brand")
    if (requestedBrand === "akwa-ibom" || requestedBrand === "akwa") {
      setBrand(CANDIDATE_BRANDS["akwa-ibom"])
      return
    }
    if (requestedBrand === "seemplify") {
      setBrand(CANDIDATE_BRANDS.seemplify)
      return
    }
    setBrand(detectCandidateBrandFromHostname(window.location.hostname))
  }, [])

  return (
    <CandidateBrandContext.Provider value={brand}>
      {children}
    </CandidateBrandContext.Provider>
  )
}
