"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getUserRequests, cancelRequest, SubscriptionRequest } from '@/services/subscriptionService';
import { useToast } from '@/components/ui/use-toast';
import { AlertCircle, Loader2, Check, X, FileText, Clock, Info } from 'lucide-react';

interface SubscriptionRequestsStatusProps {
  requestType?: 'user' | 'organization';
  onRefreshNeeded?: () => void;
}

export function SubscriptionRequestsStatus({
  requestType,
  onRefreshNeeded
}: SubscriptionRequestsStatusProps) {
  const [requests, setRequests] = useState<SubscriptionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { toast } = useToast();

  const loadRequests = async () => {
    setLoading(true);
    setError('');

    try {
      const result = await getUserRequests();
      
      if (result.success && result.requests) {
        // Filter by request type if specified
        const filteredRequests = requestType 
          ? result.requests.filter(req => req.requestType === requestType)
          : result.requests;
          
        setRequests(filteredRequests);
      } else {
        setError(result.message || 'Failed to load subscription requests');
      }
    } catch (err) {
      setError('An error occurred while loading your requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, [requestType]);

  const handleCancelRequest = async (requestId: string) => {
    try {
      const result = await cancelRequest(requestId);
      
      if (result.success) {
        toast({
          title: 'Request cancelled',
          description: 'Your upgrade request has been cancelled',
          duration: 3000,
        });
        
        // Remove the cancelled request from state
        setRequests(requests.filter(req => req._id !== requestId));
        
        // Notify parent if needed
        if (onRefreshNeeded) {
          onRefreshNeeded();
        }
      } else {
        toast({
          title: 'Error',
          description: result.message || 'Failed to cancel request',
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: 'Error',
        description: 'An error occurred while cancelling the request',
        variant: 'destructive',
      });
    }
  };

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">
          <Clock className="h-3 w-3 mr-1" /> Pending
        </Badge>;
      case 'approved':
        return <Badge className="bg-green-100 text-green-800 border-green-200">
          <Check className="h-3 w-3 mr-1" /> Approved
        </Badge>;
      case 'rejected':
        return <Badge variant="destructive">
          <X className="h-3 w-3 mr-1" /> Rejected
        </Badge>;
      case 'invoiced':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">
          <FileText className="h-3 w-3 mr-1" /> Invoiced
        </Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  // If no requests and not loading, don't render anything
  if (requests.length === 0 && !loading && !error) {
    return null;
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-lg flex items-center">
          <Info className="h-5 w-5 mr-2" />
          Subscription Upgrade Requests
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center items-center py-6">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            {requests.map(request => (
              <div key={request._id} className="border rounded-md p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium">
                    {request.requestType === 'user' ? 'Personal' : 'Organization'} Plan Upgrade
                  </div>
                  {getStatusBadge(request.status)}
                </div>
                
                <div className="text-sm mb-3">
                  <p>
                    From <span className="font-medium">{request.currentPlan}</span> to{" "}
                    <span className="font-medium">{request.requestedPlan}</span> plan
                  </p>
                  <p className="text-muted-foreground mt-1">
                    Requested on {new Date(request.createdAt as Date).toLocaleDateString()}
                  </p>
                </div>
                
                {request.adminNotes && (
                  <div className="bg-muted p-2 rounded-sm text-sm mb-3">
                    <p className="font-medium">Admin Notes:</p>
                    <p>{request.adminNotes}</p>
                  </div>
                )}
                
                {request.status === 'invoiced' && request.invoiceDetails && (
                  <div className="border border-blue-200 bg-blue-50 p-2 rounded-sm text-sm mb-3">
                    <p className="font-medium">Invoice Information:</p>
                    <p>Invoice #{request.invoiceDetails.invoiceNumber}</p>
                    <p>
                      Amount: {request.invoiceDetails.currency || '$'}
                      {request.invoiceDetails.amount?.toFixed(2)}
                    </p>
                    {request.invoiceDetails.dueDate && (
                      <p>Due: {new Date(request.invoiceDetails.dueDate).toLocaleDateString()}</p>
                    )}
                  </div>
                )}
                
                {request.status === 'pending' && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleCancelRequest(request._id as string)}
                  >
                    Cancel Request
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
