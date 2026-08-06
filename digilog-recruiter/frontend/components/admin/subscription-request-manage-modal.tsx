"use client";

import { useState } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { 
  Form, 
  FormControl, 
  FormField, 
  FormItem, 
  FormLabel, 
  FormMessage 
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/components/ui/use-toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { apiRequest } from "@/services/apiConfig";
import { generateInvoice, sendInvoiceEmail, getInvoicePdfUrl } from "@/services/subscriptionService";
import { 
  Clock, 
  Check, 
  X, 
  FileText, 
  Loader2, 
  User, 
  Building2,
  Calendar,
  DollarSign,
  AlertCircle,
  Download,
  Mail
} from "lucide-react";

// Form schema for updating request
const updateRequestSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'invoiced']),
  adminNotes: z.string().optional(),
  invoiceDetails: z.object({
    invoiceNumber: z.string().optional(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    dueDate: z.string().optional()
  }).optional()
});

// Form schema for marking invoice as paid
const markPaidSchema = z.object({
  confirm: z.boolean().refine(val => val === true, {
    message: "You must confirm this action"
  })
});

interface SubscriptionRequest {
  _id: string;
  requestType: 'user' | 'organization';
  userId: {
    _id: string;
    email: string;
    profile?: {
      firstName?: string;
      lastName?: string;
    };
  };
  organizationId?: {
    _id: string;
    name: string;
  };
  currentPlan: string;
  requestedPlan: string;
  status: 'pending' | 'approved' | 'rejected' | 'invoiced';
  notes?: string;
  adminNotes?: string;
  invoiceDetails?: {
    invoiceNumber?: string;
    amount?: number;
    currency?: string;
    dueDate?: Date;
    paid?: boolean;
  };
  approvedBy?: {
    _id: string;
    name: string;
    email: string;
  };
  approvalDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface SubscriptionRequestManageModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: SubscriptionRequest;
  onRequestUpdated: () => void;
}

