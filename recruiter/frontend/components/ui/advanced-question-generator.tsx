"use client";

import React, { useState } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter 
} from './dialog';
import { Button } from './button';
import { Badge } from './badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Progress } from './progress';
import { Separator } from './separator';
import { Switch } from './switch';
import { Slider } from './slider';
import { 
  Wand2, 
  Loader2, 
  Target, 
  Brain, 
  Shield, 
  TrendingUp,
  CheckCircle,
  AlertTriangle,
  Info
} from 'lucide-react';
import { GenerateQuestionsOptions, OptimizedGenerationOptions, InterviewQuestion } from '../../services/interviewService';

interface AdvancedQuestionGeneratorProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (options: GenerateQuestionsOptions) => Promise<void>;
  onGenerateOptimized: (options: OptimizedGenerationOptions) => Promise<any>;
  isGenerating: boolean;
  jobTitle?: string;
}

const questionTypeDescriptions = {
  technical: "Role-specific technical skills and knowledge assessment",
  behavioral: "Past behavior patterns and soft skills evaluation",
  situational: "Hypothetical scenarios and problem-solving approach",
  cultural_fit: "Alignment with company values and culture",
  skills_based: "Specific skill demonstration and application",
  experience_based: "Career history and relevant experience evaluation"
};

const stageDescriptions = {
  screening: "Initial phone/video screening questions",
  first_round: "First in-person/video interview",
  technical: "Technical assessment and deep-dive",
  final: "Final decision and culture fit",
  hr: "HR policies and company information",
  panel: "Panel interview with multiple stakeholders"
};

