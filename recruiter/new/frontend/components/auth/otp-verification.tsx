'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { OTPInput } from '@/components/ui/otp-input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Mail, Smartphone, Shield } from 'lucide-react'
import { apiRequest } from '@/services/apiConfig'

interface OTPVerificationProps {
  email: string
  browserInfo?: {
    name?: string
    version?: string
    os?: string
    device?: string
  }
  onSuccess: (token: string, refreshToken: string, user: any, expiresIn?: string) => void
  onCancel: () => void
  initialMessage?: string
}

export function OTPVerification({ email, browserInfo, onSuccess, onCancel, initialMessage }: OTPVerificationProps) {
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(initialMessage || '')
  const [successMessage, setSuccessMessage] = useState('')
  const [resendTimer, setResendTimer] = useState(60)
  const [canResend, setCanResend] = useState(false)
  const otpInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000)
      return () => clearTimeout(timer)
    } else {
      setCanResend(true)
    }
  }, [resendTimer])

  // Ensure the OTP input maintains focus
  useEffect(() => {
    // Focus the input when component mounts
    if (otpInputRef.current && !loading) {
      otpInputRef.current.focus()
    }
  }, [loading])

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccessMessage('')
    setLoading(true)

    try {
      const response = await apiRequest('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.msg || 'Verification failed')
      }

      console.log('OTP verification response:', data)

      // Success - pass token and user data to parent immediately
      setSuccessMessage('Verification successful! Loading your data...')
      // No delay - we'll keep showing the success message during transition
      console.log('Calling onSuccess with token:', data.token)
      onSuccess(data.token, data.refreshToken, data.user, data.expiresIn)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResendOTP = async () => {
    setError('')
    setSuccessMessage('')
    setCanResend(false)
    setResendTimer(60)

    try {
      const response = await apiRequest('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.msg || 'Failed to resend code')
      }

      // Show success message
      setSuccessMessage('New verification code sent successfully!')
      setTimeout(() => setSuccessMessage(''), 5000) // Clear after 5 seconds
    } catch (err: any) {
      // Check if it's a rate limit error
      if (err.message.includes('wait') && err.message.includes('seconds')) {
        // Extract wait time from error message
        const waitTimeMatch = err.message.match(/(\d+)\s*seconds?/);
        const waitTime = waitTimeMatch ? parseInt(waitTimeMatch[1]) : 60;
        setResendTimer(waitTime);
        setError(`Please wait ${waitTime} seconds before requesting a new code. You can still enter your current OTP below.`);
      } else {
        setError(err.message)
        setCanResend(true) // Allow retry on other errors
      }
    }
  }

  const handleOTPChange = (value: string) => {
    setOtp(value)
  }

  const handleCardClick = (e: React.MouseEvent) => {
    // Prevent any click events from bubbling up and potentially causing issues
    e.stopPropagation();
  }

  return (
    <Card className="w-full max-w-md mx-auto" onClick={handleCardClick}>
      <CardHeader>
        <div className="flex items-center justify-center mb-4">
          <Shield className="w-12 h-12 text-primary" />
        </div>
        <CardTitle className="text-2xl text-center">Device Verification</CardTitle>
        <CardDescription className="text-center">
          {initialMessage?.includes('Please wait') 
            ? 'You have an active verification code. Please enter it below.'
            : 'We detected a login from a new device. Please enter the verification code sent to your email.'
          }
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {browserInfo && (
          <div className="bg-muted p-3 rounded-lg text-sm">
            <p className="font-semibold mb-1">New Device Detected:</p>
            <p><Smartphone className="w-4 h-4 inline mr-1" /> {browserInfo.device || 'Desktop'}</p>
            <p>{browserInfo.name} {browserInfo.version}</p>
            <p>{browserInfo.os}</p>
          </div>
        )}

        {!initialMessage?.includes('Please wait') && (
          <Alert>
            <Mail className="h-4 w-4" />
            <AlertDescription>
              Verification code sent to: <strong>{email}</strong>
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleVerifyOTP} className="space-y-4" onClick={(e) => e.stopPropagation()}>
          <div>
            <label htmlFor="otp" className="block text-sm font-medium mb-1">
              Enter 6-digit code
            </label>
            <OTPInput
              ref={otpInputRef}
              id="otp"
              placeholder="000000"
              value={otp}
              onChange={handleOTPChange}
              className="text-center text-2xl tracking-widest"
              required
              autoFocus={true}
              disabled={loading}
              length={6}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
          </div>

          {successMessage && (
            <Alert className="border-green-500 bg-green-50 text-green-900">
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          )}
          
          {error && (
            <Alert variant={error.includes('Please wait') ? 'default' : 'destructive'}>
              <AlertDescription>
                {error}
                {error.includes('Please wait') && (
                  <div className="mt-2 space-y-1">
                    <p className="font-medium">💡 You can still enter your existing OTP code.</p>
                    <p className="text-sm text-muted-foreground">
                      If you have a verification code from the last 5 minutes, you can enter it above.
                    </p>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          <Button 
            type="submit" 
            className="w-full" 
            disabled={loading || otp.length !== 6}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Verify Device
          </Button>
        </form>

        <div className="text-center text-sm">
          <p className="text-muted-foreground">
            Didn't receive the code?{' '}
            {canResend ? (
              <button
                type="button"
                onClick={handleResendOTP}
                className="text-primary hover:underline"
              >
                Resend code
              </button>
            ) : (
              <span className="text-muted-foreground">
                Resend in {resendTimer}s
              </span>
            )}
          </p>
        </div>
      </CardContent>

      <CardFooter>
        <Button 
          variant="outline" 
          className="w-full" 
          onClick={onCancel}
          disabled={loading}
        >
          Cancel Login
        </Button>
      </CardFooter>
    </Card>
  )
}
