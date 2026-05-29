"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { CandidateBrandMark } from "@/components/candidate-brand-mark"
import { getAccessToken } from "@/lib/api"
import { useCandidateBrand } from "@/lib/use-candidate-brand"

export default function HomePage() {
  const router = useRouter()
  const brand = useCandidateBrand()

  useEffect(() => {
    router.replace(getAccessToken() ? "/dashboard" : "/login")
  }, [router])

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-soft">
        <CandidateBrandMark brand={brand} compact />
        <span>Opening candidate portal...</span>
      </div>
    </main>
  )
}
