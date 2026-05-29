"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { getAccessToken } from "@/lib/api"

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    router.replace(getAccessToken() ? "/dashboard" : "/login")
  }, [router])

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="rounded-md border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-soft">
        Opening candidate portal...
      </div>
    </main>
  )
}
