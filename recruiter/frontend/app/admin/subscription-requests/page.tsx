"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AdminSidebar from '@/components/AdminSidebar';
import AdminHeader from '@/components/AdminHeader';
import {
  Clock,
  Check,
  X,
  FileText,
  Loader2,
  AlertCircle,
  Filter,
  Search,
  RefreshCw,
  User,
  Building2
} from "lucide-react";
import { apiRequest } from "@/services/apiConfig";
import { getAuthToken } from "@/services/authService";
import { SubscriptionRequestManageModal } from "@/components/admin/subscription-request-manage-modal";

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

export default function AdminSubscriptionRequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<SubscriptionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [selectedRequest, setSelectedRequest] = useState<SubscriptionRequest | null>(null);
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);

  // Load subscription requests
  const loadRequests = async () => {
    setLoading(true);
    setError('');

    try {
      // Use adminToken specifically for admin routes
      const token = localStorage.getItem('adminToken');
      const statusFilter = activeTab !== 'all' ? `?status=${activeTab}` : '';
      
      const response = await apiRequest(`/api/subscription/all${statusFilter}`, {
        method: 'GET',
        headers: {
          ...(token && { 'x-admin-auth-token': token })
        }
      });

      const data = await response.json();

      if (data.success) {
        setRequests(data.requests || []);
      } else {
        setError(data.message || 'Failed to load subscription requests');
      }
    } catch (err) {
      setError('Error loading subscription requests. Please try again.');
      console.error('Error loading subscription requests:', err);
    } finally {
      setLoading(false);
    }
  };

  // Effect to load requests on mount and tab change
  useEffect(() => {
    loadRequests();
  }, [activeTab]);

  // Handle request status changes
  const handleRequestUpdated = () => {
    setIsManageModalOpen(false);
    setSelectedRequest(null);
    loadRequests();
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

  // Get request type badge/icon
  const getRequestTypeBadge = (type: 'user' | 'organization') => {
    return type === 'user' ? 
      <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-100">
        <User className="h-3 w-3 mr-1" /> Personal
      </Badge> : 
      <Badge variant="outline" className="bg-purple-50 text-purple-800 border-purple-100">
        <Building2 className="h-3 w-3 mr-1" /> Organization
      </Badge>;
  };

  return (
    <div className="flex h-screen bg-gray-900">
      <AdminSidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <AdminHeader />
        
        <main className="flex-1 overflow-y-auto bg-gray-900 p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col space-y-2">
              <h1 className="text-3xl font-bold text-white">Subscription Upgrade Requests</h1>
              <p className="text-gray-400">
                Manage subscription upgrade requests from users and organizations
              </p>
            </div>
      
      <div className="flex items-center justify-between">
        <Tabs 
          defaultValue="all" 
          value={activeTab} 
          onValueChange={setActiveTab}
          className="w-[400px]"
        >
          <TabsList className="bg-gray-700">
            <TabsTrigger value="all" className="data-[state=active]:bg-blue-600 text-white">All</TabsTrigger>
            <TabsTrigger value="pending" className="data-[state=active]:bg-blue-600 text-white">Pending</TabsTrigger>
            <TabsTrigger value="invoiced" className="data-[state=active]:bg-blue-600 text-white">Invoiced</TabsTrigger>
            <TabsTrigger value="approved" className="data-[state=active]:bg-blue-600 text-white">Approved</TabsTrigger>
            <TabsTrigger value="rejected" className="data-[state=active]:bg-blue-600 text-white">Rejected</TabsTrigger>
          </TabsList>
        </Tabs>
        
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={loadRequests}
            disabled={loading}
            className="bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>
      
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-xl text-white">
            Subscription Requests
            {activeTab !== 'all' && (
              <span className="ml-2 text-gray-400 font-normal text-sm">
                Filtered by: {activeTab}
              </span>
            )}
          </CardTitle>
          <CardDescription className="text-gray-400">
            Review and manage subscription upgrade requests
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-white" />
            </div>
          ) : error ? (
            <div className="flex justify-center items-center py-12 text-red-400 gap-2">
              <AlertCircle className="h-5 w-5" />
              <p>{error}</p>
            </div>
          ) : requests.length === 0 ? (
            <div className="flex flex-col justify-center items-center py-12 text-gray-400">
              <p>No subscription requests found</p>
              {activeTab !== 'all' && (
                <Button 
                  variant="link" 
                  size="sm" 
                  onClick={() => setActiveTab('all')}
                  className="mt-2 text-blue-400 hover:text-blue-300"
                >
                  Clear filter
                </Button>
              )}
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <Table className="w-full">
                <TableHeader>
                  <TableRow className="border-gray-700">
                    <TableHead className="text-gray-400">Request ID</TableHead>
                    <TableHead className="text-gray-400">Type</TableHead>
                    <TableHead className="text-gray-400">User</TableHead>
                    <TableHead className="text-gray-400">Organization</TableHead>
                    <TableHead className="text-gray-400">Plan Change</TableHead>
                    <TableHead className="text-gray-400">Status</TableHead>
                    <TableHead className="text-gray-400">Date</TableHead>
                    <TableHead className="text-gray-400 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((request) => (
                    <TableRow key={request._id} className="border-gray-700">
                      <TableCell className="font-mono text-xs text-gray-300">
                        {request._id.substring(0, 10)}...
                      </TableCell>
                      <TableCell>
                        {getRequestTypeBadge(request.requestType)}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium text-white">
                            {request.userId.profile?.firstName || ''} {request.userId.profile?.lastName || ''}
                          </p>
                          <p className="text-xs text-gray-400">
                            {request.userId.email}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-300">
                        {request.organizationId ? (
                          request.organizationId.name
                        ) : (
                          <span className="text-gray-500 text-xs">N/A</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <p className="font-medium text-gray-300">
                          {request.currentPlan.toUpperCase()} → {request.requestedPlan.toUpperCase()}
                        </p>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(request.status)}
                      </TableCell>
                      <TableCell>
                        <p className="text-xs text-gray-400">
                          {new Date(request.createdAt).toLocaleString()}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedRequest(request);
                            setIsManageModalOpen(true);
                          }}
                          className="bg-gray-700 text-gray-200 border-gray-600 hover:bg-gray-600"
                        >
                          Manage
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Management Modal */}
      {selectedRequest && (
        <SubscriptionRequestManageModal
          isOpen={isManageModalOpen}
          onClose={() => {
            setIsManageModalOpen(false);
            setSelectedRequest(null);
          }}
          request={selectedRequest}
          onRequestUpdated={handleRequestUpdated}
        />
      )}
          </div>
        </main>
      </div>
    </div>
  );
}
