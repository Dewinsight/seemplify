import api from '@/lib/api';

export async function exitAttendanceToHub(hubUrl: string): Promise<void> {
  try {
    await api.post('/auth/logout');
    localStorage.removeItem('access_token');
    sessionStorage.clear();
    window.location.replace(hubUrl);
  } catch (error) {
    console.error('Attendance session could not be closed:', error);
    window.alert('Time & Attendance could not securely close your session. Please try again.');
  }
}
