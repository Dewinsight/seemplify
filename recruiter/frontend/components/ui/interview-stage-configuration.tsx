'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from '@/components/ui/dropdown-menu'
import {
  Plus,
  Trash2,
  Settings,
  Wand2,
  Users,
  Clock,
  Edit,
  Eye,
  EyeOff,
  Save,
  X,
  AlertTriangle,
  CheckCircle,
  ChevronUp,
  ChevronDown,
  Search,
  MoreHorizontal
} from 'lucide-react'
import { toast } from 'sonner'
import interviewStageService, {
  InterviewStage,
  StageTemplate,
  EvaluationCriterion,
  AIQuestionConfig,
  ProgressionRules
} from '@/services/interviewStageService'
import * as stageTemplateService from '@/services/stageTemplateService'
import { SaveAsTemplateModal } from '@/components/jobs/SaveAsTemplateModal'
import { Bookmark } from 'lucide-react'
import { useUser } from '@/context/UserContext'

interface InterviewStageConfigurationProps {
  jobId: string
  onStagesUpdate?: () => void
}

interface StageEditData extends Partial<InterviewStage> {
  isNew?: boolean
}

export function InterviewStageConfiguration({
  jobId,
  onStagesUpdate
}: InterviewStageConfigurationProps) {
  const { state: userState } = useUser()
  const [stages, setStages] = useState<InterviewStage[]>([])
  const [templates, setTemplates] = useState<Record<string, StageTemplate>>({})
  const [customTemplates, setCustomTemplates] = useState<stageTemplateService.StageTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [customTemplatesLoading, setCustomTemplatesLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState('standard')
  const [showTemplateDialog, setShowTemplateDialog] = useState(false)
  const [showStageEditor, setShowStageEditor] = useState(false)
  const [editingStage, setEditingStage] = useState<StageEditData | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [movingStage, setMovingStage] = useState<string | null>(null)
  const [showSaveAsTemplateModal, setShowSaveAsTemplateModal] = useState(false)
  const [templateSearchQuery, setTemplateSearchQuery] = useState('')
  const [templateFilter, setTemplateFilter] = useState<'all' | 'builtin' | 'custom'>('all')
  const [deletingTemplate, setDeletingTemplate] = useState<stageTemplateService.StageTemplate | null>(null)
  const [showDeleteConfirmDialog, setShowDeleteConfirmDialog] = useState(false)
  const [isDeletingTemplate, setIsDeletingTemplate] = useState(false)

  useEffect(() => {
    console.log('[InterviewStageConfig] useEffect triggered - jobId:', jobId, 'orgId:', userState.user?.currentOrganization)
    Promise.all([
      fetchStages(),
      fetchTemplates(),
      fetchCustomTemplates()
    ])
  }, [jobId, userState.user?.currentOrganization])

  const fetchStages = async () => {
    try {
      const data = await interviewStageService.getStagesForJob(jobId)
      setStages(data)
    } catch (error: any) {
      toast.error('Failed to load interview stages')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const fetchTemplates = async () => {
    try {
      const data = await interviewStageService.getTemplates()
      setTemplates(data)
    } catch (error: any) {
      toast.error('Failed to load templates')
      console.error(error)
    }
  }

  const fetchCustomTemplates = async () => {
    console.log('[Custom Templates] fetchCustomTemplates called')
    console.log('[Custom Templates] Current state - customTemplatesLoading:', customTemplatesLoading)

    // Prevent duplicate calls
    if (customTemplatesLoading) {
      console.log('[Custom Templates] Already loading, skipping duplicate call')
      return
    }

    setCustomTemplatesLoading(true)
    try {
      const orgId = userState.user?.currentOrganization
      console.log('[Custom Templates] Fetching for org:', orgId)
      console.log('[Custom Templates] User state:', {
        hasUser: !!userState.user,
        currentOrg: userState.user?.currentOrganization,
        userName: userState.user?.profile?.displayName || `${userState.user?.profile?.firstName || ''} ${userState.user?.profile?.lastName || ''}`.trim() || 'Unknown'
      })

      if (!orgId) {
        console.warn('[Custom Templates] ❌ No organization ID found - cannot fetch templates')
        setCustomTemplates([])
        return
      }

      console.log('[Custom Templates] ✅ Making API call to /api/organizations/' + orgId + '/stage-templates')
      const data = await stageTemplateService.getTemplates(orgId)
      console.log('[Custom Templates] ✅ Successfully loaded:', data.length, 'templates')
      console.log('[Custom Templates] Template details:', data.map(t => ({ id: t._id, name: t.name, stages: t.stages?.length })))
      setCustomTemplates(data)
    } catch (error: any) {
      console.error('[Custom Templates] ❌ Failed to load:', error)
      console.error('[Custom Templates] Error details:', {
        message: error.message,
        stack: error.stack,
        response: error.response
      })
      // Set empty array but don't show error toast - templates are optional
      setCustomTemplates([])
    } finally {
      console.log('[Custom Templates] Setting customTemplatesLoading to false')
      setCustomTemplatesLoading(false)
    }
  }

  const handleCreateDefaultStages = async () => {
    try {
      setLoading(true)
      await interviewStageService.createDefaultStages(jobId, selectedTemplate)
      await fetchStages()
      setShowTemplateDialog(false)
      toast.success('Default stages created successfully')
      onStagesUpdate?.()
    } catch (error: any) {
      toast.error(error.message || 'Failed to create default stages')
    } finally {
      setLoading(false)
    }
  }

  const handleApplyCustomTemplate = async (templateId: string) => {
    try {
      setLoading(true)
      console.log('Applying custom template:', templateId, 'to job:', jobId)

      await stageTemplateService.applyTemplateToJob(jobId, templateId)
      await fetchStages()
      setShowTemplateDialog(false)
      toast.success('Template applied successfully')
      onStagesUpdate?.()
    } catch (error: any) {
      console.error('Failed to apply template:', error)
      toast.error(error.message || 'Failed to apply template')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveAsTemplateSuccess = () => {
    console.log('Template save success callback triggered, refreshing templates...')
    // Toast is already shown in the modal, just refresh the list
    fetchCustomTemplates()
  }

  const handleMoveStage = async (stageId: string, newPosition: number) => {
    const stage = stages.find(s => s._id === stageId)
    if (!stage) return

    setMovingStage(stageId)

    try {
      // Create new array with updated positions
      const updatedStages = [...stages]
      const currentIndex = updatedStages.findIndex(s => s._id === stageId)
      const [movedStage] = updatedStages.splice(currentIndex, 1)
      updatedStages.splice(newPosition, 0, movedStage)

      // Update order numbers
      const stagesWithNewOrder = updatedStages.map((stage, index) => ({
        ...stage,
        order: index + 1
      }))

      setStages(stagesWithNewOrder)

      // Save new order
      await interviewStageService.reorderStages(
        jobId,
        stagesWithNewOrder.map(s => ({ stageId: s._id, newOrder: s.order }))
      )

      toast.success('Stage moved successfully')
    } catch (error: any) {
      toast.error('Failed to move stage')
      fetchStages() // Revert on error
    } finally {
      setMovingStage(null)
    }
  }

  const handleDeleteStage = async (stageId: string, stageName: string) => {
    if (!confirm(`Are you sure you want to delete the "${stageName}" stage?`)) return

    try {
      console.log('🗑️ Deleting stage:', { stageId, stageName })

      // Show loading toast
      const loadingToast = toast.loading('Deleting stage...')

      // Call the service to delete the stage
      await interviewStageService.deleteStage(stageId)

      // Update local state
      setStages(prevStages => prevStages.filter(s => s._id !== stageId))

      // Dismiss loading toast and show success
      toast.dismiss(loadingToast)
      toast.success(`Stage "${stageName}" deleted successfully`)

      // Notify parent component
      onStagesUpdate?.()
    } catch (error: any) {
      console.error('❌ Failed to delete stage:', error)
      toast.error(error.message || 'Failed to delete stage')
    }
  }

  const handleToggleStageActive = async (stageId: string) => {
    try {
      const updatedStage = await interviewStageService.toggleStageActive(stageId)
      setStages(stages.map(s => s._id === stageId ? updatedStage : s))
      toast.success(`Stage ${updatedStage.isActive ? 'activated' : 'deactivated'} successfully`)
    } catch (error: any) {
      toast.error('Failed to toggle stage status')
    }
  }

  const handleEditStage = (stage?: InterviewStage) => {
    console.log('🎯 handleEditStage called', { stage })

    // First set showStageEditor to false to ensure React registers the state change
    setShowStageEditor(false)

    // Use setTimeout to ensure React processes the state update before opening the dialog
    setTimeout(() => {
      if (stage) {
        setEditingStage({ ...stage })
      } else {
        // Create new stage
        setEditingStage({
          isNew: true,
          name: '',
          type: 'custom',
          description: '',
          defaultDuration: 60,
          requiredInterviewers: 1,
          interviewerRoles: [],
          evaluationCriteria: [
            { name: 'Overall Assessment', type: 'behavioral', weight: 100, description: '' }
          ],
          aiQuestionGeneration: {
            enabled: true,
            questionTypes: ['behavioral'],
            questionCount: 10,
            difficulty: 'medium',
            focusAreas: []
          },
          progressionRules: {
            autoProgress: false,
            requiredApprovals: 1,
            conditions: []
          },
          isActive: true
        })
      }
      setValidationErrors([])
      setShowStageEditor(true)
      console.log('🎯 Dialog should open now', { showStageEditor: true })
    }, 50)
  }

  const handleSaveStage = async () => {
    if (!editingStage) return

    // Validate stage data
    const validation = interviewStageService.validateStage(editingStage)
    if (!validation.isValid) {
      setValidationErrors(validation.errors)
      return
    }

    try {
      setSaving(true)
      setValidationErrors([])

      if (editingStage.isNew) {
        const newStage = await interviewStageService.createCustomStage(jobId, editingStage)
        setStages([...stages, newStage])
        toast.success('Stage created successfully')
      } else {
        const updatedStage = await interviewStageService.updateStage(editingStage._id!, editingStage)
        setStages(stages.map(s => s._id === updatedStage._id ? updatedStage : s))
        toast.success('Stage updated successfully')
      }

      setShowStageEditor(false)
      setEditingStage(null)
      onStagesUpdate?.()
    } catch (error: any) {
      toast.error(error.message || 'Failed to save stage')
    } finally {
      setSaving(false)
    }
  }

  const updateEditingStage = (updates: Partial<StageEditData>) => {
    if (editingStage) {
      setEditingStage({ ...editingStage, ...updates })
    }
  }

  const handleDeleteTemplateClick = (template: stageTemplateService.StageTemplate) => {
    setDeletingTemplate(template)
    setShowDeleteConfirmDialog(true)
  }

  const handleConfirmDeleteTemplate = async () => {
    if (!deletingTemplate || !userState.user?.currentOrganization) return

    try {
      setIsDeletingTemplate(true)

      await stageTemplateService.deleteTemplate(
        userState.user.currentOrganization,
        deletingTemplate._id
      )

      toast.success(`Template "${deletingTemplate.name}" deleted successfully`)

      // Refresh the custom templates list
      await fetchCustomTemplates()

      // Close dialog and reset state
      setShowDeleteConfirmDialog(false)
      setDeletingTemplate(null)
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete template')
    } finally {
      setIsDeletingTemplate(false)
    }
  }

  const updateEvaluationCriterion = (index: number, updates: Partial<EvaluationCriterion>) => {
    if (!editingStage?.evaluationCriteria) return

    const updatedCriteria = editingStage.evaluationCriteria.map((criterion, i) =>
      i === index ? { ...criterion, ...updates } : criterion
    )

    updateEditingStage({ evaluationCriteria: updatedCriteria })
  }

  const addEvaluationCriterion = () => {
    if (!editingStage?.evaluationCriteria) return

    const newCriterion: EvaluationCriterion = {
      name: '',
      type: 'behavioral',
      weight: 0,
      description: ''
    }

    updateEditingStage({
      evaluationCriteria: [...editingStage.evaluationCriteria, newCriterion]
    })
  }

  const removeEvaluationCriterion = (index: number) => {
    if (!editingStage?.evaluationCriteria) return

    const updatedCriteria = editingStage.evaluationCriteria.filter((_, i) => i !== index)
    updateEditingStage({ evaluationCriteria: updatedCriteria })
  }

  const getTotalCriteriaWeight = () => {
    return editingStage?.evaluationCriteria?.reduce((sum, criterion) => sum + (criterion.weight || 0), 0) || 0
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading interview stages...</p>
        </div>
      </div>
    )
  }

  if (stages.length === 0) {
    return (
      <Card className="glass-card border-border/50 dark:border-white/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground dark:text-white">
            <Settings className="h-5 w-5" />
            Configure Interview Stages
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <div className="mb-6">
              <Wand2 className="h-12 w-12 text-purple-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2 text-foreground dark:text-white">No Interview Stages Configured</h3>
              <p className="text-muted-foreground dark:text-gray-400 mb-6">
                Get started by choosing a template for your hiring process. Templates provide a structured interview pipeline with predefined stages.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
                <DialogTrigger asChild>
                  <Button className="bg-purple-600 hover:bg-purple-700 text-white border-0">
                    <Wand2 className="h-4 w-4 mr-2" />
                    Use Template
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col bg-background border-border text-foreground dark:bg-[#0A0A0A] dark:border-white/10">
                  <DialogHeader>
                    <DialogTitle className="text-2xl text-foreground dark:text-white">Choose Interview Pipeline Template</DialogTitle>
                  </DialogHeader>

                  <Alert className="bg-blue-500/10 border-blue-500/20">
                    <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <AlertDescription className="text-blue-700 dark:text-blue-200">
                      Applying a template will create interview stages for this job.
                    </AlertDescription>
                  </Alert>

                  {/* Search and Filter */}
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search templates..."
                        value={templateSearchQuery}
                        onChange={(e) => setTemplateSearchQuery(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    <Tabs value={templateFilter} onValueChange={(v) => setTemplateFilter(v as any)} className="w-full">
                      <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="all">All Templates</TabsTrigger>
                        <TabsTrigger value="builtin">Built-in</TabsTrigger>
                        <TabsTrigger value="custom">Custom ({customTemplates.length})</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  {/* Templates Content */}
                  <div className="flex-1 overflow-y-auto pr-2 -mr-2">
                    {/* Built-in Templates */}
                    {(templateFilter === 'all' || templateFilter === 'builtin') && (
                      <div className="space-y-3 mb-6">
                        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
                          Built-in Templates
                        </h3>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {Object.entries(templates)
                            .filter(([key, template]) =>
                              !templateSearchQuery ||
                              template.name.toLowerCase().includes(templateSearchQuery.toLowerCase()) ||
                              template.description.toLowerCase().includes(templateSearchQuery.toLowerCase())
                            )
                            .map(([key, template]) => (
                              <Card
                                key={key}
                                className={`cursor-pointer transition-all duration-200 hover:bg-muted/60 dark:hover:bg-white/5 group glass-card ${selectedTemplate === key
                                  ? 'border-2 border-blue-500/50 bg-blue-500/10 shadow-lg shadow-blue-900/10'
                                  : 'border border-border/60 dark:border-white/10 hover:border-blue-500/30'
                                  }`}
                                onClick={() => setSelectedTemplate(key)}
                              >
                                <CardContent className="p-4">
                                  <div className="flex items-start gap-3 mb-2">
                                    <div className={`mt-1 w-5 h-5 rounded-full flex items-center justify-center transition-all ${selectedTemplate === key
                                      ? 'bg-blue-500 ring-4 ring-blue-100 dark:ring-blue-900'
                                      : 'bg-muted group-hover:bg-blue-200 dark:group-hover:bg-blue-900'
                                      }`}>
                                      {selectedTemplate === key && <CheckCircle className="w-3 h-3 text-white" />}
                                    </div>
                                    <div className="flex-1">
                                      <h4 className="font-semibold text-base mb-1">{template.name}</h4>
                                      <p className="text-xs text-muted-foreground line-clamp-2">
                                        {template.description}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-between text-xs text-muted-foreground mt-3 pt-3 border-t">
                                    <Badge variant="outline" className="text-xs">
                                      {template.stages} stages
                                    </Badge>
                                    <span className="flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      ~{template.estimatedDays} days
                                    </span>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Custom Templates */}
                    {(templateFilter === 'all' || templateFilter === 'custom') && (
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-purple-500"></span>
                          Custom Templates {customTemplates.length > 0 && `(${customTemplates.length})`}
                        </h3>
                        {customTemplatesLoading ? (
                          <div className="text-center py-12 text-muted-foreground">
                            <div className="animate-spin h-8 w-8 border-3 border-purple-600 border-t-transparent rounded-full mx-auto mb-3"></div>
                            <p className="text-sm font-medium">Loading custom templates...</p>
                          </div>
                        ) : customTemplates.length > 0 ? (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {customTemplates
                              .filter(template =>
                                !templateSearchQuery ||
                                template.name.toLowerCase().includes(templateSearchQuery.toLowerCase()) ||
                                (template.description && template.description.toLowerCase().includes(templateSearchQuery.toLowerCase()))
                              )
                              .map((template) => (
                                <Card
                                  key={template._id}
                                  className={`cursor-pointer transition-all duration-200 hover:bg-muted/60 dark:hover:bg-white/5 group relative glass-card ${selectedTemplate === template._id
                                    ? 'border-2 border-purple-500/50 bg-purple-500/10 shadow-lg shadow-purple-900/10'
                                    : 'border border-border/60 dark:border-white/10 hover:border-purple-500/30'
                                    }`}
                                  onClick={() => setSelectedTemplate(template._id)}
                                >
                                  <CardContent className="p-4">
                                    <div className="flex items-start gap-3 mb-2">
                                      <div className={`mt-1 w-5 h-5 rounded-full flex items-center justify-center transition-all ${selectedTemplate === template._id
                                        ? 'bg-purple-600 ring-4 ring-purple-100 dark:ring-purple-900'
                                        : 'bg-muted group-hover:bg-purple-200 dark:group-hover:bg-purple-900'
                                        }`}>
                                        {selectedTemplate === template._id && <CheckCircle className="w-3 h-3 text-white" />}
                                      </div>
                                      <div className="flex-1">
                                        <h4 className="font-semibold text-base mb-1 text-foreground dark:text-white">{template.name}</h4>
                                        <p className="text-xs text-muted-foreground dark:text-gray-400 line-clamp-2">
                                          {template.description || 'No description'}
                                        </p>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleDeleteTemplateClick(template)
                                        }}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                    <div className="flex items-center justify-between text-xs text-muted-foreground dark:text-gray-400 mt-3 pt-3 border-t border-border/60 dark:border-white/10">
                                      <Badge variant="outline" className="text-xs bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-300">
                                        {template.stages.length} stages
                                      </Badge>
                                      <span className="flex items-center gap-1">
                                        <Users className="h-3 w-3" />
                                        Used {template.usageCount}x
                                      </span>
                                    </div>
                                  </CardContent>
                                </Card>
                              ))}
                          </div>
                        ) : (
                          <div className="text-center py-12 border-2 border-dashed border-purple-200 dark:border-purple-800 rounded-lg bg-purple-50/30 dark:bg-purple-950/10">
                            <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center mx-auto mb-3 border border-purple-200 dark:border-purple-700">
                              <Bookmark className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                            </div>
                            <p className="text-sm font-medium text-muted-foreground mb-1">No custom templates yet</p>
                            <p className="text-xs text-muted-foreground/80">
                              Save your first template by clicking "Save as Template" on a job with stages
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-4 border-t mt-4">
                    <div className="text-xs text-muted-foreground">
                      {selectedTemplate && (
                        <span>
                          Selected: <span className="font-medium">
                            {customTemplates.find(t => t._id === selectedTemplate)?.name || templates[selectedTemplate]?.name}
                          </span>
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setShowTemplateDialog(false)}>
                        Cancel
                      </Button>
                      <Button
                        onClick={() => {
                          const customTemplate = customTemplates.find(t => t._id === selectedTemplate)
                          if (customTemplate) {
                            handleApplyCustomTemplate(selectedTemplate)
                          } else {
                            handleCreateDefaultStages()
                          }
                        }}
                        className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                      >
                        {customTemplates.find(t => t._id === selectedTemplate)
                          ? `Apply ${customTemplates.find(t => t._id === selectedTemplate)?.name}`
                          : `Create ${templates[selectedTemplate]?.stages} Stages`
                        }
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardContent>
      </Card >
    )
  }

  return (
    <div className="space-y-6">
      <Card className="glass-card border-white/5">
        <CardHeader className="pb-3 sm:pb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Settings className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
              <span className="hidden sm:inline">Interview Pipeline Stages</span>
              <span className="sm:hidden">Stages</span>
            </CardTitle>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              {stages.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSaveAsTemplateModal(true)}
                  className="hidden sm:flex"
                >
                  <Bookmark className="h-4 w-4 mr-2" />
                  Save as Template
                </Button>
              )}
              <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="flex-1 sm:flex-none">
                    <Wand2 className="h-3 w-3 sm:h-4 sm:w-4 mr-2" />
                    <span className="hidden sm:inline">Templates</span>
                    <span className="sm:hidden">Templates</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                  <DialogHeader>
                    <DialogTitle className="text-2xl">Choose Template</DialogTitle>
                  </DialogHeader>
                  {stages.length > 0 ? (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        This job already has {stages.length} stage(s). You can only apply templates to jobs without stages.
                        Please delete all stages first if you want to use a template.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Alert className="bg-blue-500/10 border-blue-500/20">
                      <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <AlertDescription className="text-blue-700 dark:text-blue-200">
                        Applying a template will create interview stages for this job.
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Search and Filter */}
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search templates..."
                        value={templateSearchQuery}
                        onChange={(e) => setTemplateSearchQuery(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    <Tabs value={templateFilter} onValueChange={(v) => setTemplateFilter(v as any)} className="w-full">
                      <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="all">All Templates</TabsTrigger>
                        <TabsTrigger value="builtin">Built-in</TabsTrigger>
                        <TabsTrigger value="custom">Custom ({customTemplates.length})</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  {/* Templates Content */}
                  <div className="flex-1 overflow-y-auto pr-2 -mr-2">
                    {/* Built-in Templates */}
                    {(templateFilter === 'all' || templateFilter === 'builtin') && (
                      <div className="space-y-3 mb-6">
                        <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
                          Built-in Templates
                        </h3>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {Object.entries(templates)
                            .filter(([key, template]) =>
                              !templateSearchQuery ||
                              template.name.toLowerCase().includes(templateSearchQuery.toLowerCase()) ||
                              template.description.toLowerCase().includes(templateSearchQuery.toLowerCase())
                            )
                            .map(([key, template]) => (
                              <Card
                                key={key}
                                className={`cursor-pointer transition-all duration-200 hover:bg-muted/60 dark:hover:bg-white/5 group glass-card ${selectedTemplate === key
                                  ? 'border-2 border-blue-500/50 bg-blue-500/10 shadow-lg shadow-blue-900/10'
                                  : 'border border-border/60 dark:border-white/10 hover:border-blue-500/30'
                                  }`}
                                onClick={() => setSelectedTemplate(key)}
                              >
                                <CardContent className="p-4">
                                  <div className="flex items-start gap-3 mb-2">
                                    <div className={`mt-1 w-5 h-5 rounded-full flex items-center justify-center transition-all ${selectedTemplate === key
                                      ? 'bg-blue-500 ring-4 ring-blue-100 dark:ring-blue-900'
                                      : 'bg-muted group-hover:bg-blue-200 dark:group-hover:bg-blue-900'
                                      }`}>
                                      {selectedTemplate === key && <CheckCircle className="w-3 h-3 text-white" />}
                                    </div>
                                    <div className="flex-1">
                                      <h4 className="font-semibold text-base mb-1">{template.name}</h4>
                                      <p className="text-xs text-muted-foreground line-clamp-2">
                                        {template.description}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-between text-xs text-muted-foreground mt-3 pt-3 border-t">
                                    <Badge variant="outline" className="text-xs">
                                      {template.stages} stages
                                    </Badge>
                                    <span className="flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      ~{template.estimatedDays} days
                                    </span>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Custom Templates */}
                    {(templateFilter === 'all' || templateFilter === 'custom') && (
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-purple-500"></span>
                          Custom Templates {customTemplates.length > 0 && `(${customTemplates.length})`}
                        </h3>
                        {customTemplatesLoading ? (
                          <div className="text-center py-12 text-muted-foreground">
                            <div className="animate-spin h-8 w-8 border-3 border-purple-600 border-t-transparent rounded-full mx-auto mb-3"></div>
                            <p className="text-sm font-medium">Loading custom templates...</p>
                          </div>
                        ) : customTemplates.length > 0 ? (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {customTemplates
                              .filter(template =>
                                !templateSearchQuery ||
                                template.name.toLowerCase().includes(templateSearchQuery.toLowerCase()) ||
                                (template.description && template.description.toLowerCase().includes(templateSearchQuery.toLowerCase()))
                              )
                              .map((template) => (
                                <Card
                                  key={template._id}
                                  className={`cursor-pointer transition-all duration-200 hover:shadow-lg group relative ${selectedTemplate === template._id
                                    ? 'border-2 border-purple-600 bg-purple-50 dark:bg-purple-950/20 shadow-md'
                                    : 'border hover:border-purple-400 dark:hover:border-purple-700'
                                    }`}
                                  onClick={() => setSelectedTemplate(template._id)}
                                >
                                  <CardContent className="p-4">
                                    <div className="flex items-start gap-3 mb-2">
                                      <div className={`mt-1 w-5 h-5 rounded-full flex items-center justify-center transition-all ${selectedTemplate === template._id
                                        ? 'bg-purple-600 ring-4 ring-purple-100 dark:ring-purple-900'
                                        : 'bg-muted group-hover:bg-purple-200 dark:group-hover:bg-purple-900'
                                        }`}>
                                        {selectedTemplate === template._id && <CheckCircle className="w-3 h-3 text-white" />}
                                      </div>
                                      <div className="flex-1">
                                        <h4 className="font-semibold text-base mb-1">{template.name}</h4>
                                        <p className="text-xs text-muted-foreground line-clamp-2">
                                          {template.description || 'No description'}
                                        </p>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleDeleteTemplateClick(template)
                                        }}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                    <div className="flex items-center justify-between text-xs text-muted-foreground mt-3 pt-3 border-t">
                                      <Badge variant="outline" className="text-xs bg-purple-50 dark:bg-purple-950/30 border-purple-300 dark:border-purple-700">
                                        {template.stages.length} stages
                                      </Badge>
                                      <span className="flex items-center gap-1">
                                        <Users className="h-3 w-3" />
                                        Used {template.usageCount}x
                                      </span>
                                    </div>
                                  </CardContent>
                                </Card>
                              ))}
                          </div>
                        ) : (
                          <div className="text-center py-12 border-2 border-dashed border-purple-200 dark:border-purple-800 rounded-lg bg-purple-50/30 dark:bg-purple-950/10">
                            <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center mx-auto mb-3">
                              <Bookmark className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                            </div>
                            <p className="text-sm font-medium text-muted-foreground mb-1">No custom templates yet</p>
                            <p className="text-xs text-muted-foreground">
                              Save your first template by clicking "Save as Template" on a job with stages
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-4 border-t mt-4">
                    <div className="text-xs text-muted-foreground">
                      {selectedTemplate && stages.length === 0 && (
                        <span>
                          Selected: <span className="font-medium">
                            {customTemplates.find(t => t._id === selectedTemplate)?.name || templates[selectedTemplate]?.name}
                          </span>
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setShowTemplateDialog(false)}>
                        Cancel
                      </Button>
                      <Button
                        onClick={() => {
                          const customTemplate = customTemplates.find(t => t._id === selectedTemplate)
                          if (customTemplate) {
                            handleApplyCustomTemplate(selectedTemplate)
                          } else {
                            handleCreateDefaultStages()
                          }
                        }}
                        disabled={stages.length > 0}
                        className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                      >
                        {customTemplates.find(t => t._id === selectedTemplate)
                          ? `Apply ${customTemplates.find(t => t._id === selectedTemplate)?.name}`
                          : `Replace with ${templates[selectedTemplate]?.name}`
                        }
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              <Button
                size="sm"
                onClick={() => handleEditStage()}
                className="w-full sm:w-auto"
              >
                <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-2" />
                <span className="hidden sm:inline">Add Stage</span>
                <span className="sm:hidden">Add</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {stages.map((stage, index) => (
              <Card key={stage._id} className="transition-all duration-200 hover:bg-white/5 border-0 border-l-[3px] border-l-blue-500 glass-card">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex flex-col gap-3">
                    {/* Mobile Header Row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Badge variant="outline" className="text-xs px-2 py-1 flex-shrink-0 bg-white/5 border-white/10 text-gray-400">
                          #{stage.order}
                        </Badge>
                        <h3 className="font-semibold text-sm sm:text-base truncate text-white">{stage.name}</h3>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={movingStage === stage._id}
                            className="h-8 w-8 p-0 hover:bg-white/10 text-gray-400 hover:text-white flex-shrink-0"
                          >
                            {movingStage === stage._id ? (
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                            ) : (
                              <MoreHorizontal className="h-4 w-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="bg-[#1A1A1A] border-white/10 text-gray-300">
                          <DropdownMenuLabel className="text-gray-400">Move Stage</DropdownMenuLabel>
                          <DropdownMenuSeparator className="bg-white/10" />

                          {index > 0 && (
                            <DropdownMenuItem
                              onClick={() => handleMoveStage(stage._id, index - 1)}
                              disabled={movingStage === stage._id}
                              className="focus:bg-white/10 focus:text-white"
                            >
                              <ChevronUp className="h-4 w-4 mr-2" />
                              Move Up
                            </DropdownMenuItem>
                          )}

                          {index < stages.length - 1 && (
                            <DropdownMenuItem
                              onClick={() => handleMoveStage(stage._id, index + 1)}
                              disabled={movingStage === stage._id}
                              className="focus:bg-white/10 focus:text-white"
                            >
                              <ChevronDown className="h-4 w-4 mr-2" />
                              Move Down
                            </DropdownMenuItem>
                          )}

                          {stages.length > 2 && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuLabel>Move to Position</DropdownMenuLabel>

                              {stages.map((targetStage, targetIndex) => {
                                if (targetIndex === index) return null
                                return (
                                  <DropdownMenuItem
                                    key={targetStage._id}
                                    onClick={() => handleMoveStage(stage._id, targetIndex)}
                                    disabled={movingStage === stage._id}
                                    className="text-sm"
                                  >
                                    {targetIndex + 1}. {targetStage.name}
                                  </DropdownMenuItem>
                                )
                              })}
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Stage Details */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary" className="capitalize text-xs bg-blue-500/10 text-blue-300 border border-blue-500/20">
                          {stage.type.replace('_', ' ')}
                        </Badge>
                        {!stage.isActive && (
                          <Badge variant="destructive" className="text-xs bg-red-500/10 text-red-300 border border-red-500/20">Inactive</Badge>
                        )}
                        {(stage.interviewCount || 0) > 0 && (
                          <Badge variant="outline" className="text-xs border-white/10 text-gray-400">
                            {stage.interviewCount} interview{stage.interviewCount !== 1 ? 's' : ''}
                          </Badge>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-4 text-xs sm:text-sm text-gray-400">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {stage.defaultDuration} min
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {stage.requiredInterviewers} interviewer{stage.requiredInterviewers !== 1 ? 's' : ''}
                        </span>
                        {stage.aiQuestionGeneration?.enabled && (
                          <span className="flex items-center gap-1 col-span-2 sm:col-span-1">
                            <Wand2 className="h-3 w-3" />
                            AI Questions
                          </span>
                        )}
                      </div>

                      {stage.description && (
                        <p className="text-xs sm:text-sm text-gray-500 line-clamp-2">
                          {stage.description}
                        </p>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleStageActive(stage._id)}
                          title={stage.isActive ? 'Deactivate stage' : 'Activate stage'}
                          className="h-8 w-8 p-0 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          {stage.isActive ? (
                            <Eye className="h-3 w-3 sm:h-4 sm:w-4" />
                          ) : (
                            <EyeOff className="h-3 w-3 sm:h-4 sm:w-4" />
                          )}
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditStage(stage)}
                          title="Edit stage"
                          className="h-8 w-8 p-0 hover:bg-white/10 text-gray-400 hover:text-white"
                        >
                          <Edit className="h-3 w-3 sm:h-4 sm:w-4" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteStage(stage._id, stage.name)}
                          disabled={Boolean(stage.interviewCount && stage.interviewCount > 0)}
                          title={stage.interviewCount && stage.interviewCount > 0
                            ? 'Cannot delete stage with existing interviews'
                            : 'Delete stage'
                          }
                          className="h-8 w-8 p-0 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950"
                        >
                          <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
                        </Button>
                      </div>

                      {/* Mobile stage counter */}
                      <div className="text-xs text-muted-foreground sm:hidden">
                        {stage.order} of {stages.length}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stage Editor Dialog */}
      <Dialog open={showStageEditor} onOpenChange={setShowStageEditor}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingStage?.isNew ? 'Create New Stage' : 'Edit Stage'}
            </DialogTitle>
          </DialogHeader>

          {validationErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-1">
                  {validationErrors.map((error, index) => (
                    <div key={index}>• {error}</div>
                  ))}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {editingStage && (
            <Tabs defaultValue="basic" className="w-full">
              <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 gap-1">
                <TabsTrigger value="basic" className="text-xs sm:text-sm px-2 sm:px-4">
                  <span className="hidden sm:inline">Basic Info</span>
                  <span className="sm:hidden">Basic</span>
                </TabsTrigger>
                <TabsTrigger value="criteria" className="text-xs sm:text-sm px-2 sm:px-4">
                  <span className="hidden sm:inline">Evaluation</span>
                  <span className="sm:hidden">Eval</span>
                </TabsTrigger>
                <TabsTrigger value="ai" className="text-xs sm:text-sm px-2 sm:px-4">
                  <span className="hidden sm:inline">AI Settings</span>
                  <span className="sm:hidden">AI</span>
                </TabsTrigger>
                <TabsTrigger value="rules" className="text-xs sm:text-sm px-2 sm:px-4">
                  <span className="hidden sm:inline">Progression</span>
                  <span className="sm:hidden">Rules</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="basic" className="space-y-3 sm:space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="stage-name" className="text-sm font-medium">Stage Name *</Label>
                    <Input
                      id="stage-name"
                      value={editingStage.name || ''}
                      onChange={(e) => updateEditingStage({ name: e.target.value })}
                      placeholder="e.g., Technical Interview"
                      className="h-10"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="stage-type" className="text-sm font-medium">Stage Type *</Label>
                    <Select
                      value={editingStage.type || 'custom'}
                      onValueChange={(value) => {
                        updateEditingStage({
                          type: value as any,
                          evaluationCriteria: interviewStageService.getDefaultEvaluationCriteria(value)
                        })
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {interviewStageService.getStageTypeOptions().map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            <div>
                              <div className="font-medium">{option.label}</div>
                              <div className="text-xs text-muted-foreground">{option.description}</div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="stage-description">Description</Label>
                  <Textarea
                    id="stage-description"
                    value={editingStage.description || ''}
                    onChange={(e) => updateEditingStage({ description: e.target.value })}
                    placeholder="Describe the purpose and focus of this interview stage..."
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="stage-duration" className="text-sm font-medium">
                      Default Duration: {editingStage.defaultDuration || 60} minutes
                    </Label>
                    <Slider
                      id="stage-duration"
                      min={15}
                      max={240}
                      step={15}
                      value={[editingStage.defaultDuration || 60]}
                      onValueChange={([value]) => updateEditingStage({ defaultDuration: value })}
                      className="w-full"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="required-interviewers" className="text-sm font-medium">
                      Required Interviewers: {editingStage.requiredInterviewers || 1}
                    </Label>
                    <Slider
                      id="required-interviewers"
                      min={1}
                      max={5}
                      step={1}
                      value={[editingStage.requiredInterviewers || 1]}
                      onValueChange={([value]) => updateEditingStage({ requiredInterviewers: value })}
                      className="w-full"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Interviewer Roles</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {interviewStageService.getInterviewerRoleOptions().map(role => (
                      <div key={role.value} className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id={`role-${role.value}`}
                          checked={editingStage.interviewerRoles?.includes(role.value) || false}
                          onChange={(e) => {
                            const currentRoles = editingStage.interviewerRoles || []
                            if (e.target.checked) {
                              updateEditingStage({ interviewerRoles: [...currentRoles, role.value] })
                            } else {
                              updateEditingStage({
                                interviewerRoles: currentRoles.filter(r => r !== role.value)
                              })
                            }
                          }}
                          className="rounded border-gray-300"
                        />
                        <Label
                          htmlFor={`role-${role.value}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {role.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="criteria" className="space-y-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Evaluation Criteria</h4>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        Total Weight: {getTotalCriteriaWeight()}%
                      </span>
                      <Button size="sm" onClick={addEvaluationCriterion}>
                        <Plus className="h-4 w-4 mr-1" />
                        Add Criterion
                      </Button>
                    </div>
                  </div>

                  {getTotalCriteriaWeight() !== 100 && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        Total weight must equal 100%. Current total: {getTotalCriteriaWeight()}%
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-3">
                    {editingStage.evaluationCriteria?.map((criterion, index) => (
                      <Card key={index}>
                        <CardContent className="p-4">
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="md:col-span-2">
                              <Label className="text-xs">Criterion Name</Label>
                              <Input
                                value={criterion.name || ''}
                                onChange={(e) => updateEvaluationCriterion(index, { name: e.target.value })}
                                placeholder="e.g., Technical Skills"
                              />
                            </div>

                            <div>
                              <Label className="text-xs">Type</Label>
                              <Select
                                value={criterion.type || 'behavioral'}
                                onValueChange={(value) => updateEvaluationCriterion(index, { type: value as any })}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {interviewStageService.getEvaluationCriteriaTypes().map(type => (
                                    <SelectItem key={type.value} value={type.value}>
                                      {type.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="flex items-end gap-2">
                              <div className="flex-1">
                                <Label className="text-xs">Weight (%)</Label>
                                <Input
                                  type="number"
                                  min="0"
                                  max="100"
                                  value={criterion.weight || 0}
                                  onChange={(e) => updateEvaluationCriterion(index, {
                                    weight: parseInt(e.target.value) || 0
                                  })}
                                />
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeEvaluationCriterion(index)}
                                disabled={(editingStage.evaluationCriteria?.length || 0) <= 1}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          <div className="mt-3">
                            <Label className="text-xs">Description</Label>
                            <Textarea
                              value={criterion.description || ''}
                              onChange={(e) => updateEvaluationCriterion(index, { description: e.target.value })}
                              placeholder="Describe what this criterion evaluates..."
                              rows={2}
                            />
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="ai" className="space-y-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium">AI Question Generation</h4>
                      <p className="text-sm text-muted-foreground">
                        Automatically generate interview questions for this stage
                      </p>
                    </div>
                    <Switch
                      checked={editingStage.aiQuestionGeneration?.enabled || false}
                      onCheckedChange={(enabled) => updateEditingStage({
                        aiQuestionGeneration: { ...editingStage.aiQuestionGeneration!, enabled }
                      })}
                    />
                  </div>

                  {editingStage.aiQuestionGeneration?.enabled && (
                    <div className="space-y-4 pl-4 border-l-2 border-primary/20">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Number of Questions: {editingStage.aiQuestionGeneration.questionCount}</Label>
                          <Slider
                            min={5}
                            max={30}
                            step={5}
                            value={[editingStage.aiQuestionGeneration.questionCount || 10]}
                            onValueChange={([value]) => updateEditingStage({
                              aiQuestionGeneration: {
                                ...editingStage.aiQuestionGeneration!,
                                questionCount: value
                              }
                            })}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Difficulty Level</Label>
                          <Select
                            value={editingStage.aiQuestionGeneration.difficulty || 'medium'}
                            onValueChange={(value) => updateEditingStage({
                              aiQuestionGeneration: {
                                ...editingStage.aiQuestionGeneration!,
                                difficulty: value as any
                              }
                            })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="easy">Easy</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="hard">Hard</SelectItem>
                              <SelectItem value="expert">Expert</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Question Types</Label>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {interviewStageService.getAIQuestionTypes().map(type => (
                            <div key={type.value} className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                id={`qtype-${type.value}`}
                                checked={editingStage.aiQuestionGeneration?.questionTypes?.includes(type.value) || false}
                                onChange={(e) => {
                                  const currentTypes = editingStage.aiQuestionGeneration?.questionTypes || []
                                  if (e.target.checked) {
                                    updateEditingStage({
                                      aiQuestionGeneration: {
                                        ...editingStage.aiQuestionGeneration!,
                                        questionTypes: [...currentTypes, type.value]
                                      }
                                    })
                                  } else {
                                    updateEditingStage({
                                      aiQuestionGeneration: {
                                        ...editingStage.aiQuestionGeneration!,
                                        questionTypes: currentTypes.filter(t => t !== type.value)
                                      }
                                    })
                                  }
                                }}
                                className="rounded border-gray-300"
                              />
                              <Label
                                htmlFor={`qtype-${type.value}`}
                                className="text-sm font-normal cursor-pointer"
                              >
                                {type.label}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="focus-areas">Focus Areas (comma-separated)</Label>
                        <Input
                          id="focus-areas"
                          value={editingStage.aiQuestionGeneration?.focusAreas?.join(', ') || ''}
                          onChange={(e) => updateEditingStage({
                            aiQuestionGeneration: {
                              ...editingStage.aiQuestionGeneration!,
                              focusAreas: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                            }
                          })}
                          placeholder="e.g., React, Node.js, Database Design"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="rules" className="space-y-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium">Automatic Progression</h4>
                      <p className="text-sm text-muted-foreground">
                        Automatically advance candidates based on rules
                      </p>
                    </div>
                    <Switch
                      checked={editingStage.progressionRules?.autoProgress || false}
                      onCheckedChange={(autoProgress) => updateEditingStage({
                        progressionRules: { ...editingStage.progressionRules!, autoProgress }
                      })}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Minimum Score for Advancement</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={editingStage.progressionRules?.minimumScore || ''}
                        onChange={(e) => updateEditingStage({
                          progressionRules: {
                            ...editingStage.progressionRules!,
                            minimumScore: parseInt(e.target.value) || undefined
                          }
                        })}
                        placeholder="70"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Required Approvals</Label>
                      <Input
                        type="number"
                        min="1"
                        max="10"
                        value={editingStage.progressionRules?.requiredApprovals || 1}
                        onChange={(e) => updateEditingStage({
                          progressionRules: {
                            ...editingStage.progressionRules!,
                            requiredApprovals: parseInt(e.target.value) || 1
                          }
                        })}
                      />
                    </div>
                  </div>

                  <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>
                      Additional progression conditions can be configured after creating the stage.
                    </AlertDescription>
                  </Alert>
                </div>
              </TabsContent>
            </Tabs>
          )}

          <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
            <Button variant="outline" onClick={() => setShowStageEditor(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveStage} disabled={saving}>
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {editingStage?.isNew ? 'Create Stage' : 'Save Changes'}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Save as Template Modal */}
      <SaveAsTemplateModal
        isOpen={showSaveAsTemplateModal}
        onClose={() => setShowSaveAsTemplateModal(false)}
        jobId={jobId}
        stages={stages}
        onSuccess={handleSaveAsTemplateSuccess}
      />

      {/* Delete Template Confirmation Dialog */}
      <Dialog open={showDeleteConfirmDialog} onOpenChange={setShowDeleteConfirmDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-5 w-5" />
              Delete Template
            </DialogTitle>
          </DialogHeader>

          {deletingTemplate && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Are you sure you want to <span className="font-semibold text-red-600">permanently delete</span> the template <span className="font-semibold">&quot;{deletingTemplate.name}&quot;</span>?
              </p>

              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  This action cannot be undone. The template will be permanently removed from the database.
                  {deletingTemplate.usageCount > 0 && (
                    <span className="block mt-2">
                      This template has been used {deletingTemplate.usageCount} time{deletingTemplate.usageCount !== 1 ? 's' : ''}.
                      Existing jobs using this template will not be affected.
                    </span>
                  )}
                </AlertDescription>
              </Alert>

              <div className="bg-muted p-3 rounded-md space-y-1">
                <p className="text-sm"><span className="font-medium">Stages:</span> {deletingTemplate.stages.length}</p>
                {deletingTemplate.description && (
                  <p className="text-sm"><span className="font-medium">Description:</span> {deletingTemplate.description}</p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowDeleteConfirmDialog(false)
                    setDeletingTemplate(null)
                  }}
                  disabled={isDeletingTemplate}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleConfirmDeleteTemplate}
                  disabled={isDeletingTemplate}
                >
                  {isDeletingTemplate ? (
                    <>
                      <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Template
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default InterviewStageConfiguration
