"use client";

import React, { useState, useEffect } from 'react';
import { Checkbox } from './checkbox';
import { Label } from './label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { Badge } from './badge';
import { ScrollArea } from './scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';
import { Alert, AlertDescription } from './alert';
import { Button } from './button';
import { Search, RefreshCw, Filter, CheckCircle2, AlertCircle } from 'lucide-react';
import { Input } from './input';
import { InterviewQuestion } from '@/services/interviewService';
import { apiRequest } from '@/services/apiConfig';

interface InterviewQuestionSelectorProps {
  jobId: string | undefined;
  selectedQuestionIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

export function InterviewQuestionSelector({
  jobId,
  selectedQuestionIds,
  onSelectionChange
}: InterviewQuestionSelectorProps) {
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'technical' | 'behavioral' | 'situational'>('all');
  
  // Fetch questions when jobId changes
  useEffect(() => {
    if (jobId) {
      fetchQuestions();
    } else {
      setQuestions([]);
      setError('No job selected');
    }
  }, [jobId]);
  
  const fetchQuestions = async () => {
    if (!jobId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await apiRequest(`/api/jobs/${jobId}/interview-questions`, {
        method: 'GET'
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch questions: ${response.status}`);
      }
      
      const data = await response.json();
      setQuestions(data.questions || []);
    } catch (err: any) {
      console.error('Error fetching interview questions:', err);
      setError(err.message || 'Failed to load interview questions');
    } finally {
      setLoading(false);
    }
  };
  
  const handleQuestionSelect = (questionId: string) => {
    const updatedSelection = selectedQuestionIds.includes(questionId)
      ? selectedQuestionIds.filter(id => id !== questionId)
      : [...selectedQuestionIds, questionId];
    
    onSelectionChange(updatedSelection);
  };
  
  const filterQuestions = () => {
    if (!questions) return [];
    
    let filtered = [...questions];
    
    // Apply type filter
    if (selectedFilter !== 'all') {
      filtered = filtered.filter(q => q.type === selectedFilter);
    }
    
    // Apply search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(q => 
        q.question.toLowerCase().includes(term) || 
        (q.category && q.category.toLowerCase().includes(term))
      );
    }
    
    // Apply tab filter
    if (activeTab !== 'all') {
      filtered = filtered.filter(q => q.interviewStage === activeTab);
    }
    
    return filtered;
  };
  
  const filteredQuestions = filterQuestions();
  
  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'easy': return 'bg-green-100 text-green-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'hard': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };
  
  const getTypeColor = (type: string) => {
    switch (type) {
      case 'technical': return 'bg-blue-100 text-blue-800';
      case 'behavioral': return 'bg-green-100 text-green-800';
      case 'situational': return 'bg-yellow-100 text-yellow-800';
      case 'cultural_fit': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };
  
  const formatStage = (stage: string) => {
    return stage.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  };
  
  const formatType = (type: string) => {
    return type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  };
  
  if (!jobId) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Please select a job to load interview questions.
        </AlertDescription>
      </Alert>
    );
  }
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Interview Questions</h3>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={fetchQuestions}
          disabled={loading}
        >
          {loading ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </>
          )}
        </Button>
      </div>
      
      {/* Search and Filter */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search questions..."
            className="pl-8"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <Select 
          value={selectedFilter} 
          onValueChange={(value: any) => setSelectedFilter(value)}
        >
          <SelectTrigger>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              <SelectValue placeholder="Filter by type" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="technical">Technical</SelectItem>
            <SelectItem value="behavioral">Behavioral</SelectItem>
            <SelectItem value="situational">Situational</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      {/* Stage Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full h-auto flex flex-wrap">
          <TabsTrigger value="all" className="flex-1">All Stages</TabsTrigger>
          <TabsTrigger value="screening" className="flex-1">Screening</TabsTrigger>
          <TabsTrigger value="first_round" className="flex-1">First Round</TabsTrigger>
          <TabsTrigger value="technical" className="flex-1">Technical</TabsTrigger>
          <TabsTrigger value="final" className="flex-1">Final</TabsTrigger>
        </TabsList>
        
        <TabsContent value={activeTab} className="mt-4">
          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : loading ? (
            <div className="py-8 flex items-center justify-center">
              <RefreshCw className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2">Loading questions...</span>
            </div>
          ) : filteredQuestions.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No questions found for this criteria.
            </div>
          ) : (
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3 pt-2">
                {filteredQuestions.map((question) => (
                  <div 
                    key={question._id} 
                    className={`p-4 border rounded-lg transition-colors ${
                      selectedQuestionIds.includes(question._id)
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox 
                        id={`question-${question._id}`}
                        checked={selectedQuestionIds.includes(question._id)}
                        onCheckedChange={() => handleQuestionSelect(question._id)}
                        className="mt-1"
                      />
                      <div className="flex-1 space-y-2">
                        <Label 
                          htmlFor={`question-${question._id}`}
                          className="font-medium cursor-pointer"
                        >
                          {question.question}
                        </Label>
                        
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge className={getTypeColor(question.type)}>
                            {formatType(question.type)}
                          </Badge>
                          <Badge className={getDifficultyColor(question.difficulty)}>
                            {question.difficulty.charAt(0).toUpperCase() + question.difficulty.slice(1)}
                          </Badge>
                          <Badge variant="outline">
                            {formatStage(question.interviewStage)}
                          </Badge>
                          {question.expectedAnswer && (
                            <Badge variant="outline" className="bg-gray-50">
                              With Sample Answer
                            </Badge>
                          )}
                        </div>
                        
                        {selectedQuestionIds.includes(question._id) && (
                          <div className="text-xs text-muted-foreground flex items-center">
                            <CheckCircle2 className="h-3 w-3 mr-1 text-primary" />
                            Selected for interviewers
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
      
      <div className="pt-2 border-t">
        <div className="text-sm text-muted-foreground">
          {selectedQuestionIds.length} questions selected
        </div>
      </div>
    </div>
  );
}
