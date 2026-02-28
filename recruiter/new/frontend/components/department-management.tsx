import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit, Trash2, Building2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import departmentService, { Department } from '@/services/departmentService';

interface DepartmentManagementProps {
  onDepartmentCreated?: (department: Department) => void;
  onDepartmentDeleted?: (departmentId: string) => void;
}

export default function DepartmentManagement({ 
  onDepartmentCreated, 
  onDepartmentDeleted 
}: DepartmentManagementProps = {}) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchDepartments();
  }, []);

  const fetchDepartments = async () => {
    try {
      setLoading(true);
      const data = await departmentService.getDepartments();
      setDepartments(data);
    } catch (error: any) {
      toast.error('Failed to fetch departments: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDepartment = async () => {
    if (!formData.name.trim()) {
      toast.error('Department name is required');
      return;
    }

    try {
      setSubmitting(true);
      const newDepartment = await departmentService.createDepartment(formData);
      setDepartments(prev => [...prev, newDepartment]);
      setShowCreateDialog(false);
      setFormData({ name: '', description: '' });
      toast.success('Department created successfully');
      
      // Notify parent component
      if (onDepartmentCreated) {
        onDepartmentCreated(newDepartment);
      }
      
      // Also dispatch global event for department select components
      if ((window as any).__departmentCreatedHandler) {
        (window as any).__departmentCreatedHandler(newDepartment);
      }
    } catch (error: any) {
      toast.error('Failed to create department: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateDepartment = async () => {
    if (!editingDepartment) return;
    
    if (!formData.name.trim()) {
      toast.error('Department name is required');
      return;
    }

    try {
      setSubmitting(true);
      const updatedDepartment = await departmentService.updateDepartment(
        editingDepartment._id,
        formData
      );
      setDepartments(prev => 
        prev.map(dept => dept._id === editingDepartment._id ? updatedDepartment : dept)
      );
      setEditingDepartment(null);
      setFormData({ name: '', description: '' });
      toast.success('Department updated successfully');
    } catch (error: any) {
      toast.error('Failed to update department: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDepartment = async (department: Department) => {
    if (!confirm(`Are you sure you want to delete "${department.name}"?`)) return;
    
    try {
      await departmentService.deleteDepartment(department._id);
      setDepartments(prev => prev.filter(dept => dept._id !== department._id));
      toast.success('Department deleted successfully');
      
      // Notify parent component
      if (onDepartmentDeleted) {
        onDepartmentDeleted(department._id);
      }
      
      // Also dispatch global event for department select components
      if ((window as any).__departmentDeletedHandler) {
        (window as any).__departmentDeletedHandler(department._id);
      }
    } catch (error: any) {
      toast.error('Failed to delete department: ' + error.message);
    }
  };

  const openEditDialog = (department: Department) => {
    setEditingDepartment(department);
    setFormData({ name: department.name, description: department.description || '' });
  };

  const closeDialogs = () => {
    setShowCreateDialog(false);
    setEditingDepartment(null);
    setFormData({ name: '', description: '' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="flex items-center space-x-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading departments...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Departments</h2>
          <p className="text-muted-foreground">Manage your organization's departments</p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Department
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Department</DialogTitle>
              <DialogDescription>
                Add a new department to your organization
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Department Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Engineering, Marketing"
                />
              </div>
              <div>
                <Label htmlFor="description">Description (Optional)</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Brief description of the department"
                  rows={3}
                />
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={closeDialogs} disabled={submitting}>
                  Cancel
                </Button>
                <Button onClick={handleCreateDepartment} disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Department'
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {departments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No departments yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Create your first department to get started with organizing your jobs.
            </p>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create First Department
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {departments.map((department) => (
            <Card key={department._id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-lg">{department.name}</CardTitle>
                  </div>
                  <div className="flex space-x-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditDialog(department)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteDepartment(department)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {department.description && (
                  <CardDescription className="mb-2">{department.description}</CardDescription>
                )}
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">Active</Badge>
                  <span className="text-xs text-muted-foreground">
                    Created {new Date(department.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editingDepartment} onOpenChange={closeDialogs}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Department</DialogTitle>
            <DialogDescription>
              Update department information
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-name">Department Name *</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Engineering, Marketing"
              />
            </div>
            <div>
              <Label htmlFor="edit-description">Description (Optional)</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Brief description of the department"
                rows={3}
              />
            </div>
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={closeDialogs} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={handleUpdateDepartment} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update Department'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
