"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AdminSidebar from '@/components/AdminSidebar';
import AdminHeader from '@/components/AdminHeader';
import {
  Plus,
  Edit,
  Trash2,
  Loader2,
  RefreshCw,
  Package,
  Coins,
  DollarSign,
  Star,
  CheckCircle,
  XCircle,
  Clock,
  Check,
  X,
  User,
  Building2
} from "lucide-react";
import { apiRequest } from "@/services/apiConfig";
import { toast } from "sonner";

// ==================== INTERFACES ====================

interface CreditPack {
  _id: string;
  name: string;
  code: string;
  credits: number;
  bonusCredits: number;
  totalCredits: number;
  price: number;
  currency: string;
  description?: string;
  features?: string[];
  isPopular: boolean;
  isActive: boolean;
  displayOrder: number;
  pricePerCredit?: number;
  createdAt: string;
  updatedAt: string;
}

interface CreditPackForm {
  name: string;
  code: string;
  credits: number;
  bonusCredits: number;
  price: number;
  currency: string;
  description: string;
  features: string;
  isPopular: boolean;
  isActive: boolean;
  displayOrder: number;
}

interface CreditPurchaseRequest {
  _id: string;
  organization: {
    _id: string;
    name: string;
  };
  requestedBy: {
    _id: string;
    email: string;
    profile?: {
      firstName?: string;
      lastName?: string;
    };
  };
  creditPack: {
    _id: string;
    name: string;
  };
  packDetails: {
    name: string;
    code: string;
    credits: number;
    bonusCredits: number;
    totalCredits: number;
    price: number;
    currency: string;
  };
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  notes?: string;
  reviewedBy?: {
    _id: string;
    profile: {
      firstName: string;
      lastName: string;
    };
  };
  reviewedAt?: string;
  reviewNotes?: string;
  creditsGranted: boolean;
  grantedAt?: string;
  createdAt: string;
  updatedAt: string;
}

const initialFormState: CreditPackForm = {
  name: '',
  code: '',
  credits: 100,
  bonusCredits: 0,
  price: 0,
  currency: 'USD',
  description: '',
  features: '',
  isPopular: false,
  isActive: true,
  displayOrder: 0
};

// ==================== MAIN COMPONENT ====================