export function AdvancedQuestionGenerator({
  isOpen,
  onClose,
  onGenerate,
  onGenerateOptimized,
  isGenerating,
  jobTitle = "this position"
}: AdvancedQuestionGeneratorProps) {
  const [activeTab, setActiveTab] = useState("standard");
  
  // Standard generation options
  const [standardOptions, setStandardOptions] = useState<GenerateQuestionsOptions>({
    stage: 'first_round',
    questionCount: 10,
    difficulty: 'medium',
    includeTypes: ['technical', 'behavioral', 'situational'],
    focusAreas: [],
    ensureDiversity: true,
    maxBiasScore: 0.3
  });

  // Optimized generation options
  const [optimizedOptions, setOptimizedOptions] = useState<OptimizedGenerationOptions>({
    totalQuestions: 15,
    stages: ['screening', 'first_round', 'technical'],
    ensureDiversity: true,
    maxBiasScore: 0.3
  });

  const [focusAreaInput, setFocusAreaInput] = useState("");

  const handleAddFocusArea = () => {
    if (focusAreaInput.trim() && !standardOptions.focusAreas?.includes(focusAreaInput.trim())) {
      setStandardOptions(prev => ({
        ...prev,
        focusAreas: [...(prev.focusAreas || []), focusAreaInput.trim()]
      }));
      setFocusAreaInput("");
    }
  };

  const handleRemoveFocusArea = (area: string) => {
    setStandardOptions(prev => ({
      ...prev,
      focusAreas: prev.focusAreas?.filter(a => a !== area) || []
    }));
  };

  const handleQuestionTypeToggle = (type: InterviewQuestion['type']) => {
    const currentTypes = standardOptions.includeTypes || [];
    const newTypes = currentTypes.includes(type)
      ? currentTypes.filter(t => t !== type)
      : [...currentTypes, type];
    
    setStandardOptions(prev => ({ ...prev, includeTypes: newTypes }));
  };

  const handleStageToggle = (stage: InterviewQuestion['interviewStage']) => {
    const currentStages = optimizedOptions.stages || [];
    const newStages = currentStages.includes(stage)
      ? currentStages.filter(s => s !== stage)
      : [...currentStages, stage];
    
    setOptimizedOptions(prev => ({ ...prev, stages: newStages }));
  };

  const handleGenerate = async () => {
    if (activeTab === "standard") {
      await onGenerate(standardOptions);
    } else {
      await onGenerateOptimized(optimizedOptions);
    }
  };

  const getQualityScoreColor = (score: number) => {
    if (score >= 0.8) return "text-green-600";
    if (score >= 0.6) return "text-yellow-600";
    return "text-red-600";
  };

  const getQualityScoreIcon = (score: number) => {
    if (score >= 0.8) return <CheckCircle className="h-4 w-4 text-green-600" />;
    if (score >= 0.6) return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
    return <AlertTriangle className="h-4 w-4 text-red-600" />;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-600" />
            Advanced AI Question Generator
          </DialogTitle>
          <DialogDescription>
            Generate sophisticated interview questions for {jobTitle} using advanced AI with quality optimization and bias detection.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="standard" className="flex items-center gap-2">
              <Wand2 className="h-4 w-4" />
              Standard Generation
            </TabsTrigger>
            <TabsTrigger value="optimized" className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              Optimized Suite
            </TabsTrigger>
          </TabsList>

          <TabsContent value="standard" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Standard Question Generation</CardTitle>
                <CardDescription>
                  Generate questions for a specific interview stage with customizable options
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Basic Options */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Interview Stage</label>
                    <select 
                      className="w-full p-2 border rounded-md"
                      value={standardOptions.stage}
                      onChange={(e) => setStandardOptions(prev => ({ 
                        ...prev, 
                        stage: e.target.value as InterviewQuestion['interviewStage']
                      }))}
                    >
                      {Object.entries(stageDescriptions).map(([stage, description]) => (
                        <option key={stage} value={stage}>
                          {stage.replace('_', ' ').toUpperCase()}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground mt-1">
                      {stageDescriptions[standardOptions.stage || 'first_round']}
                    </p>
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">Question Count</label>
                    <input 
                      type="number" 
                      min="1" 
                      max="25"
                      className="w-full p-2 border rounded-md"
                      value={standardOptions.questionCount}
                      onChange={(e) => setStandardOptions(prev => ({ 
                        ...prev, 
                        questionCount: parseInt(e.target.value) 
                      }))}
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">Difficulty Level</label>
                    <select 
                      className="w-full p-2 border rounded-md"
                      value={standardOptions.difficulty}
                      onChange={(e) => setStandardOptions(prev => ({ 
                        ...prev, 
                        difficulty: e.target.value as InterviewQuestion['difficulty']
                      }))}
                    >
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </div>
                </div>

                <Separator />

                {/* Question Types */}
                <div>
                  <label className="text-sm font-medium mb-3 block">Question Types</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {Object.entries(questionTypeDescriptions).map(([type, description]) => (
                      <div key={type} className="flex items-start space-x-3 p-3 border rounded-lg">
                        <input
                          type="checkbox"
                          id={type}
                          checked={standardOptions.includeTypes?.includes(type as InterviewQuestion['type']) || false}
                          onChange={() => handleQuestionTypeToggle(type as InterviewQuestion['type'])}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <label htmlFor={type} className="text-sm font-medium cursor-pointer">
                            {type.replace('_', ' ').toUpperCase()}
                          </label>
                          <p className="text-xs text-muted-foreground mt-1">{description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Focus Areas */}
                <div>
                  <label className="text-sm font-medium mb-2 block">Focus Areas (Optional)</label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      placeholder="e.g., React, Leadership, Communication..."
                      className="flex-1 p-2 border rounded-md"
                      value={focusAreaInput}
                      onChange={(e) => setFocusAreaInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleAddFocusArea()}
                    />
                    <Button type="button" onClick={handleAddFocusArea} variant="outline">
                      Add
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {standardOptions.focusAreas?.map((area, index) => (
                      <Badge key={index} variant="secondary" className="cursor-pointer" onClick={() => handleRemoveFocusArea(area)}>
                        {area} ×
                      </Badge>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Quality Controls */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Quality & Bias Controls
                  </h4>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-medium">Ensure Diversity</label>
                      <p className="text-xs text-muted-foreground">Optimize for question variety and coverage</p>
                    </div>
                    <Switch
                      checked={standardOptions.ensureDiversity}
                      onCheckedChange={(checked) => setStandardOptions(prev => ({ 
                        ...prev, 
                        ensureDiversity: checked 
                      }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Filter Questions with Analyzed Bias Score Above: {standardOptions.maxBiasScore}</label>
                    <Slider
                      value={[standardOptions.maxBiasScore || 0.3]}
                      onValueChange={([value]) => setStandardOptions(prev => ({ 
                        ...prev, 
                        maxBiasScore: value 
                      }))}
                      max={1}
                      min={0}
                      step={0.1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Strict (0.0)</span>
                      <span>Balanced (0.3)</span>
                      <span>Relaxed (1.0)</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This sets the highest <i>analyzed bias score</i> you'll accept for generated questions. Questions exceeding this will be filtered out. The 'Bias Score' on each generated question is its individual analysis result from the backend.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      (0.0 = Strict Filter • 0.3 = Balanced Filter • 1.0 = Relaxed Filter)
                    </p>
                  </div>


                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="optimized" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Optimized Question Suite
                </CardTitle>
                <CardDescription>
                  Generate a comprehensive, optimized set of questions across multiple interview stages
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Total Questions</label>
                    <input 
                      type="number" 
                      min="5" 
                      max="50"
                      className="w-full p-2 border rounded-md"
                      value={optimizedOptions.totalQuestions}
                      onChange={(e) => setOptimizedOptions(prev => ({ 
                        ...prev, 
                        totalQuestions: parseInt(e.target.value) 
                      }))}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Questions will be distributed across selected stages
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-medium">Ensure Diversity</label>
                        <p className="text-xs text-muted-foreground">AI optimization for variety</p>
                      </div>
                      <Switch
                        checked={optimizedOptions.ensureDiversity}
                        onCheckedChange={(checked) => setOptimizedOptions(prev => ({ 
                          ...prev, 
                          ensureDiversity: checked 
                        }))}
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Interview Stages */}
                <div>
                  <label className="text-sm font-medium mb-3 block">Interview Stages</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {Object.entries(stageDescriptions).map(([stage, description]) => (
                      <div key={stage} className="flex items-start space-x-3 p-3 border rounded-lg">
                        <input
                          type="checkbox"
                          id={`stage-${stage}`}
                          checked={optimizedOptions.stages?.includes(stage as InterviewQuestion['interviewStage']) || false}
                          onChange={() => handleStageToggle(stage as InterviewQuestion['interviewStage'])}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <label htmlFor={`stage-${stage}`} className="text-sm font-medium cursor-pointer">
                            {stage.replace('_', ' ').toUpperCase()}
                          </label>
                          <p className="text-xs text-muted-foreground mt-1">{description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Quality Thresholds */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Quality Thresholds
                  </h4>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Filter Questions with Analyzed Bias Score Above: {optimizedOptions.maxBiasScore}</label>
                      <Slider
                        value={[optimizedOptions.maxBiasScore || 0.3]}
                        onValueChange={([value]) => setOptimizedOptions(prev => ({ 
                          ...prev, 
                          maxBiasScore: value 
                        }))}
                        max={1}
                        min={0}
                        step={0.1}
                        className="w-full"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Strict (0.0)</span>
                        <span>Balanced (0.3)</span>
                        <span>Relaxed (1.0)</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        This sets the highest <i>analyzed bias score</i> you'll accept for generated questions. Questions exceeding this will be filtered out. The 'Bias Score' on each generated question is its individual analysis result from the backend.
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        (0.0 = Strict Filter • 0.3 = Balanced Filter • 1.0 = Relaxed Filter)
                      </p>
                    </div>


                  </div>
                </div>

                {/* Optimization Preview */}
                <Card className="bg-gradient-to-r from-blue-50 to-purple-50">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="h-4 w-4 text-blue-600" />
                      <span className="text-sm font-medium">Optimization Preview</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Selected Stages:</span>
                        <span className="ml-2 font-medium">{optimizedOptions.stages?.length || 0}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Questions per Stage:</span>
                        <span className="ml-2 font-medium">
                          ~{Math.floor((optimizedOptions.totalQuestions || 15) / (optimizedOptions.stages?.length || 1))}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4" />
            <span>AI-powered with bias detection and quality optimization</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button 
              onClick={handleGenerate}
              disabled={isGenerating}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Brain className="mr-2 h-4 w-4" />
                  Generate Questions
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 