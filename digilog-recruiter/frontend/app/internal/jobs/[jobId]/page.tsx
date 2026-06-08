"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"

export default function DeprecatedInternalJobPage() {
  const params = useParams()
  const router = useRouter()
  const jobId = params?.jobId as string

  useEffect(() => {
    if (jobId) {
      const timeout = setTimeout(() => {
        router.replace(`/public/jobs/${jobId}`)
      }, 1500)

      return () => clearTimeout(timeout)
    }
  }, [jobId, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Application Link Updated</CardTitle>
          <CardDescription>
            Internal application links are no longer used. Applicants now use the standard job application flow.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Link href={`/public/jobs/${jobId}`} className="w-full sm:w-auto">
            <Button className="w-full sm:w-auto">
              Continue to Job Application
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
