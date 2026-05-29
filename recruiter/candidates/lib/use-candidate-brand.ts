"use client"

import { useContext } from "react"
import { CandidateBrandContext } from "@/components/candidate-brand-provider"

export function useCandidateBrand() {
  return useContext(CandidateBrandContext)
}
