import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import departmentService, { Department } from '@/services/departmentService';

interface DepartmentSelectProps {
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  showCreateOption?: boolean;
  onCreateDepartment?: () => void;
  disabled?: boolean;
  onDepartmentCreated?: (department: Department) => void;
}

export default function DepartmentSelect({
  value,
  onValueChange,
  placeholder = "Select department",
  showCreateOption = true,
  onCreateDepartment,
  disabled = false,
  onDepartmentCreated
}: DepartmentSelectProps) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDepartments();
  }, []);

  // Listen for department creation/deletion events
  useEffect(() => {
    const handleDepartmentCreated = (department: Department) => {
      setDepartments(prev => [...prev, department]);
      onValueChange(department._id); // Auto-select the new department
    };
    
    const handleDepartmentDeleted = (departmentId: string) => {
      setDepartments(prev => prev.filter(dept => dept._id !== departmentId));
      // If the deleted department was selected, clear the selection
      if (value === departmentId) {
        onValueChange('');
      }
    };
    
    // Store the handlers for cleanup
    (window as any).__departmentCreatedHandler = handleDepartmentCreated;
    (window as any).__departmentDeletedHandler = handleDepartmentDeleted;
    
    return () => {
      delete (window as any).__departmentCreatedHandler;
      delete (window as any).__departmentDeletedHandler;
    };
  }, [onValueChange, value]);

  const fetchDepartments = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await departmentService.getDepartments();
      setDepartments(data);
    } catch (error: any) {
      console.error('Error fetching departments:', error);
      setError(error.message);
      toast.error('Failed to fetch departments: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleValueChange = (newValue: string) => {
    if (newValue === 'create-new' && onCreateDepartment) {
      onCreateDepartment();
      return;
    }
    onValueChange(newValue);
  };

  if (loading) {
    return (
      <Select disabled>
        <SelectTrigger>
          <div className="flex items-center">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            <span>Loading departments...</span>
          </div>
        </SelectTrigger>
      </Select>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <Select disabled>
          <SelectTrigger>
            <SelectValue placeholder="Error loading departments" />
          </SelectTrigger>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={fetchDepartments}
          className="w-full"
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Select 
        value={value} 
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {departments.map((department) => (
            <SelectItem key={department._id} value={department._id}>
              {department.name}
            </SelectItem>
          ))}
          {showCreateOption && (
            <SelectItem value="create-new" className="text-blue-600">
              <div className="flex items-center">
                <Plus className="h-4 w-4 mr-2" />
                Create New Department
              </div>
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      {showCreateOption && onCreateDepartment && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCreateDepartment}
          className="w-full"
          disabled={disabled}
        >
          <Plus className="h-4 w-4 mr-2" />
          Manage Departments
        </Button>
      )}
    </div>
  );
}
