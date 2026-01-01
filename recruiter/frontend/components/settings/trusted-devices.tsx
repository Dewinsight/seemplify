'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { apiRequest } from '@/services/apiConfig'
import { Loader2, Monitor, Smartphone, Tablet, AlertCircle, Check, Trash2, Shield } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { useToast } from '@/hooks/use-toast'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface TrustedDevice {
  id: string
  fingerprint: string
  userAgent: string
  browser: {
    name: string
    version: string
    os: string
    device: string
  }
  ip: string
  lastUsed: string
  createdAt: string
  isCurrent: boolean
}

export function TrustedDevices() {
  const [devices, setDevices] = useState<TrustedDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [removingDevice, setRemovingDevice] = useState<string | null>(null)
  const [showRemoveDialog, setShowRemoveDialog] = useState(false)
  const [deviceToRemove, setDeviceToRemove] = useState<TrustedDevice | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    fetchDevices()
  }, [])

  const fetchDevices = async () => {
    try {
      const response = await apiRequest('/api/trusted-devices', {
        method: 'GET'
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.msg || 'Failed to fetch devices')
      }

      setDevices(data.devices)
    } catch (err: any) {
      setError(err.message)
      toast({
        title: 'Error',
        description: 'Failed to load trusted devices',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveDevice = async (device: TrustedDevice) => {
    setDeviceToRemove(device)
    setShowRemoveDialog(true)
  }

  const confirmRemoveDevice = async () => {
    if (!deviceToRemove) return

    setRemovingDevice(deviceToRemove.id)
    setShowRemoveDialog(false)

    try {
      const response = await apiRequest(`/api/trusted-devices/${deviceToRemove.id}`, {
        method: 'DELETE'
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.msg || 'Failed to remove device')
      }

      // Remove from local state
      setDevices(devices.filter(d => d.id !== deviceToRemove.id))
      
      toast({
        title: 'Device removed',
        description: 'The device has been removed from your trusted devices'
      })
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message,
        variant: 'destructive'
      })
    } finally {
      setRemovingDevice(null)
      setDeviceToRemove(null)
    }
  }

  const handleRemoveAll = async () => {
    if (!confirm('Are you sure you want to remove all trusted devices except the current one?')) {
      return
    }

    setLoading(true)
    try {
      const response = await apiRequest('/api/trusted-devices', {
        method: 'DELETE'
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.msg || 'Failed to remove devices')
      }

      // Refresh the list
      await fetchDevices()
      
      toast({
        title: 'Devices removed',
        description: data.msg
      })
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message,
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const getDeviceIcon = (deviceType: string) => {
    switch (deviceType.toLowerCase()) {
      case 'mobile':
        return <Smartphone className="w-5 h-5" />
      case 'tablet':
        return <Tablet className="w-5 h-5" />
      default:
        return <Monitor className="w-5 h-5" />
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin" />
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Trusted Devices
              </CardTitle>
              <CardDescription>
                Manage devices that can access your account without additional verification
              </CardDescription>
              <p className="text-xs text-amber-600 mt-2">
                Removing a device will immediately sign it out and require a new OTP next time it logs in.
              </p>
            </div>
            {devices.length > 1 && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleRemoveAll}
              >
                Remove All Others
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {devices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No trusted devices found
            </div>
          ) : (
            <div className="space-y-3">
              {devices.map((device) => (
                <div
                  key={device.id}
                  className="flex items-start justify-between p-4 rounded-lg border bg-card"
                >
                  <div className="flex gap-3">
                    <div className="mt-1">
                      {getDeviceIcon(device.browser.device)}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">
                          {device.browser.name} {device.browser.version}
                        </p>
                        {device.isCurrent && (
                          <Badge variant="secondary" className="text-xs">
                            <Check className="w-3 h-3 mr-1" />
                            Current Device
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {device.browser.os} • {device.ip}
                      </p>
                      <div className="text-xs text-muted-foreground">
                        <p>Added: {format(new Date(device.createdAt), 'MMM d, yyyy')}</p>
                        <p>Last used: {formatDistanceToNow(new Date(device.lastUsed), { addSuffix: true })}</p>
                      </div>
                    </div>
                  </div>

                  {!device.isCurrent && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveDevice(device)}
                      disabled={removingDevice === device.id}
                    >
                      {removingDevice === device.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <AlertDialogContent className="sm:max-w-[500px] z-[100] fixed-modal">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove trusted device?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this device? You'll need to verify with OTP next time you log in from this device.
              <div className="mt-3 p-3 rounded bg-muted">
                <p className="font-medium">
                  {deviceToRemove?.browser.name} on {deviceToRemove?.browser.os}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  IP: {deviceToRemove?.ip}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemoveDevice}>
              Remove Device
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
