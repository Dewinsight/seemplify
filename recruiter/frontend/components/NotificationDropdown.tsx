'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import {
  Bell,
  BellRing,
  Mail,
  Building2,
  Calendar,
  User,
  Briefcase,
  Check,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import notificationService, { Notification } from '@/services/notificationService';
import { useOrganization } from '@/context/OrganizationContext';

const NotificationDropdown = () => {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const orgCtx = useOrganization();

  const loadNotifications = async () => {
    try {
      setIsLoading(true);
      const response = await notificationService.getNotifications({ limit: 10 });
      console.log('🔍 DEBUG: Full response:', response);
      console.log('🔍 DEBUG: Notifications with org data:', response.notifications.map(n => ({
        id: n._id,
        type: n.type,
        title: n.title,
        organization: n.organization,
        hasOrgId: !!n.organization?.id,
        hasOrgName: !!n.organization?.name
      })));
      setNotifications(response.notifications);
      setUnreadCount(response.unreadCount);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadUnreadCount = async () => {
    try {
      const count = await notificationService.getUnreadCount();
      setUnreadCount(count);
    } catch (error) {
      console.error('Failed to load unread count:', error);
    }
  };

  useEffect(() => {
    loadNotifications();

    // Poll for new notifications every 30 seconds
    const interval = setInterval(loadUnreadCount, 30000);

    return () => clearInterval(interval);
  }, []);

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'organization_invite':
        return <Mail className="w-5 h-5 text-blue-600" />;
      case 'interview_scheduled':
      case 'interview_created':
        return <Calendar className="w-5 h-5 text-green-600" />;
      case 'candidate_applied':
      case 'candidate_uploaded':
        return <User className="w-5 h-5 text-orange-600" />;
      case 'job_posted':
      case 'job_created':
        return <Briefcase className="w-5 h-5 text-purple-600" />;
      default:
        return <Bell className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'border-l-red-500';
      case 'medium': return 'border-l-yellow-500';
      case 'low': return 'border-l-gray-500';
      default: return 'border-l-gray-500';
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInHours = diffInMs / (1000 * 60 * 60);
    const diffInDays = diffInMs / (1000 * 60 * 60 * 24);

    if (diffInHours < 1) {
      const minutes = Math.floor(diffInMs / (1000 * 60));
      return `${minutes}m ago`;
    } else if (diffInHours < 24) {
      return `${Math.floor(diffInHours)}h ago`;
    } else if (diffInDays < 7) {
      return `${Math.floor(diffInDays)}d ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    console.log('🔍 DEBUG: Notification clicked:', {
      id: notification._id,
      type: notification.type,
      title: notification.title,
      organization: notification.organization,
      currentOrg: orgCtx.currentOrganization?._id,
      targetOrg: notification.organization?.id
    });

    try {
      // Mark as read if unread
      if (!notification.read) {
        await notificationService.markAsRead(notification._id);
        setNotifications(prev =>
          prev.map(n => n._id === notification._id ? { ...n, read: true } : n)
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
      }

      // Close dropdown
      setIsOpen(false);

      // If notification belongs to a different org, switch first then navigate
      const targetOrgId = notification.organization?.id as string | undefined;
      console.log('🔍 DEBUG: Org switching check:', {
        targetOrgId,
        currentOrgId: orgCtx.currentOrganization?._id,
        needsSwitch: targetOrgId && orgCtx.currentOrganization?._id !== targetOrgId
      });

      if (targetOrgId && orgCtx.currentOrganization?._id !== targetOrgId) {
        console.log('🔄 DEBUG: Attempting to switch organization...');
        try {
          await orgCtx.switchOrganization(targetOrgId);
          console.log('✅ DEBUG: Organization switch successful');
          // Wait a moment for the org switch to fully complete
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {
          console.error('❌ DEBUG: Failed to switch organization from notification:', e);
          toast.error('Failed to switch organization');
          return; // Don't navigate if org switch failed
        }
      } else {
        console.log('ℹ️ DEBUG: No organization switch needed');
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

  return (
    <>
      <style jsx>{`
        .notification-scroll::-webkit-scrollbar {
          width: 6px;
        }
        .notification-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .notification-scroll::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 10px;
        }
        .notification-scroll::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="relative p-2">
            {unreadCount > 0 ? (
              <BellRing className="h-5 w-5" />
            ) : (
              <Bell className="h-5 w-5" />
            )}
            {unreadCount > 0 && (
              <Badge
                variant="destructive"
                className="absolute -top-2 -right-2 h-6 w-6 rounded-full p-0 flex items-center justify-center text-xs"
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-[420px] p-0 shadow-2xl glass-card border-white/10 rounded-2xl overflow-hidden text-zinc-200">
          {/* Modern Header */}
          <div className="relative bg-transparent border-b border-white/5 px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute inset-0 bg-blue-500 rounded-lg blur-md opacity-20"></div>
                  <div className="relative bg-gradient-to-br from-blue-600/20 to-indigo-600/20 border border-blue-500/20 p-2 rounded-lg">
                    <Bell className="h-4 w-4 text-blue-400" />
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-semibold dark:text-zinc-100 text-gray-900">Notifications</h3>
                  {unreadCount > 0 && (
                    <p className="text-xs text-muted-foreground">{unreadCount} unread message{unreadCount !== 1 ? 's' : ''}</p>
                  )}
                </div>
              </div>
              {unreadCount > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs font-medium text-muted-foreground hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                  onClick={async () => {
                    try {
                      await notificationService.markAllAsRead();
                      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
                      setUnreadCount(0);
                      toast.success('All notifications marked as read');
                    } catch (error) {
                      toast.error('Failed to mark all as read');
                    }
                  }}
                >
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  Mark all read
                </Button>
              )}
            </div>
          </div>

          {/* Notifications List */}
          <div
            className="notification-scroll max-h-[480px] overflow-y-auto bg-transparent"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: '#cbd5e1 #f8fafc'
            }}
          >
            {isLoading ? (
              <div className="py-8 text-center">
                <div className="animate-pulse space-y-3 px-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="p-3 bg-muted/50 rounded-lg">
                      <div className="flex space-x-3">
                        <div className="w-10 h-10 bg-gray-200 rounded-full" />
                        <div className="flex-1 space-y-2">
                          <div className="w-3/4 h-3 bg-gray-200 rounded" />
                          <div className="w-1/2 h-2 bg-gray-200 rounded" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-16 px-8 text-center">
                <div className="relative inline-block mb-4">
                  <div className="absolute inset-0 bg-blue-100 rounded-full blur-xl opacity-50"></div>
                  <div className="relative bg-gradient-to-br from-gray-50 to-gray-100 rounded-full w-16 h-16 flex items-center justify-center">
                    <Bell className="w-8 h-8 text-gray-400" />
                  </div>
                </div>
                <p className="text-sm font-medium text-foreground mb-1">All caught up!</p>
                <p className="text-xs text-muted-foreground">You have no new notifications</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div key={notification._id} className="px-3 py-2 first:pt-3 last:pb-3">
                  <div
                    className={`group relative p-4 rounded-xl cursor-pointer transition-all duration-200 ${!notification.read
                        ? 'bg-white/5 hover:bg-white/10 shadow-sm hover:shadow-md border border-white/10'
                        : 'bg-transparent hover:bg-white/5 border border-transparent hover:border-white/5'
                      }`}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    {/* Priority Indicator */}
                    {notification.priority === 'high' && (
                      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-red-500 to-orange-500 rounded-l-xl" />
                    )}

                    <div className="flex items-start gap-3">
                      {/* Icon */}
                      <div className="flex-shrink-0 relative">
                        <div className={`p-2.5 rounded-xl transition-all ${!notification.read
                            ? 'bg-gradient-to-br from-blue-500/10 to-indigo-500/10 border border-blue-500/10 group-hover:from-blue-500/20 group-hover:to-indigo-500/20'
                            : 'bg-white/5 group-hover:bg-white/10'
                          }`}>
                          {getNotificationIcon(notification.type)}
                        </div>
                        {!notification.read && (
                          <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-600 rounded-full border-2 border-white" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h4 className={`text-sm leading-snug ${!notification.read ? 'font-semibold text-foreground' : 'font-medium text-gray-700'
                            }`}>
                            {notification.title}
                          </h4>
                          <ChevronRight className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
                        </div>

                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mb-2">
                          {notification.message}
                        </p>

                        {/* Meta Info */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="w-3 h-3" />
                            {formatTimeAgo(notification.createdAt)}
                          </span>

                          {notification.organization?.id && (
                            <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-muted/50 text-muted-foreground border-0 font-medium">
                              <Building2 className="h-2.5 w-2.5 mr-1" />
                              {notification.organization?.name || 'Organization'}
                            </Badge>
                          )}

                          {!notification.read && (
                            <Badge className="text-[10px] h-5 px-1.5 bg-blue-600 hover:bg-blue-600 text-white border-0 font-medium">
                              <Sparkles className="h-2.5 w-2.5 mr-0.5" />
                              New
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-100 bg-card px-4 py-3">
            <Button
              variant="ghost"
              className="w-full h-10 justify-center text-sm font-medium text-muted-foreground hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all group"
              onClick={() => {
                setIsOpen(false);
                router.push('/settings/notifications');
              }}
            >
              <span className="flex items-center gap-2">
                <span>View all notifications</span>
                <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};

export default NotificationDropdown;