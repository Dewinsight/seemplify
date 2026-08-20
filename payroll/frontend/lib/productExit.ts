import api from '@/lib/api';

export async function exitPayrollToHub(hubUrl: string): Promise<void> {
  try {
    await api.post('/auth/logout');
    localStorage.removeItem('accessToken');
    sessionStorage.clear();
    window.location.replace(hubUrl);
  } catch (error) {
    console.error('Payroll session could not be closed:', error);
    window.alert('Payroll could not securely close your session. Please try again.');
  }
}
