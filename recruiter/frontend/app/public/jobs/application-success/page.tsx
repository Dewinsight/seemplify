"use client"

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  CheckCircle, 
  Mail, 
  Calendar, 
  Clock, 
  ArrowRight,
  Home,
  ExternalLink,
  FileText
} from 'lucide-react'
import Link from 'next/link'

function ApplicationSuccessContent() {
  const searchParams = useSearchParams()
  const jobTitle = searchParams.get('jobTitle') || 'the position'
  const candidateName = searchParams.get('candidateName') || 'Applicant'
  const email = searchParams.get('email') || ''

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Success Animation */}
        <div className="text-center mb-8">
          <div className="relative inline-block">
            <div className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
              <CheckCircle className="h-12 w-12 text-white" />
            </div>
            <div className="absolute inset-0 w-24 h-24 bg-green-500 rounded-full animate-ping opacity-20 mx-auto"></div>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Application Submitted!
          </h1>
          <p className="text-xl text-gray-600">
            Thank you for your interest in joining our team
          </p>
        </div>

        {/* Main Card */}
        <Card className="border-0 bg-white/80 backdrop-blur-xl shadow-2xl">
          <CardHeader className="bg-gradient-to-r from-green-500 to-blue-600 text-white rounded-t-lg">
            <CardTitle className="text-2xl font-semibold">
              Application Confirmation
            </CardTitle>
            <CardDescription className="text-green-100">
              Your application has been successfully submitted and is being reviewed
            </CardDescription>
          </CardHeader>
          <CardContent className="p-8 space-y-6">
            {/* Application Details */}
            <div className="bg-gradient-to-r from-green-50 to-blue-50 p-6 rounded-lg border border-green-200">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <FileText className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    Application Details
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-600">Position:</span>
                      <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                        {jobTitle}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-600">Applicant:</span>
                      <span className="text-sm font-semibold text-gray-900">{candidateName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-600">Email:</span>
                      <span className="text-sm text-gray-700">{email}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-600">Submitted:</span>
                      <span className="text-sm text-gray-700">
                        {new Date().toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* What Happens Next */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <ArrowRight className="h-5 w-5 text-blue-500" />
                What happens next?
              </h3>
              
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <Mail className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">Email Confirmation</h4>
                    <p className="text-sm text-gray-600">
                      You'll receive a confirmation email shortly with your application details.
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                  <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <Clock className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">Application Review</h4>
                    <p className="text-sm text-gray-600">
                      Our recruitment team will review your application within 3-5 business days.
                    </p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3 p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <Calendar className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">Next Steps</h4>
                    <p className="text-sm text-gray-600">
                      If your profile matches our requirements, we'll contact you to schedule an interview.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Important Notes */}
            <div className="bg-gray-50 p-6 rounded-lg border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
                Important Notes
              </h3>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full mt-2 flex-shrink-0"></div>
                  <span>Please check your email regularly, including your spam folder.</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full mt-2 flex-shrink-0"></div>
                  <span>Our typical response time is 3-5 business days.</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full mt-2 flex-shrink-0"></div>
                  <span>You can apply to other positions on our careers page if you're interested in multiple roles.</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full mt-2 flex-shrink-0"></div>
                  <span>If you have any questions, feel free to contact our HR team.</span>
                </li>
              </ul>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 pt-4">
              <Button
                asChild
                className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700"
              >
                <Link href="/">
                  <Home className="h-4 w-4 mr-2" />
                  Back to Homepage
                </Link>
              </Button>
              
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => window.print()}
              >
                <FileText className="h-4 w-4 mr-2" />
                Print Confirmation
              </Button>
            </div>

            {/* Contact Information */}
         
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center mt-8 text-sm text-muted-foreground">
          <p>Thank you for choosing to be part of our team!</p>
        </div>
      </div>
    </div>
  )
}

function ApplicationSuccessLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
            <CheckCircle className="h-12 w-12 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Application Submitted!
          </h1>
          <p className="text-xl text-gray-600">
            Loading confirmation details...
          </p>
        </div>
        <Card className="border-0 bg-white/80 backdrop-blur-xl shadow-2xl">
          <CardHeader className="bg-gradient-to-r from-green-500 to-blue-600 text-white rounded-t-lg">
            <CardTitle className="text-2xl font-semibold">
              Application Confirmation
            </CardTitle>
            <CardDescription className="text-green-100">
              Loading your application details...
            </CardDescription>
          </CardHeader>
          <CardContent className="p-8">
            <div className="animate-pulse space-y-4">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              <div className="h-4 bg-gray-200 rounded w-2/3"></div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function ApplicationSuccessPage() {
  return (
    <Suspense fallback={<ApplicationSuccessLoading />}>
      <ApplicationSuccessContent />
    </Suspense>
  )
} 