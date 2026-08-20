import { getApiBaseUrl } from '@/utils/env';
import { tokenManager } from '@/utils/tokenManager';

export async function exitRecruiterToHub(hubUrl: string): Promise<void> {
  const token = tokenManager.getAccessToken();
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/logout`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
      keepalive: true,
    });
    if (!response.ok) throw new Error(`Recruiter logout failed with status ${response.status}`);
    tokenManager.clearTokens();
    localStorage.removeItem('lastSelectedOrg');
    sessionStorage.clear();
    window.location.replace(hubUrl);
  } catch (error) {
    console.error('Recruiter session could not be closed:', error);
    window.alert('Recruiter could not securely close your session. Please try again.');
  }
}
