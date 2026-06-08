import { apiRequest } from './apiConfig';

interface Notification {
  _id: string;
  user: string;
  type: 'organization_invite' | 'interview_scheduled' | 'interview_created' | 'candidate_applied' | 'candidate_uploaded' | 'job_posted' | 'job_created' | 'people_transition_started' | 'people_transition_action' | 'people_transition_completed' | 'general';
  title: string;
  message: string;
  data: any;
  read: boolean;
  actionUrl?: string;
  actionText?: string;
  priority: 'low' | 'medium' | 'high';
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  organization?: { id: string | null; name: string | null };
}

interface NotificationResponse {
  notifications: Notification[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
  unreadCount: number;
}

interface UnreadCountResponse {
  count: number;
}

class NotificationService {
  /**
   * Get user notifications
   */
  async getNotifications(params?: {
    page?: number;
    limit?: number;
    unreadOnly?: boolean;
  }): Promise<NotificationResponse> {
    console.log('🔔 NotificationService.getNotifications called with:', params);
    
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.unreadOnly) queryParams.append('unreadOnly', 'true');

      const url = `/api/notifications${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      const response = await apiRequest(url);

      console.log('📡 Get notifications response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Get notifications error:', error);
        throw new Error(error.msg || 'Failed to fetch notifications');
      }

      const result = await response.json();
      console.log('✅ Notifications fetched:', result);
      return result;
    } catch (error) {
      console.error('❌ NotificationService.getNotifications error:', error);
      throw error;
    }
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(): Promise<number> {
    console.log('🔢 NotificationService.getUnreadCount called');
    
    try {
      const response = await apiRequest(`/api/notifications/unread-count`);

      console.log('📡 Get unread count response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Get unread count error:', error);
        throw new Error(error.msg || 'Failed to fetch unread count');
      }

      const result: UnreadCountResponse = await response.json();
      console.log('✅ Unread count fetched:', result.count);
      return result.count;
    } catch (error) {
      console.error('❌ NotificationService.getUnreadCount error:', error);
      throw error;
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string): Promise<void> {
    console.log('👁️ NotificationService.markAsRead called with:', notificationId);
    
    try {
      const response = await apiRequest(`/api/notifications/${notificationId}/read`, {
        method: 'PUT',
      });

      console.log('📡 Mark as read response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Mark as read error:', error);
        throw new Error(error.msg || 'Failed to mark notification as read');
      }

      console.log('✅ Notification marked as read');
    } catch (error) {
      console.error('❌ NotificationService.markAsRead error:', error);
      throw error;
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(): Promise<void> {
    console.log('👁️‍🗨️ NotificationService.markAllAsRead called');
    
    try {
      const response = await apiRequest(`/api/notifications/mark-all-read`, {
        method: 'PUT',
      });

      console.log('📡 Mark all as read response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Mark all as read error:', error);
        throw new Error(error.msg || 'Failed to mark all notifications as read');
      }

      console.log('✅ All notifications marked as read');
    } catch (error) {
      console.error('❌ NotificationService.markAllAsRead error:', error);
      throw error;
    }
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId: string): Promise<void> {
    console.log('🗑️ NotificationService.deleteNotification called with:', notificationId);
    
    try {
      const response = await apiRequest(`/api/notifications/${notificationId}`, {
        method: 'DELETE',
      });

      console.log('📡 Delete notification response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Delete notification error:', error);
        throw new Error(error.msg || 'Failed to delete notification');
      }

      console.log('✅ Notification deleted');
    } catch (error) {
      console.error('❌ NotificationService.deleteNotification error:', error);
      throw error;
    }
  }

  /**
   * Create test notification (for development)
   */
  async createTestNotification(data: {
    title: string;
    message: string;
    type?: string;
  }): Promise<Notification> {
    console.log('🧪 NotificationService.createTestNotification called with:', data);
    
    try {
      const response = await apiRequest(`/api/notifications/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      console.log('📡 Create test notification response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Create test notification error:', error);
        throw new Error(error.msg || 'Failed to create test notification');
      }

      const result = await response.json();
      console.log('✅ Test notification created:', result);
      return result;
    } catch (error) {
      console.error('❌ NotificationService.createTestNotification error:', error);
      throw error;
    }
  }

  /**
   * Get recent activities for dashboard
   */
  async getRecentActivities(limit: number = 10): Promise<{activities: any[], count: number}> {
    console.log('📊 NotificationService.getRecentActivities called with limit:', limit);
    
    try {
      const response = await apiRequest(`/api/notifications/recent-activities?limit=${limit}`);

      console.log('📡 Get recent activities response status:', response.status);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Get recent activities error:', error);
        throw new Error(error.msg || 'Failed to fetch recent activities');
      }

      const result = await response.json();
      console.log('✅ Recent activities fetched:', result);
      return result;
    } catch (error) {
      console.error('❌ NotificationService.getRecentActivities error:', error);
      throw error;
    }
  }
}

export type { Notification, NotificationResponse };
export default new NotificationService();
