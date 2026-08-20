import api from '@/lib/api';

export async function exitLeaveToHub(hubUrl: string): Promise<void> {
  try {
    await api.post('/auth/logout');
    localStorage.removeItem('accessToken');
    sessionStorage.clear();
    window.location.replace(hubUrl);
  } catch (error) {
    console.error('Leave session could not be closed:', error);
    window.alert('Leave Management could not securely close your session. Please try again.');
  }
}
