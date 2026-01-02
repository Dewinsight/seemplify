'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { 
  Bell, 
  Briefcase, 
  Calendar,
  User,
  Mail,
  Building2,
  ExternalLink
} from 'lucide-react';
import notificationService, { Notification } from '@/services/notificationService';
import { useOrganization } from '@/context/OrganizationContext';

const NotificationsPage = () => {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const orgCtx = useOrganization();

  useEffect(() => {
    loadNotifications();
  }, []);

  const loadNotifications = async () => {
    try {
      setIsLoading(true);
      const response = await notificationService.getNotifications({ limit: 50 });
      setNotifications(response.notifications);
    } catch (error: any) {
      console.error('Failed to load notifications:', error);
      toast.error('Failed to load notifications');
      setNotifications([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    try {
      // Mark as read if unread
      if (!notification.read) {
        await notificationService.markAsRead(notification._id);
        setNotifications(prev => 
          prev.map(n => n._id === notification._id ? { ...n, read: true } : n)
        );
      }

      // Switch organization if needed before navigation
      const targetOrgId = notification.organization?.id as string | undefined;
      if (targetOrgId && orgCtx.currentOrganization?._id !== targetOrgId) {
        try {
          await orgCtx.switchOrganization(targetOrgId);
          // Wait a moment for the org switch to fully complete
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {
          console.error('Failed to switch organization from notification page:', e);
          toast.error('Failed to switch organization');
          return; // Don't navigate if org switch failed
        }
      }

      // First, check if the notification has an actionUrl defined
      if (notification.actionUrl) {
        console.log('🔗 Using actionUrl from notification:', notification.actionUrl);
        router.push(notification.actionUrl);
        return;
      }

      // If no actionUrl is defined, navigate based on notification type using switch case
      switch (notification.type) {
        case 'organization_invite':
          console.log('📨 Organization invite notification, navigating to /settings/invitations');
          router.push('/settings/invitations');
          break;
        
        case 'job_created':
        case 'job_posted':
          // Navigate to the specific job if ID is available
          if (notification.data?.jobId) {
            router.push(`/jobs/${notification.data.jobId}`);
          } else {
            router.push('/jobs');
          }
          break;
        
        case 'candidate_uploaded':
        case 'candidate_applied':
          // Navigate to the specific candidate if ID is available
          if (notification.data?.candidateId) {
            router.push(`/candidates/${notification.data.candidateId}`);
          } else {
            router.push('/candidates');
          }
          break;
        
        case 'interview_created':
        case 'interview_scheduled':
          // Navigate to the specific interview transcript if ID is available
          if (notification.data?.interviewId) {
            router.push(`/interviews/${notification.data.interviewId}/transcript`);
          } else {
            router.push('/interviews');
          }
          break;
        
        case 'general':
        default:
          // Default to dashboard for unknown types
          console.log('ℹ️ Default navigation to dashboard');
          router.push('/dashboard');
          break;
      }
    } catch (error) {
      console.error('Failed to handle notification click:', error);
      toast.error('Failed to process notification');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-xl font-semibold md:text-2xl">Notifications</h3>
          <p className="text-sm text-muted-foreground">Loading your notifications...</p>
        </div>
        <Separator />
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="animate-pulse space-y-4">
                  <div className="w-1/3 h-4 bg-gray-200 rounded" />
                  <div className="w-1/2 h-3 bg-gray-200 rounded" />
                  <div className="w-1/4 h-6 bg-gray-200 rounded" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold md:text-2xl">Notifications</h3>
        <p className="text-sm text-muted-foreground">
          View all your notifications.
        </p>
      </div>
      <Separator />

      {notifications.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Bell className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No notifications</h3>
              <p className="text-muted-foreground">
                You don't have any notifications at the moment.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[700px]">
          <div className="space-y-4">
            {notifications.map((notification) => (
              <NotificationCard 
                key={notification._id} 
                notification={notification}
                onClick={() => handleNotificationClick(notification)}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};

// Notification Card Component
interface NotificationCardProps {
  notification: Notification;
  onClick: () => void;
}

const NotificationCard: React.FC<NotificationCardProps> = ({ notification, onClick }) => {
  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'job_created':
      case 'job_posted':
        return <Briefcase className="h-5 w-5 text-blue-600" />;
      case 'candidate_uploaded':
      case 'candidate_applied':
        return <User className="h-5 w-5 text-green-600" />;
      case 'interview_created':
      case 'interview_scheduled':
        return <Calendar className="h-5 w-5 text-purple-600" />;
      case 'organization_invite':
        return <Mail className="h-5 w-5 text-orange-600" />;
      default:
        return <Bell className="h-5 w-5 text-gray-600" />;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours} hour${diffInHours !== 1 ? 's' : ''} ago`;
    if (diffInHours < 48) return 'Yesterday';
    return date.toLocaleDateString();
  };

  return (
    <Card 
      className={`cursor-pointer transition-all hover:shadow-md ${!notification.read ? 'border-l-4 border-l-blue-500' : ''}`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0">
            {getNotificationIcon(notification.type)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="text-sm font-medium text-gray-900 mb-1">
                  {notification.title}
                  {!notification.read && (
                    <Badge variant="secondary" className="ml-2 text-xs">New</Badge>
                  )}
                </h4>
                <p className="text-sm text-gray-600 mb-2">{notification.message}</p>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {notification.organization?.id && (
                    <Badge variant="outline" className="text-[10px] flex items-center gap-1">
                      <Building2 className="h-3 w-3" />
                      {notification.organization?.name || 'Organization'}
                    </Badge>
                  )}
                  <span>{formatTimestamp(notification.createdAt)}</span>
                  {notification.actionText && (
                    <div className="flex items-center gap-1">
                      <ExternalLink className="h-3 w-3" />
                      <span>{notification.actionText}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default NotificationsPage;