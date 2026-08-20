import api from '@/lib/api';

export async function exitPerformanceToHub(hubUrl: string): Promise<void> {
  try {
    await api.post('/auth/logout');
    localStorage.removeItem('accessToken');
    sessionStorage.clear();
    window.location.replace(hubUrl);
  } catch (error) {
    console.error('Performance session could not be closed:', error);
    window.alert('Performance Management could not securely close your session. Please try again.');
  }
}