export function SubscriptionRequestManageModal({
  isOpen,
  onClose,
  request,
  onRequestUpdated
}: SubscriptionRequestManageModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();

  // Initialize form
  const form = useForm<z.infer<typeof updateRequestSchema>>({
    resolver: zodResolver(updateRequestSchema),
    defaultValues: {
      status: request.status,
      adminNotes: request.adminNotes || '',
      invoiceDetails: request.invoiceDetails ? {
        invoiceNumber: request.invoiceDetails.invoiceNumber || '',
        amount: request.invoiceDetails.amount || 0,
        currency: request.invoiceDetails.currency || 'USD',
        dueDate: request.invoiceDetails.dueDate 
          ? new Date(request.invoiceDetails.dueDate).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0]
      } : undefined
    }
  });

  // Mark paid form
  const markPaidForm = useForm<z.infer<typeof markPaidSchema>>({
    resolver: zodResolver(markPaidSchema),
    defaultValues: {
      confirm: false
    }
  });

  // Watch form status to conditionally show invoice details
  const status = form.watch("status");
  
  // Handle form submission
  const onSubmit = async (values: z.infer<typeof updateRequestSchema>) => {
    setIsSubmitting(true);
    setError('');
    
    try {
      // Get the admin token specifically - don't use getAuthToken() which gets user tokens
      const token = localStorage.getItem('adminToken');
      
      if (!token) {
        setError('Admin authentication required. Please log in again.');
        setIsSubmitting(false);
        return;
      }
      
      // Format the data for API
      const payload = {
        status: values.status,
        adminNotes: values.adminNotes
      };
      
      // Add invoice details if provided (optional, even for invoiced status)
      if (values.status === 'invoiced' && values.invoiceDetails) {
        // @ts-ignore - Add invoice details to payload
        payload.invoiceDetails = {
          ...values.invoiceDetails,
          // Convert date string to Date object if provided
          dueDate: values.invoiceDetails.dueDate ? new Date(values.invoiceDetails.dueDate) : undefined,
          // Ensure amount is a number if provided
          amount: values.invoiceDetails.amount ? Number(values.invoiceDetails.amount) : undefined
        };
      }
      
      const response = await apiRequest(`/api/subscription/${request._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth-token': token
        },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast({
          title: 'Request updated',
          description: `The subscription request has been updated to ${values.status}.`,
          duration: 3000,
        });
        
        onRequestUpdated();
      } else {
        setError(data.message || 'Failed to update request');
      }
    } catch (err) {
      setError('An error occurred while updating the request. Please try again.');
      console.error('Error updating subscription request:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle marking invoice as paid
  const handleMarkPaid = async (values: z.infer<typeof markPaidSchema>) => {
    setIsSubmitting(true);
    setError('');
    
    try {
      // Get the admin token specifically
      const token = localStorage.getItem('adminToken');
      
      if (!token) {
        setError('Admin authentication required. Please log in again.');
        setIsSubmitting(false);
        return;
      }
      
      const response = await apiRequest(`/api/subscription/${request._id}/paid`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth-token': token
        }
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast({
          title: 'Invoice marked as paid',
          description: 'The subscription has been upgraded.',
          duration: 3000,
        });
        
        onRequestUpdated();
      } else {
        setError(data.message || 'Failed to mark invoice as paid');
      }
    } catch (err) {
      setError('An error occurred while marking the invoice as paid. Please try again.');
      console.error('Error marking invoice as paid:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Subscription Request</DialogTitle>
        </DialogHeader>

        {/* Request Details */}
        <div className="space-y-4">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-lg font-medium">Request Information</h3>
              <p className="text-sm text-gray-500">ID: {request._id}</p>
            </div>
            <StatusBadge status={request.status} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <User className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium">Requester:</span>
              </div>
              <p className="text-sm pl-6">
                {request.userId.profile?.firstName || ''} {request.userId.profile?.lastName || ''}
                <br />
                <span className="text-gray-500">{request.userId.email}</span>
              </p>
            </div>

            {request.organizationId && (
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Building2 className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-medium">Organization:</span>
                </div>
                <p className="text-sm pl-6">{request.organizationId.name}</p>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Calendar className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium">Requested:</span>
              </div>
              <p className="text-sm pl-6">
                {new Date(request.createdAt).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="p-3 bg-gray-50 rounded-md">
              <p className="text-sm font-medium">Current Plan</p>
              <p className="text-lg font-bold">{request.currentPlan}</p>
            </div>
            <div className="p-3 bg-blue-50 rounded-md">
              <p className="text-sm font-medium">Requested Plan</p>
              <p className="text-lg font-bold">{request.requestedPlan}</p>
            </div>
          </div>

          {request.notes && (
            <div className="mt-4">
              <h4 className="text-sm font-medium">User Notes:</h4>
              <p className="text-sm mt-1 p-3 bg-gray-50 rounded-md">{request.notes}</p>
            </div>
          )}
        </div>

        <Separator className="my-4" />

        {/* Update Request Status Form */}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Update Status</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      className="grid grid-cols-2 gap-2"
                    >
                      <div className={`flex items-center space-x-2 p-2 rounded-md ${field.value === 'approved' ? 'bg-green-50 border border-green-200' : ''}`}>
                        <RadioGroupItem value="approved" id="approved" />
                        <Label htmlFor="approved" className="flex items-center space-x-1">
                          <Check className={`h-4 w-4 ${field.value === 'approved' ? 'text-green-600' : 'text-green-500'}`} />
                          <span className={field.value === 'approved' ? 'font-medium text-green-700' : ''}>Approve</span>
                        </Label>
                      </div>
                      <div className={`flex items-center space-x-2 p-2 rounded-md ${field.value === 'rejected' ? 'bg-red-50 border border-red-200' : ''}`}>
                        <RadioGroupItem value="rejected" id="rejected" />
                        <Label htmlFor="rejected" className="flex items-center space-x-1">
                          <X className={`h-4 w-4 ${field.value === 'rejected' ? 'text-red-600' : 'text-red-500'}`} />
                          <span className={field.value === 'rejected' ? 'font-medium text-red-700' : ''}>Reject</span>
                        </Label>
                      </div>
                      <div className={`flex items-center space-x-2 p-2 rounded-md ${field.value === 'pending' ? 'bg-yellow-50 border border-yellow-200' : ''}`}>
                        <RadioGroupItem value="pending" id="pending" />
                        <Label htmlFor="pending" className="flex items-center space-x-1">
                          <Clock className={`h-4 w-4 ${field.value === 'pending' ? 'text-yellow-600' : 'text-yellow-500'}`} />
                          <span className={field.value === 'pending' ? 'font-medium text-yellow-700' : ''}>Pending</span>
                        </Label>
                      </div>
                      <div className={`flex items-center space-x-2 p-2 rounded-md ${field.value === 'invoiced' ? 'bg-blue-50 border border-blue-200' : ''}`}>
                        <RadioGroupItem value="invoiced" id="invoiced" />
                        <Label htmlFor="invoiced" className="flex items-center space-x-1">
                          <FileText className={`h-4 w-4 ${field.value === 'invoiced' ? 'text-blue-600' : 'text-blue-500'}`} />
                          <span className={field.value === 'invoiced' ? 'font-medium text-blue-700' : ''}>Invoiced (Optional)</span>
                        </Label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="adminNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Admin Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Add notes about this request (visible to admins only)"
                      className="min-h-24"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {status === 'invoiced' && (
              <div className="border rounded-md p-4 space-y-4">
                <h3 className="font-medium flex items-center space-x-2">
                  <FileText className="h-4 w-4" />
                  <span>Invoice Details (Optional)</span>
                </h3>
                <p className="text-sm text-muted-foreground">
                  You can approve requests directly or optionally generate an invoice
                </p>
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="invoiceDetails.invoiceNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Invoice Number</FormLabel>
                        <FormControl>
                          <Input placeholder="INV-001" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="invoiceDetails.dueDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Due Date</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="invoiceDetails.amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            placeholder="0.00"
                            {...field} 
                            onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="invoiceDetails.currency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Currency</FormLabel>
                        <FormControl>
                          <Input placeholder="USD" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Update Request
              </Button>
            </DialogFooter>
          </form>
        </Form>

        {/* Invoice Actions - Only visible for invoiced status */}
        {request.status === 'invoiced' && request.invoiceDetails && (
          <>
            <Separator className="my-4" />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <FileText className="h-5 w-5 text-blue-500" />
                  <h3 className="text-lg font-medium">Invoice Management</h3>
                </div>
                <div className="flex items-center space-x-2">
                  <a 
                    href={getInvoicePdfUrl(request._id)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="outline" size="sm" className="flex items-center gap-2">
                      <Download className="h-4 w-4" />
                      Download Invoice
                    </Button>
                  </a>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2"
                    onClick={async (e) => {
                      e.preventDefault();
                      setIsSendingEmail(true);
                      try {
                        const result = await sendInvoiceEmail(request._id);
                        if (result.success) {
                          toast({
                            title: "Email Sent",
                            description: "Invoice has been emailed to the user",
                          });
                        } else {
                          setError(result.message || "Failed to send email");
                        }
                      } catch (err) {
                        setError("Failed to send invoice email");
                        console.error(err);
                      } finally {
                        setIsSendingEmail(false);
                      }
                    }}
                    disabled={isSendingEmail}
                  >
                    {isSendingEmail ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mail className="h-4 w-4" />
                    )}
                    Email Invoice
                  </Button>
                </div>
              </div>
              
              {!request.invoiceDetails.paid && (
                <>
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      This will mark the invoice as paid and complete the subscription upgrade process.
                      This action cannot be undone.
                    </AlertDescription>
                  </Alert>
                  
                  <form onSubmit={markPaidForm.handleSubmit(handleMarkPaid)} className="space-y-4">
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="confirmPaid"
                        {...markPaidForm.register('confirm')}
                      />
                      <label htmlFor="confirmPaid" className="text-sm">
                        I confirm that payment has been received for this invoice
                      </label>
                    </div>
                    <Button type="submit" variant="default" disabled={isSubmitting}>
                      {isSubmitting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <DollarSign className="mr-2 h-4 w-4" />
                      )}
                      Mark as Paid
                    </Button>
                  </form>
                </>
              )}
              
              {request.invoiceDetails.paid && (
                <Alert className="bg-green-50 border-green-200 text-green-700">
                  <Check className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-700">
                    This invoice has been marked as paid on {new Date(request.approvalDate || request.updatedAt || '').toLocaleDateString()}.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Status Badge component
function StatusBadge({ status }: { status: string }) {
  let color: string;
  let icon: React.ReactElement;
  
  switch (status) {
    case 'approved':
      color = "bg-green-100 text-green-800";
      icon = <Check className="h-3 w-3 mr-1" />;
      break;
    case 'rejected':
      color = "bg-red-100 text-red-800";
      icon = <X className="h-3 w-3 mr-1" />;
      break;
    case 'invoiced':
      color = "bg-blue-100 text-blue-800";
      icon = <FileText className="h-3 w-3 mr-1" />;
      break;
    default:
      color = "bg-yellow-100 text-yellow-800";
      icon = <Clock className="h-3 w-3 mr-1" />;
  }
  
  return (
    <Badge className={`${color} flex items-center`}>
      {icon}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

export default SubscriptionRequestManageModal;
