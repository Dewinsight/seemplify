'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Database, 
  RefreshCw, 
  Users, 
  Briefcase,
  Loader2,
  AlertTriangle,
  Info
} from 'lucide-react';
import { 
  getEmbeddingStatus, 
  reEmbedAllJobs, 
  reEmbedAllCandidates, 
  reEmbedAll,
  type EmbeddingStatus,
  type ReEmbeddingResult 
} from '@/services/embeddingService';

export default function EmbeddingManagementPage() {
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [reEmbedding, setReEmbedding] = useState<string | null>(null);
  const [result, setResult] = useState<ReEmbeddingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getEmbeddingStatus();
      setStatus(response.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch embedding status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleReEmbed = async (type: 'jobs' | 'candidates' | 'all') => {
    try {
      setReEmbedding(type);
      setError(null);
      setResult(null);

      let reEmbedResult: ReEmbeddingResult;
      switch (type) {
        case 'jobs':
          reEmbedResult = await reEmbedAllJobs();
          break;
        case 'candidates':
          reEmbedResult = await reEmbedAllCandidates();
          break;
        case 'all':
          reEmbedResult = await reEmbedAll();
          break;
      }

      setResult(reEmbedResult);
      // Refresh status after re-embedding
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Re-embedding failed');
    } finally {
      setReEmbedding(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getStatusColor = (percentage: number) => {
    if (percentage >= 90) return 'text-green-600';
    if (percentage >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getStatusIcon = (percentage: number) => {
    if (percentage >= 90) return <CheckCircle2 className="h-5 w-5 text-green-600" />;
    if (percentage >= 70) return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
    return <AlertCircle className="h-5 w-5 text-red-600" />;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              AI Embedding Management
            </h1>
            <p className="text-gray-600">
              Manage and monitor AI embeddings for enhanced candidate matching and search functionality
            </p>
          </div>

          {/* Skills Fix Alert */}
          <Alert className="mb-6 border-blue-200 bg-blue-50">
            <Info className="h-4 w-4" />
            <AlertTitle>Skills Matching Fix Available</AlertTitle>
            <AlertDescription>
              A critical fix has been implemented for skills parsing. Re-embed jobs to fix the "skills match 0%" issue 
              and get accurate skills analysis. Click "Re-embed Jobs Only" below to apply the fix.
            </AlertDescription>
          </Alert>

          {/* Error Display */}
          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Success Result */}
          {result && !error && (
            <Alert className="mb-6 border-green-200 bg-green-50">
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Re-embedding Completed</AlertTitle>
              <AlertDescription>
                {result.msg}
                {result.duration && ` Duration: ${result.duration}`}
                {result.jobs && (
                  <div className="mt-2">
                    <strong>Jobs:</strong> {result.jobs.success}/{result.jobs.total} successful
                    {result.jobs.errors > 0 && <span className="text-red-600 ml-2">({result.jobs.errors} errors)</span>}
                  </div>
                )}
                {result.candidates && (
                  <div className="mt-1">
                    <strong>Candidates:</strong> {result.candidates.success}/{result.candidates.total} successful
                    {result.candidates.errors > 0 && <span className="text-red-600 ml-2">({result.candidates.errors} errors)</span>}
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="actions">Re-embedding Actions</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <span className="ml-2">Loading embedding status...</span>
                </div>
              ) : status ? (
                <>
                  {/* Status Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Jobs Status */}
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Job Embeddings</CardTitle>
                        <Briefcase className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center space-x-2 mb-2">
                          {getStatusIcon(status.jobs.percentage)}
                          <div className="text-2xl font-bold">{status.jobs.embedded}/{status.jobs.total}</div>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">
                          {status.jobs.percentage}% of jobs have embeddings
                        </p>
                        <Progress value={status.jobs.percentage} className="h-2" />
                      </CardContent>
                    </Card>

                    {/* Candidates Status */}
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Candidate Embeddings</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center space-x-2 mb-2">
                          {getStatusIcon(status.candidates.percentage)}
                          <div className="text-2xl font-bold">{status.candidates.embedded}/{status.candidates.total}</div>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">
                          {status.candidates.percentage}% of candidates have embeddings
                        </p>
                        <Progress value={status.candidates.percentage} className="h-2" />
                      </CardContent>
                    </Card>
                  </div>

                  {/* Recent Activity */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Recent Job Embeddings */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Recent Job Embeddings</CardTitle>
                        <CardDescription>Last 5 jobs with embeddings created</CardDescription>
                      </CardHeader>
                      <CardContent>
                        {status.jobs.recent.length > 0 ? (
                          <div className="space-y-3">
                            {status.jobs.recent.map((job) => (
                              <div key={job._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                <div>
                                  <p className="font-medium text-sm">{job.title}</p>
                                  <p className="text-xs text-gray-500">
                                    <Clock className="h-3 w-3 inline mr-1" />
                                    {formatDate(job.embeddingCreatedAt)}
                                  </p>
                                </div>
                                <Badge variant="secondary">Embedded</Badge>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-center text-gray-500 py-4">No recent job embeddings</p>
                        )}
                      </CardContent>
                    </Card>

                    {/* Recent Candidate Embeddings */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Recent Candidate Embeddings</CardTitle>
                        <CardDescription>Last 5 candidates with embeddings created</CardDescription>
                      </CardHeader>
                      <CardContent>
                        {status.candidates.recent.length > 0 ? (
                          <div className="space-y-3">
                            {status.candidates.recent.map((candidate) => (
                              <div key={candidate._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                <div>
                                  <p className="font-medium text-sm">
                                    {candidate.firstName} {candidate.lastName}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    <Clock className="h-3 w-3 inline mr-1" />
                                    {formatDate(candidate.embeddingCreatedAt)}
                                  </p>
                                </div>
                                <Badge variant="secondary">Embedded</Badge>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-center text-gray-500 py-4">No recent candidate embeddings</p>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Status Info */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center">
                        <Database className="h-5 w-5 mr-2" />
                        System Information
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-blue-600">{status.jobs.total + status.candidates.total}</div>
                          <div className="text-sm text-gray-500">Total Entities</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-green-600">{status.jobs.embedded + status.candidates.embedded}</div>
                          <div className="text-sm text-gray-500">Total Embedded</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-purple-600">
                            {Math.round(((status.jobs.embedded + status.candidates.embedded) / (status.jobs.total + status.candidates.total)) * 100)}%
                          </div>
                          <div className="text-sm text-gray-500">Overall Coverage</div>
                        </div>
                      </div>
                      <Separator className="my-4" />
                      <p className="text-sm text-gray-500">
                        Last updated: {formatDate(status.timestamp)}
                      </p>
                    </CardContent>
                  </Card>
                </>
              ) : null}
            </TabsContent>

            <TabsContent value="actions" className="space-y-6">
              <div className="grid grid-cols-1 gap-6">
                {/* Re-embed Jobs (Skills Fix) */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center">
                      <Briefcase className="h-5 w-5 mr-2" />
                      Re-embed Jobs (Fix Skills Matching)
                    </CardTitle>
                    <CardDescription>
                      Recommended: Fixes the skills parsing issue where skills matching showed 0%. 
                      This updates job embeddings with proper skills parsing.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <Alert className="border-blue-200 bg-blue-50">
                        <CheckCircle2 className="h-4 w-4" />
                        <AlertTitle>What this fixes:</AlertTitle>
                        <AlertDescription>
                          • Skills matching showing 0% or incorrect percentages<br/>
                          • Job skills stored as single comma-separated strings<br/>
                          • Inaccurate candidate rankings based on skills
                        </AlertDescription>
                      </Alert>
                      <Button 
                        onClick={() => handleReEmbed('jobs')}
                        disabled={reEmbedding === 'jobs'}
                        className="w-full"
                      >
                        {reEmbedding === 'jobs' ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Re-embedding Jobs...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Re-embed Jobs Only
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Re-embed Candidates */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center">
                      <Users className="h-5 w-5 mr-2" />
                      Re-embed Candidates
                    </CardTitle>
                    <CardDescription>
                      Re-create embeddings for all candidates. Use this for consistency or after major updates.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button 
                      onClick={() => handleReEmbed('candidates')}
                      disabled={reEmbedding === 'candidates'}
                      variant="outline"
                      className="w-full"
                    >
                      {reEmbedding === 'candidates' ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Re-embedding Candidates...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Re-embed Candidates Only
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                {/* Re-embed Everything */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center">
                      <Database className="h-5 w-5 mr-2" />
                      Re-embed Everything
                    </CardTitle>
                    <CardDescription>
                      Complete re-embedding of both jobs and candidates. This process may take several minutes.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Alert className="mb-4 border-yellow-200 bg-yellow-50">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Warning</AlertTitle>
                      <AlertDescription>
                        This will re-process all embeddings and may take a significant amount of time.
                        Use this only when necessary.
                      </AlertDescription>
                    </Alert>
                    <Button 
                      onClick={() => handleReEmbed('all')}
                      disabled={reEmbedding === 'all'}
                      variant="outline"
                      className="w-full"
                    >
                      {reEmbedding === 'all' ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Re-embedding Everything...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Re-embed Everything
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                {/* Refresh Status */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Refresh Status</CardTitle>
                    <CardDescription>
                      Update the embedding status information from the server.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button 
                      onClick={fetchStatus}
                      disabled={loading}
                      variant="outline"
                      className="w-full"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Refreshing...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Refresh Status
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
} 