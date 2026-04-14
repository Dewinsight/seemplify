"use client";

import { useState, useEffect } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from "@/services/apiConfig";

interface PlanLimit {
  memberLimit: number | string;       // For organization plans
  storageLimit: number | string;      // For organization plans
  apiCallsLimit: number | string;     // For organization plans
}

interface PlanFeature {
  name: string;
  description?: string;
}

interface PlanCreditCosts {
  createJob: number;
  uploadCandidate: number;
  scheduleInterview: number;
  aiMatching: number;
  generateQuestions: number;
  aiAnalysis: number;
  bulkUpload: number;
  reEmbed: number;
}

interface PlanCredits {
  totalCredits: number;
  creditCosts: PlanCreditCosts;
  rolloverEnabled: boolean;
  rolloverPercentage: number;
}

interface Plan {
  _id?: string;
  name: string;
  code: string;
  price: number;
  currency: string;
  billingCycle: string;
  features: PlanFeature[];
  limits: PlanLimit;
  credits?: PlanCredits;
  trialDays: number;
  isPublished: boolean;
  displayOrder: number;
  planType: 'organization'; // Only organization plans now
  isCustom?: boolean;
}

interface PlanFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: Plan | null;
  onSuccess: () => void;
}

export default function PlanFormModal({ isOpen, onClose, plan, onSuccess }: PlanFormModalProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<Plan>({
    name: '',
    code: '',
    price: 0,
    currency: 'USD',
    billingCycle: 'monthly',
    features: [{ name: '', description: '' }],
    limits: {
      memberLimit: '',       // For organization plans
      storageLimit: '',      // For organization plans
      apiCallsLimit: ''      // For organization plans
    },
    credits: {
      totalCredits: 2000,
      creditCosts: {
        createJob: 4,
        uploadCandidate: 7,
        scheduleInterview: 2,
        aiMatching: 11,
        generateQuestions: 6,
        aiAnalysis: 12,
        bulkUpload: 5,
        reEmbed: 3
      },
      rolloverEnabled: false,
      rolloverPercentage: 0
    },
    trialDays: 14,
    isPublished: false,
    displayOrder: 1,
    planType: 'organization'
  });

  const { toast } = useToast();

  // Populate form when editing existing plan
  useEffect(() => {
    if (plan) {
      setFormData({
        ...plan,
        // Ensure features array is valid
        features: plan.features?.length ? plan.features : [{ name: '', description: '' }]
      });
    } else {
      // Reset form for new plan
      setFormData({
        name: '',
        code: '',
        price: 0,
        currency: 'USD',
        billingCycle: 'monthly',
        features: [{ name: '', description: '' }],
        limits: {
          memberLimit: '',       // For organization plans
          storageLimit: '',      // For organization plans
          apiCallsLimit: ''      // For organization plans
        },
        credits: {
          totalCredits: 2000,
          creditCosts: {
            createJob: 4,
            uploadCandidate: 7,
            scheduleInterview: 2,
            aiMatching: 11,
            generateQuestions: 6,
            aiAnalysis: 12,
            bulkUpload: 5,
            reEmbed: 3
          },
          rolloverEnabled: false,
          rolloverPercentage: 0
        },
        trialDays: 14,
        isPublished: false,
        displayOrder: 1,
        planType: 'organization'
      });
    }
  }, [plan, isOpen]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name.includes('.')) {
      const [section, field] = name.split('.');
      setFormData({
        ...formData,
        [section]: {
          ...(formData[section as keyof Plan] as object),
          [field]: value
        }
      });
    } else {
      setFormData({
        ...formData,
        [name]: value
      });
    }
  };

  const handleNumberInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name.includes('.')) {
      const [section, field] = name.split('.');
      setFormData({
        ...formData,
        [section]: {
          ...(formData[section as keyof Plan] as object),
          [field]: value === '' ? '' : Number(value)
        }
      });
    } else {
      setFormData({
        ...formData,
        [name]: value === '' ? '' : Number(value)
      });
    }
  };

  const handleSwitchChange = (name: string, checked: boolean) => {
    setFormData({
      ...formData,
      [name]: checked
    });
  };

  const handleFeatureChange = (index: number, field: string, value: string) => {
    const updatedFeatures = [...formData.features];
    updatedFeatures[index] = {
      ...updatedFeatures[index],
      [field]: value
    };
    setFormData({
      ...formData,
      features: updatedFeatures
    });
  };

  const addFeature = () => {
    setFormData({
      ...formData,
      features: [...formData.features, { name: '', description: '' }]
    });
  };

  const removeFeature = (index: number) => {
    const updatedFeatures = formData.features.filter((_, i) => i !== index);
    setFormData({
      ...formData,
      features: updatedFeatures.length ? updatedFeatures : [{ name: '', description: '' }]
    });
  };

  const handleSubmit = async () => {
    // Validate form
    if (!formData.name || !formData.code) {
      toast({
        title: "Validation Error",
        description: "Name and code are required fields",
        variant: "destructive"
      });
      return;
    }

    // Filter out empty features - only organization plans supported
    const cleanedLimits = {
      memberLimit: formData.limits.memberLimit,
      storageLimit: formData.limits.storageLimit,
      apiCallsLimit: formData.limits.apiCallsLimit
    };

    const cleanedFormData = {
      ...formData,
      limits: cleanedLimits,
      features: formData.features.filter(feature => feature.name.trim() !== '')
    };

    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      if (!token) {
        throw new Error("Authentication required");
      }

      const url = plan?._id 
        ? `/api/plans/${plan._id}` 
        : `/api/plans`;
      
      const response = await apiRequest(url, {
        method: plan?._id ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth-token': token
        },
        body: JSON.stringify(cleanedFormData)
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || "Failed to save plan");
      }

      toast({
        title: `Plan ${plan?._id ? 'Updated' : 'Created'}`,
        description: `${formData.name} has been ${plan?._id ? 'updated' : 'created'} successfully`,
      });

      onSuccess();
      onClose();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-[95vw] h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0 pb-4 border-b">
          <DialogTitle className="text-lg md:text-xl">
            {plan?._id ? `Edit Plan: ${plan.name}` : 'Create New Plan'}
          </DialogTitle>
        </DialogHeader>

        <div 
          className="flex-1 overflow-y-auto px-4 py-4 bg-gray-50 rounded-lg" 
          style={{ 
            maxHeight: 'calc(90vh - 200px)', 
            minHeight: '500px'
          }}
        >
          {/* Scroll indicator */}
          <div className="text-xs text-gray-500 text-center mb-4 border-b pb-2">
            ↓ Scroll down to see all options ↓
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6 pb-4">
            {/* First Column - Basic Plan Info */}
            <div className="space-y-4">
            <div>
              <Label htmlFor="name">Plan Name</Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g., Business Plan"
                value={formData.name}
                onChange={handleInputChange}
              />
            </div>

            <div>
              <Label htmlFor="code">Plan Code</Label>
              <Input
                id="code"
                name="code"
                placeholder="e.g., business-monthly"
                value={formData.code}
                onChange={handleInputChange}
              />
              <p className="text-sm text-gray-500 mt-1">
                Unique identifier for this plan (used in system)
              </p>
            </div>

            {/* Plan Type removed - only organization plans are supported now */}

            <div>
              <Label htmlFor="price">Price</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  id="price"
                  name="price"
                  type="number"
                  placeholder="0"
                  value={formData.price}
                  onChange={handleNumberInputChange}
                  className="flex-1"
                />
                <Select
                  value={formData.currency}
                  onValueChange={(value) => setFormData({ ...formData, currency: value })}
                >
                  <SelectTrigger className="w-full sm:w-24">
                    <SelectValue placeholder="USD" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="billingCycle">Billing Cycle</Label>
              <Select
                value={formData.billingCycle}
                onValueChange={(value) => setFormData({ ...formData, billingCycle: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="trialDays">Trial Period (Days)</Label>
              <Input
                id="trialDays"
                name="trialDays"
                type="number"
                placeholder="14"
                value={formData.trialDays}
                onChange={handleNumberInputChange}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="isPublished"
                checked={formData.isPublished}
                onCheckedChange={(checked) => handleSwitchChange('isPublished', checked)}
              />
              <Label htmlFor="isPublished" className="text-sm">Published</Label>
            </div>

            <div>
              <Label htmlFor="displayOrder">Display Order</Label>
              <Input
                id="displayOrder"
                name="displayOrder"
                type="number"
                placeholder="1"
                value={formData.displayOrder}
                onChange={handleNumberInputChange}
              />
            </div>
          </div>

          {/* Second Column - Limits and Features */}
          <div className="space-y-4 lg:space-y-6">
            <h4 className="text-sm lg:text-base font-medium">Organization Resource Limits</h4>
            
            {/* Only organization plans are supported now */}
            <div className="space-y-2">
              <div className="p-3 bg-purple-50 border border-purple-200 rounded-md mb-4">
                <div className="flex items-center mb-2">
                  <span className="font-medium text-purple-800 text-sm">🏢 Organization Plan Controls:</span>
                  <div className="ml-auto">
                    <div className="inline-flex items-center bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded-full">
                      Credits System Enabled
                    </div>
                  </div>
                </div>
                <p className="text-xs text-purple-600">Two ways to control resources:</p>
                <div className="text-xs bg-gray-50 p-2 rounded mt-2 space-y-1">
                  <p><strong>1. Hard Limits:</strong> Fixed maximum resources per organization</p>
                  <p>• Members = maximum users in organization team</p>
                  <p>• Jobs = maximum job postings allowed</p>
                  <p><strong>2. Credits System:</strong> Flexible resource allocation</p>
                  <p>• Total credits = pool of resources</p>
                  <p>• Action costs = resource usage per action</p>
                </div>
              </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="limits.memberLimit" className="text-sm">Team Members Limit</Label>
                    <Input
                      id="limits.memberLimit"
                      name="limits.memberLimit"
                      type="number"
                      placeholder="Enter number (0 = unlimited)"
                      value={formData.limits.memberLimit}
                      onChange={handleNumberInputChange}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      How many team members can be added to each organization
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="limits.storageLimit" className="text-sm">Storage Limit (MB)</Label>
                    <Input
                      id="limits.storageLimit"
                      name="limits.storageLimit"
                      type="number"
                      placeholder="Enter MB (0 = unlimited)"
                      value={formData.limits.storageLimit}
                      onChange={handleNumberInputChange}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <Label htmlFor="limits.apiCallsLimit" className="text-sm">API Calls Limit (per month)</Label>
                    <Input
                      id="limits.apiCallsLimit"
                      name="limits.apiCallsLimit"
                      type="number"
                      placeholder="Enter number (0 = unlimited)"
                      value={formData.limits.apiCallsLimit}
                      onChange={handleNumberInputChange}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs text-gray-500">Note: Jobs and candidates are managed by the credits system</p>
                  </div>
                </div>
              
              {/* Credits System Section */}
              <div className="space-y-4 mt-8 border-t pt-6">
                <h4 className="text-sm lg:text-base font-medium flex items-center">
                  <span>Credits System</span>
                  <span className="ml-2 bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded-full">New</span>
                </h4>
                
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="credits.totalCredits" className="text-sm">Total Credits</Label>
                    <Input
                      id="credits.totalCredits"
                      name="credits.totalCredits"
                      type="number"
                      placeholder="100"
                      value={formData.credits?.totalCredits || 2000}
                      onChange={handleNumberInputChange}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Monthly allocation of credits for this plan
                    </p>
                  </div>
                  
                  <div className="bg-blue-50 border border-blue-200 p-3 rounded-md">
                    <h5 className="text-sm font-medium text-blue-800 mb-3">Credit Costs per Action</h5>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="credits.creditCosts.createJob" className="text-xs">Create Job</Label>
                        <Input
                          id="credits.creditCosts.createJob"
                          name="credits.creditCosts.createJob"
                          type="number"
                          className="h-8"
                          value={formData.credits?.creditCosts?.createJob || 4}
                          onChange={handleNumberInputChange}
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="credits.creditCosts.uploadCandidate" className="text-xs">Upload Candidate</Label>
                        <Input
                          id="credits.creditCosts.uploadCandidate"
                          name="credits.creditCosts.uploadCandidate"
                          type="number"
                          className="h-8"
                          value={formData.credits?.creditCosts?.uploadCandidate || 7}
                          onChange={handleNumberInputChange}
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="credits.creditCosts.scheduleInterview" className="text-xs">Schedule Interview</Label>
                        <Input
                          id="credits.creditCosts.scheduleInterview"
                          name="credits.creditCosts.scheduleInterview"
                          type="number"
                          className="h-8"
                          value={formData.credits?.creditCosts?.scheduleInterview || 2}
                          onChange={handleNumberInputChange}
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="credits.creditCosts.aiMatching" className="text-xs">AI Matching</Label>
                        <Input
                          id="credits.creditCosts.aiMatching"
                          name="credits.creditCosts.aiMatching"
                          type="number"
                          className="h-8"
                          value={formData.credits?.creditCosts?.aiMatching || 11}
                          onChange={handleNumberInputChange}
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="credits.creditCosts.generateQuestions" className="text-xs">Generate Questions</Label>
                        <Input
                          id="credits.creditCosts.generateQuestions"
                          name="credits.creditCosts.generateQuestions"
                          type="number"
                          className="h-8"
                          value={formData.credits?.creditCosts?.generateQuestions || 6}
                          onChange={handleNumberInputChange}
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="credits.creditCosts.aiAnalysis" className="text-xs">AI Analysis</Label>
                        <Input
                          id="credits.creditCosts.aiAnalysis"
                          name="credits.creditCosts.aiAnalysis"
                          type="number"
                          className="h-8"
                          value={formData.credits?.creditCosts?.aiAnalysis || 12}
                          onChange={handleNumberInputChange}
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="credits.creditCosts.bulkUpload" className="text-xs">Bulk Upload (per item)</Label>
                        <Input
                          id="credits.creditCosts.bulkUpload"
                          name="credits.creditCosts.bulkUpload"
                          type="number"
                          className="h-8"
                          value={formData.credits?.creditCosts?.bulkUpload || 5}
                          onChange={handleNumberInputChange}
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="credits.creditCosts.reEmbed" className="text-xs">Re-embed Resource</Label>
                        <Input
                          id="credits.creditCosts.reEmbed"
                          name="credits.creditCosts.reEmbed"
                          type="number"
                          className="h-8"
                          value={formData.credits?.creditCosts?.reEmbed || 3}
                          onChange={handleNumberInputChange}
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="credits.rolloverEnabled"
                      checked={formData.credits?.rolloverEnabled || false}
                      onCheckedChange={(checked) => {
                        setFormData({
                          ...formData,
                          credits: {
                            ...(formData.credits || {
                              totalCredits: 2000,
                              creditCosts: {
                                createJob: 4,
                                uploadCandidate: 7,
                                scheduleInterview: 2,
                                aiMatching: 11,
                                generateQuestions: 6,
                                aiAnalysis: 12,
                                bulkUpload: 5,
                                reEmbed: 3
                              },
                              rolloverPercentage: 0
                            }),
                            rolloverEnabled: checked
                          }
                        });
                      }}
                    />
                    <Label htmlFor="credits.rolloverEnabled" className="text-sm">Enable Credit Rollover</Label>
                  </div>
                  
                  {formData.credits?.rolloverEnabled && (
                    <div>
                      <Label htmlFor="credits.rolloverPercentage" className="text-sm">Rollover Percentage</Label>
                      <div className="flex items-center">
                        <Input
                          id="credits.rolloverPercentage"
                          name="credits.rolloverPercentage"
                          type="number"
                          min="0"
                          max="100"
                          className="w-24"
                          value={formData.credits?.rolloverPercentage || 0}
                          onChange={handleNumberInputChange}
                        />
                        <span className="ml-2">%</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Percentage of unused credits that carry over to the next cycle
                      </p>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Plan Features Section */}
              <div className="space-y-4 mt-6 border-t pt-6">
                <h4 className="text-sm lg:text-base font-medium">Plan Features</h4>
              <div className="space-y-2">
                {formData.features.map((feature, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Feature name"
                        value={feature.name}
                        onChange={(e) => handleFeatureChange(index, 'name', e.target.value)}
                        className="flex-grow"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeFeature(index)}
                        type="button"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Input
                      placeholder="Description (optional)"
                      value={feature.description || ''}
                      onChange={(e) => handleFeatureChange(index, 'description', e.target.value)}
                    />
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addFeature}
                  type="button"
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Feature
                </Button>
              </div>
              </div>
            </div>
          </div>
          
          {/* Bottom scroll indicator */}
          <div className="text-xs text-gray-500 text-center mt-6 pt-4 border-t">
            ↑ Scroll up to see more options ↑
          </div>
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 border-t pt-4 flex flex-col sm:flex-row gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} className="order-2 sm:order-1">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading} className="order-1 sm:order-2">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {plan?._id ? 'Update Plan' : 'Create Plan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
