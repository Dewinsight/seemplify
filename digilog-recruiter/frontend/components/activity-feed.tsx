"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Bell, Clock, Users, Briefcase, Calendar, FileText, User } from "lucide-react"
import { useEffect, useState } from "react"
import notificationService, { Notification } from "@/services/notificationService"
import { Skeleton } from "@/components/ui/skeleton"

export function ActivityFeed() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadNotifications = async () => {
      try {
        setLoading(true)
        const response = await notificationService.getNotifications({ limit: 10 })
        setNotifications(response.notifications)
      } catch (error) {
        console.error('Failed to load notifications:', error)
      } finally {
        setLoading(false)
      }
    }

    loadNotifications()
  }, [])

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))
    
    if (diffInHours < 1) return 'Just now'
    if (diffInHours < 24) return `${diffInHours} hour${diffInHours !== 1 ? 's' : ''} ago`
    if (diffInHours < 48) return 'Yesterday'
    return date.toLocaleDateString()
  }

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'interview_scheduled':
      case 'interview_created':
        return <Calendar className="h-4 w-4" />
      case 'candidate_applied':
      case 'candidate_uploaded':
        return <User className="h-4 w-4" />
      case 'job_posted':
      case 'job_created':
        return <Briefcase className="h-4 w-4" />
      case 'organization_invite':
        return <Users className="h-4 w-4" />
      default:
        return <Bell className="h-4 w-4" />
    }
  }

  const getBadgeVariant = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'destructive'
      case 'medium':
        return 'default'
      case 'low':
      default:
        return 'secondary'
    }
  }

  if (loading) {
    return (
      <ScrollArea className="h-[300px] pr-4">
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    )
  }

  if (notifications.length === 0) {
    return (
      <ScrollArea className="h-[300px] pr-4">
        <div className="flex flex-col items-center justify-center h-full text-center">
          <Bell className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No notifications yet</p>
          <p className="text-sm text-muted-foreground">Notifications will appear here as things happen</p>
        </div>
      </ScrollArea>
    )
  }

  return (
    <ScrollArea className="h-[300px] pr-4" data-tutorial="dashboard-activity-inner">
      <div className="space-y-4">
        {notifications.map((notification) => (
          <div key={notification._id} className={`flex gap-3 p-3 rounded-lg transition-colors ${!notification.read ? 'bg-blue-50 dark:bg-blue-950/20' : 'hover:bg-muted/50'}`}>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
              {getNotificationIcon(notification.type)}
            </div>
            <div className="flex-1 space-y-1">
              <div className="text-sm">
                <span className="font-medium">{notification.title}</span>
                {!notification.read && (
                  <div className="h-2 w-2 bg-blue-500 rounded-full inline-block ml-2"></div>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{notification.message}</p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">{formatTime(notification.createdAt)}</p>
                <Badge variant={getBadgeVariant(notification.priority)} className="text-xs">
                  {notification.priority}
                </Badge>
              </div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
