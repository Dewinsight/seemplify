import { apiRequest } from './apiConfig';

export interface Department {
  _id: string;
  name: string;
  description?: string;
  organization: string;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDepartmentData {
  name: string;
  description?: string;
}

export interface UpdateDepartmentData {
  name?: string;
  description?: string;
}

class DepartmentService {
  private baseUrl = '/api/departments';

  async getDepartments(): Promise<Department[]> {
    const response = await apiRequest(this.baseUrl);
    if (!response.ok) {
      let errorData: any = null;
      try {
        errorData = await response.json();
      } catch {
        // Ignore JSON parse issues and use fallback error handling below.
      }

      // Organization context can be briefly unavailable during new-org setup/switch.
      // Treat this as an empty department list instead of a hard UI error.
      const errorMessage = (errorData?.error || errorData?.msg || '').toLowerCase();
      const isMissingOrgContext =
        response.status === 400 &&
        (
          errorMessage.includes('no organization selected') ||
          errorMessage.includes('no current organization set') ||
          errorMessage.includes('must belong to an organization') ||
          errorData?.requiresOrganizationSetup === true
        );

      if (isMissingOrgContext) {
        return [];
      }

      throw new Error(errorData?.error || errorData?.msg || 'Failed to fetch departments');
    }
    const data = await response.json();
    return Array.isArray(data?.departments) ? data.departments : [];
  }

  async createDepartment(data: CreateDepartmentData): Promise<Department> {
    const response = await apiRequest(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create department');
    }
    const result = await response.json();
    return result.department;
  }

  async updateDepartment(id: string, data: UpdateDepartmentData): Promise<Department> {
    const response = await apiRequest(`${this.baseUrl}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update department');
    }
    const result = await response.json();
    return result.department;
  }

  async deleteDepartment(id: string): Promise<void> {
    const response = await apiRequest(`${this.baseUrl}/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete department');
    }
  }

  async getDepartmentById(id: string): Promise<Department> {
    const response = await apiRequest(`${this.baseUrl}/${id}`);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch department');
    }
    const result = await response.json();
    return result.department;
  }
}

export default new DepartmentService();