export default function AdminCreditsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') || 'packs';

  // Shared state
  const [activeMainTab, setActiveMainTab] = useState(initialTab);
  const [refreshing, setRefreshing] = useState(false);

  // Credit Packs state
  const [creditPacks, setCreditPacks] = useState<CreditPack[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);
  const [packsError, setPacksError] = useState('');
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [editingPack, setEditingPack] = useState<CreditPack | null>(null);
  const [deletingPack, setDeletingPack] = useState<CreditPack | null>(null);
  const [formData, setFormData] = useState<CreditPackForm>(initialFormState);
  const [processing, setProcessing] = useState(false);

  // Purchase Requests state
  const [requests, setRequests] = useState<CreditPurchaseRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestsError, setRequestsError] = useState('');
  const [requestsTab, setRequestsTab] = useState('pending');
  const [selectedRequest, setSelectedRequest] = useState<CreditPurchaseRequest | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');

  // ==================== CREDIT PACKS FUNCTIONS ====================

  const loadCreditPacks = async () => {
    setPacksLoading(true);
    setPacksError('');

    try {
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest('/api/admin/credit-packs', {
        method: 'GET',
        headers: {
          ...(token && { 'x-admin-auth-token': token })
        }
      });

      const data = await response.json();

      if (data.success) {
        setCreditPacks(data.creditPacks || []);
      } else {
        setPacksError(data.msg || 'Failed to load credit packs');
      }
    } catch (err) {
      setPacksError('Error loading credit packs. Please try again.');
      console.error('Error loading credit packs:', err);
    } finally {
      setPacksLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingPack(null);
    setFormData(initialFormState);
    setIsFormModalOpen(true);
  };

  const handleEdit = (pack: CreditPack) => {
    setEditingPack(pack);
    setFormData({
      name: pack.name,
      code: pack.code,
      credits: pack.credits,
      bonusCredits: pack.bonusCredits || 0,
      price: pack.price,
      currency: pack.currency,
      description: pack.description || '',
      features: pack.features?.join('\n') || '',
      isPopular: pack.isPopular,
      isActive: pack.isActive,
      displayOrder: pack.displayOrder
    });
    setIsFormModalOpen(true);
  };

  const handleDelete = (pack: CreditPack) => {
    setDeletingPack(pack);
    setIsDeleteModalOpen(true);
  };

  const handleFormChange = (field: keyof CreditPackForm, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.code.trim() || formData.credits <= 0 || formData.price < 0) {
      toast.error('Please fill in all required fields correctly');
      return;
    }

    setProcessing(true);
    try {
      const token = localStorage.getItem('adminToken');
      
      const payload = {
        ...formData,
        features: formData.features
          .split('\n')
          .map(f => f.trim())
          .filter(f => f.length > 0)
      };

      const url = editingPack
        ? `/api/admin/credit-packs/${editingPack._id}`
        : '/api/admin/credit-packs';
      
      const method = editingPack ? 'PUT' : 'POST';

      const response = await apiRequest(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'x-admin-auth-token': token })
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (data.success) {
        toast.success(
          editingPack
            ? 'Credit pack updated successfully'
            : 'Credit pack created successfully'
        );
        setIsFormModalOpen(false);
        loadCreditPacks();
      } else {
        toast.error(data.msg || 'Failed to save credit pack');
      }
    } catch (err) {
      console.error('Error saving credit pack:', err);
      toast.error('Failed to save credit pack');
    } finally {
      setProcessing(false);
    }
  };

  const confirmDelete = async () => {
    if (!deletingPack) return;

    setProcessing(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest(`/api/admin/credit-packs/${deletingPack._id}`, {
        method: 'DELETE',
        headers: {
          ...(token && { 'x-admin-auth-token': token })
        }
      });

      const data = await response.json();

      if (data.success) {
        toast.success('Credit pack deleted successfully');
        setIsDeleteModalOpen(false);
        loadCreditPacks();
      } else {
        toast.error(data.msg || 'Failed to delete credit pack');
      }
    } catch (err) {
      console.error('Error deleting credit pack:', err);
      toast.error('Failed to delete credit pack');
    } finally {
      setProcessing(false);
    }
  };

  // ==================== PURCHASE REQUESTS FUNCTIONS ====================

  const loadRequests = async () => {
    setRequestsLoading(true);
    setRequestsError('');

    try {
      const token = localStorage.getItem('adminToken');
      const statusFilter = requestsTab !== 'all' ? `?status=${requestsTab}` : '';
      
      const response = await apiRequest(`/api/admin/credit-purchase-requests${statusFilter}`, {
        method: 'GET',
        headers: {
          ...(token && { 'x-admin-auth-token': token })
        }
      });

      const data = await response.json();

      if (data.success) {
        setRequests(data.requests || []);
      } else {
        setRequestsError(data.message || 'Failed to load credit purchase requests');
      }
    } catch (err) {
      setRequestsError('Error loading credit purchase requests. Please try again.');
      console.error('Error loading requests:', err);
    } finally {
      setRequestsLoading(false);
    }
  };

  const handleReview = (request: CreditPurchaseRequest, action: 'approve' | 'reject') => {
    setSelectedRequest(request);
    setReviewAction(action);
    setReviewNotes('');
    setIsReviewModalOpen(true);
  };

  const submitReview = async () => {
    if (!selectedRequest || !reviewAction) return;

    setProcessing(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest(
        `/api/admin/credit-purchase-requests/${selectedRequest._id}/${reviewAction}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { 'x-admin-auth-token': token })
          },
          body: JSON.stringify({ reviewNotes })
        }
      );

      const data = await response.json();

      if (data.success) {
        toast.success(
          reviewAction === 'approve'
            ? `Credits granted successfully! ${data.creditsGranted} credits added.`
            : 'Purchase request rejected successfully'
        );
        setIsReviewModalOpen(false);
        loadRequests();
      } else {
        toast.error(data.msg || 'Failed to process request');
      }
    } catch (err) {
      console.error('Error processing request:', err);
      toast.error('Failed to process request');
    } finally {
      setProcessing(false);
    }
  };

  // ==================== EFFECTS ====================

  useEffect(() => {
    if (activeMainTab === 'packs') {
      loadCreditPacks();
    } else {
      loadRequests();
    }
  }, [activeMainTab, requestsTab]);

  // ==================== HELPER FUNCTIONS ====================

  const handleRefresh = async () => {
    setRefreshing(true);
    if (activeMainTab === 'packs') {
      await loadCreditPacks();
    } else {
      await loadRequests();
    }
    setRefreshing(false);
    toast.success('Data refreshed');
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      pending: 'bg-yellow-500',
      approved: 'bg-green-500',
      rejected: 'bg-red-500',
      cancelled: 'bg-gray-500'
    };
    return <Badge className={variants[status as keyof typeof variants] || 'bg-gray-500'}>{status}</Badge>;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getUserName = (user: any) => {
    if (user.profile?.firstName && user.profile?.lastName) {
      return `${user.profile.firstName} ${user.profile.lastName}`;
    }
    return user.email || 'Unknown User';
  };

  const filteredRequests = requests;

  // ==================== STATISTICS ====================

  const stats = {
    totalPacks: creditPacks.length,
    activePacks: creditPacks.filter(p => p.isActive).length,
    pendingRequests: requests.filter(r => r.status === 'pending').length,
    approvedRequests: requests.filter(r => r.status === 'approved').length
  };

  // ==================== RENDER ====================

  return (
    <div className="flex h-screen bg-gray-950">
      <AdminSidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <AdminHeader />
        
        <main className="flex-1 overflow-auto p-8">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-white">Credits Management</h1>
                <p className="text-gray-400 mt-1">Manage credit packs and purchase requests</p>
              </div>
              <Button
                onClick={handleRefresh}
                disabled={refreshing}
                className="bg-gray-800 hover:bg-gray-700 text-white border border-gray-700 px-4 py-2"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            {/* Statistics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className="bg-gray-900 border-gray-800">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-400 mb-1">Total Packs</p>
                      <p className="text-3xl font-bold text-white">{stats.totalPacks}</p>
                    </div>
                    <Package className="w-10 h-10 text-blue-500" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gray-900 border-gray-800">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-400 mb-1">Active Packs</p>
                      <p className="text-3xl font-bold text-green-500">{stats.activePacks}</p>
                    </div>
                    <CheckCircle className="w-10 h-10 text-green-500" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gray-900 border-gray-800">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-400 mb-1">Pending Requests</p>
                      <p className="text-3xl font-bold text-yellow-500">{stats.pendingRequests}</p>
                    </div>
                    <Clock className="w-10 h-10 text-yellow-500" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gray-900 border-gray-800">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-400 mb-1">Approved</p>
                      <p className="text-3xl font-bold text-white">{stats.approvedRequests}</p>
                    </div>
                    <Coins className="w-10 h-10 text-purple-500" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Main Tabs */}
            <Tabs value={activeMainTab} onValueChange={setActiveMainTab} className="space-y-4">
              <TabsList className="bg-gray-900 border border-gray-800">
                <TabsTrigger value="packs" className="data-[state=active]:bg-gray-800 data-[state=active]:text-white text-gray-300 hover:text-white">
                  <Package className="w-4 h-4 mr-2" />
                  Credit Packs
                </TabsTrigger>
                <TabsTrigger value="requests" className="data-[state=active]:bg-gray-800 data-[state=active]:text-white text-gray-300 hover:text-white">
                  <Clock className="w-4 h-4 mr-2" />
                  Purchase Requests
                  {stats.pendingRequests > 0 && (
                    <Badge className="ml-2 bg-yellow-500 text-black">{stats.pendingRequests}</Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* ==================== CREDIT PACKS TAB ==================== */}
              <TabsContent value="packs">
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-white">Credit Packs</CardTitle>
                        <CardDescription className="text-gray-400">
                          Manage available credit packs for purchase
                        </CardDescription>
                      </div>
                      <Button onClick={handleCreate} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2 shadow-lg">
                        <Plus className="w-5 h-5 mr-2" />
                        Create Pack
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {packsLoading ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                      </div>
                    ) : packsError ? (
                      <div className="text-center py-8">
                        <p className="text-red-400">{packsError}</p>
                        <Button onClick={loadCreditPacks} className="mt-4" variant="outline">
                          Retry
                        </Button>
                      </div>
                    ) : creditPacks.length === 0 ? (
                      <div className="text-center py-12">
                        <Package className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                        <p className="text-gray-400 mb-4">No credit packs yet</p>
                        <Button onClick={handleCreate}>
                          <Plus className="w-4 h-4 mr-2" />
                          Create First Pack
                        </Button>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow className="border-gray-800">
                            <TableHead className="text-gray-400">Name</TableHead>
                            <TableHead className="text-gray-400">Credits</TableHead>
                            <TableHead className="text-gray-400">Price</TableHead>
                            <TableHead className="text-gray-400">$/Credit</TableHead>
                            <TableHead className="text-gray-400">Status</TableHead>
                            <TableHead className="text-gray-400">Order</TableHead>
                            <TableHead className="text-gray-400">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {creditPacks.map((pack) => (
                            <TableRow key={pack._id} className="border-gray-800">
                              <TableCell className="text-white">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{pack.name}</span>
                                  {pack.isPopular && <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />}
                                </div>
                                <div className="text-sm text-gray-400">{pack.code}</div>
                              </TableCell>
                              <TableCell className="text-white">
                                <div>
                                  <div className="font-medium">{pack.totalCredits}</div>
                                  {pack.bonusCredits > 0 && (
                                    <div className="text-xs text-green-400">
                                      {pack.credits} + {pack.bonusCredits} bonus
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-white">
                                {pack.currency} ${pack.price}
                              </TableCell>
                              <TableCell className="text-gray-400">
                                ${(pack.price / pack.totalCredits).toFixed(2)}
                              </TableCell>
                              <TableCell>
                                {pack.isActive ? (
                                  <Badge className="bg-green-500">Active</Badge>
                                ) : (
                                  <Badge className="bg-gray-500">Inactive</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-gray-400">{pack.displayOrder}</TableCell>
                              <TableCell>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    onClick={() => handleEdit(pack)}
                                    className="bg-blue-600 hover:bg-blue-700 text-white border-0"
                                  >
                                    <Edit className="w-4 h-4 mr-1.5" />
                                    Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => handleDelete(pack)}
                                    className="bg-red-600 hover:bg-red-700 text-white border-0"
                                  >
                                    <Trash2 className="w-4 h-4 mr-1.5" />
                                    Delete
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ==================== PURCHASE REQUESTS TAB ==================== */}
              <TabsContent value="requests">
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader>
                    <CardTitle className="text-white">Credit Purchase Requests</CardTitle>
                    <CardDescription className="text-gray-400">
                      Review and manage credit purchase requests from organizations
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Tabs value={requestsTab} onValueChange={setRequestsTab} className="space-y-4">
                      <TabsList className="bg-gray-800">
                        <TabsTrigger value="pending" className="data-[state=active]:bg-gray-700 data-[state=active]:text-white text-gray-300 hover:text-white">
                          Pending ({requests.filter(r => r.status === 'pending').length})
                        </TabsTrigger>
                        <TabsTrigger value="approved" className="data-[state=active]:bg-gray-700 data-[state=active]:text-white text-gray-300 hover:text-white">Approved</TabsTrigger>
                        <TabsTrigger value="rejected" className="data-[state=active]:bg-gray-700 data-[state=active]:text-white text-gray-300 hover:text-white">Rejected</TabsTrigger>
                        <TabsTrigger value="all" className="data-[state=active]:bg-gray-700 data-[state=active]:text-white text-gray-300 hover:text-white">All</TabsTrigger>
                      </TabsList>

                      {requestsLoading ? (
                        <div className="flex justify-center py-8">
                          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                        </div>
                      ) : requestsError ? (
                        <div className="text-center py-8">
                          <p className="text-red-400">{requestsError}</p>
                          <Button onClick={loadRequests} className="mt-4" variant="outline">
                            Retry
                          </Button>
                        </div>
                      ) : filteredRequests.length === 0 ? (
                        <div className="text-center py-12">
                          <Clock className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                          <p className="text-gray-400">No {requestsTab !== 'all' && requestsTab} requests</p>
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow className="border-gray-800">
                              <TableHead className="text-gray-400">Organization</TableHead>
                              <TableHead className="text-gray-400">Requested By</TableHead>
                              <TableHead className="text-gray-400">Pack</TableHead>
                              <TableHead className="text-gray-400">Credits</TableHead>
                              <TableHead className="text-gray-400">Price</TableHead>
                              <TableHead className="text-gray-400">Status</TableHead>
                              <TableHead className="text-gray-400">Date</TableHead>
                              <TableHead className="text-gray-400">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredRequests.map((request) => (
                              <TableRow key={request._id} className="border-gray-800">
                                <TableCell className="text-white">
                                  <div className="flex items-center gap-2">
                                    <Building2 className="w-4 h-4 text-gray-400" />
                                    {request.organization.name}
                                  </div>
                                </TableCell>
                                <TableCell className="text-white">
                                  <div className="flex items-center gap-2">
                                    <User className="w-4 h-4 text-gray-400" />
                                    {getUserName(request.requestedBy)}
                                  </div>
                                  <div className="text-xs text-gray-400">{request.requestedBy.email}</div>
                                </TableCell>
                                <TableCell className="text-white">
                                  <div className="font-medium">{request.packDetails.name}</div>
                                  <div className="text-xs text-gray-400">{request.packDetails.code}</div>
                                </TableCell>
                                <TableCell className="text-white">
                                  <div className="font-medium">{request.packDetails.totalCredits}</div>
                                  {request.packDetails.bonusCredits > 0 && (
                                    <div className="text-xs text-green-400">
                                      +{request.packDetails.bonusCredits} bonus
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell className="text-white">
                                  {request.packDetails.currency} ${request.packDetails.price}
                                </TableCell>
                                <TableCell>{getStatusBadge(request.status)}</TableCell>
                                <TableCell className="text-gray-400 text-sm">
                                  {formatDate(request.createdAt)}
                                </TableCell>
                                <TableCell>
                                  {request.status === 'pending' ? (
                                    <div className="flex gap-2">
                                      <Button
                                        size="sm"
                                        onClick={() => handleReview(request, 'approve')}
                                        className="bg-green-600 hover:bg-green-700 text-white border-0 min-w-[100px]"
                                      >
                                        <Check className="w-4 h-4 mr-1.5" />
                                        Approve
                                      </Button>
                                      <Button
                                        size="sm"
                                        onClick={() => handleReview(request, 'reject')}
                                        className="bg-red-600 hover:bg-red-700 text-white border-0 min-w-[100px]"
                                      >
                                        <X className="w-4 h-4 mr-1.5" />
                                        Reject
                                      </Button>
                                    </div>
                                  ) : (
                                    <span className="text-gray-400 text-sm">
                                      {request.reviewedAt ? `Reviewed ${formatDate(request.reviewedAt)}` : 'N/A'}
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </Tabs>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>

      {/* ==================== MODALS ==================== */}

      {/* Create/Edit Credit Pack Modal */}
      <Dialog open={isFormModalOpen} onOpenChange={setIsFormModalOpen}>
        <DialogContent className="bg-gray-800 border-gray-700 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPack ? 'Edit Credit Pack' : 'Create Credit Pack'}</DialogTitle>
            <DialogDescription className="text-gray-400">
              {editingPack ? 'Update credit pack details' : 'Add a new credit pack for purchase'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-white font-semibold">Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => handleFormChange('name', e.target.value)}
                  placeholder="e.g., Starter Pack"
                  className="bg-gray-900 border-gray-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="code" className="text-white font-semibold">Code *</Label>
                <Input
                  id="code"
                  value={formData.code}
                  onChange={(e) => handleFormChange('code', e.target.value)}
                  placeholder="e.g., starter-100"
                  className="bg-gray-900 border-gray-700 text-white"
                />
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description" className="text-white font-semibold">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => handleFormChange('description', e.target.value)}
                placeholder="Brief description of the pack"
                className="bg-gray-900 border-gray-700 text-white"
                rows={2}
              />
            </div>

            {/* Credits and Bonus */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="credits" className="text-white font-semibold">Base Credits *</Label>
                <Input
                  id="credits"
                  type="number"
                  min="1"
                  value={formData.credits}
                  onChange={(e) => handleFormChange('credits', parseInt(e.target.value) || 0)}
                  className="bg-gray-900 border-gray-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bonusCredits" className="text-white font-semibold">Bonus Credits</Label>
                <Input
                  id="bonusCredits"
                  type="number"
                  min="0"
                  value={formData.bonusCredits}
                  onChange={(e) => handleFormChange('bonusCredits', parseInt(e.target.value) || 0)}
                  className="bg-gray-900 border-gray-700 text-white"
                />
              </div>
            </div>

            {/* Total Credits Display */}
            <div className="bg-gray-900 p-3 rounded-lg border border-gray-700">
              <div className="text-sm text-gray-400">Total Credits</div>
              <div className="text-2xl font-bold text-yellow-400">
                {formData.credits + formData.bonusCredits}
              </div>
            </div>

            {/* Price and Currency */}
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="price" className="text-white font-semibold">Price *</Label>
                <Input
                  id="price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.price}
                  onChange={(e) => handleFormChange('price', parseFloat(e.target.value) || 0)}
                  className="bg-gray-900 border-gray-700 text-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="currency" className="text-white font-semibold">Currency</Label>
                <Input
                  id="currency"
                  value={formData.currency}
                  onChange={(e) => handleFormChange('currency', e.target.value.toUpperCase())}
                  placeholder="USD"
                  className="bg-gray-900 border-gray-700 text-white"
                />
              </div>
            </div>

            {/* Features */}
            <div className="space-y-2">
              <Label htmlFor="features" className="text-white font-semibold">Features (one per line)</Label>
              <Textarea
                id="features"
                value={formData.features}
                onChange={(e) => handleFormChange('features', e.target.value)}
                placeholder="Feature 1&#10;Feature 2&#10;Feature 3"
                className="bg-gray-900 border-gray-700 text-white"
                rows={3}
              />
            </div>

            {/* Settings */}
            <div className="space-y-4 pt-4 border-t border-gray-700">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-white font-semibold">Popular Pack</Label>
                  <p className="text-xs text-gray-400">Show as popular option</p>
                </div>
                <Switch
                  checked={formData.isPopular}
                  onCheckedChange={(checked) => handleFormChange('isPopular', checked)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-white font-semibold">Active</Label>
                  <p className="text-xs text-gray-400">Available for purchase</p>
                </div>
                <Switch
                  checked={formData.isActive}
                  onCheckedChange={(checked) => handleFormChange('isActive', checked)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="displayOrder" className="text-white font-semibold">Display Order</Label>
                <Input
                  id="displayOrder"
                  type="number"
                  value={formData.displayOrder}
                  onChange={(e) => handleFormChange('displayOrder', parseInt(e.target.value) || 0)}
                  className="bg-gray-900 border-gray-700 text-white"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFormModalOpen(false)} className="border-gray-700">
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={processing} className="bg-blue-600 hover:bg-blue-700">
              {processing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>{editingPack ? 'Update' : 'Create'} Pack</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent className="bg-gray-800 border-gray-700 text-white">
          <DialogHeader>
            <DialogTitle>Delete Credit Pack</DialogTitle>
            <DialogDescription className="text-gray-400">
              Are you sure you want to delete <strong>{deletingPack?.name}</strong>?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteModalOpen(false)} className="border-gray-700">
              Cancel
            </Button>
            <Button onClick={confirmDelete} disabled={processing} variant="destructive">
              {processing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Request Modal */}
      <Dialog open={isReviewModalOpen} onOpenChange={setIsReviewModalOpen}>
        <DialogContent className="bg-gray-800 border-gray-700 text-white">
          <DialogHeader>
            <DialogTitle>
              {reviewAction === 'approve' ? 'Approve' : 'Reject'} Purchase Request
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              {selectedRequest && (
                <div className="space-y-2 mt-4">
                  <p><strong>Organization:</strong> {selectedRequest.organization.name}</p>
                  <p><strong>Pack:</strong> {selectedRequest.packDetails.name}</p>
                  <p><strong>Credits:</strong> {selectedRequest.packDetails.totalCredits}</p>
                  <p><strong>Price:</strong> {selectedRequest.packDetails.currency} ${selectedRequest.packDetails.price}</p>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reviewNotes" className="text-white font-semibold">Review Notes (Optional)</Label>
              <Textarea
                id="reviewNotes"
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Add any notes about this decision..."
                className="bg-gray-900 border-gray-700 text-white"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsReviewModalOpen(false)} className="border-gray-700">
              Cancel
            </Button>
            <Button
              onClick={submitReview}
              disabled={processing}
              className={reviewAction === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
            >
              {processing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>{reviewAction === 'approve' ? 'Approve' : 'Reject'} Request</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

