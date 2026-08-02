'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Trash2, GripVertical, Plus, Check } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface Question {
  _id: string
  type: 'radio' | 'checkbox' | 'text' | 'select' | 'multiselect' | 'date' | 'number'
  question: string
  description?: string
  isRequired: boolean
  order: number
  options?: Array<{ value: string; label: string }>
  condition?: {
    dependsOn: string
    operator: 'equals' | 'not_equals' | 'contains' | 'not_contains'
    value: any
  }
  action?: {
    value: any
    actionType: 'shortlist' | 'reject' | 'flag'
    reason?: string
  }
}

interface ScreeningQuestionsBuilderProps {
  jobId: string
  onSave?: (questions: Question[]) => void
  existingQuestions?: Question[]
}

export function ScreeningQuestionsBuilder({ jobId: _jobId, onSave, existingQuestions = [] }: ScreeningQuestionsBuilderProps) {
  const [questions, setQuestions] = useState<Question[]>(existingQuestions)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  const addQuestion = () => {
    const newQuestion: Question = {
      _id: `new-${Date.now()}`,
      type: 'text',
      question: '',
      description: '',
      isRequired: true,
      order: questions.length,
      options: [],
      condition: undefined,
      action: undefined
    }
    setQuestions([...questions, newQuestion])
    setEditingId(newQuestion._id)
    setShowAddForm(true)
  }

  const updateQuestion = (id: string, updates: Partial<Question>) => {
    setQuestions(questions.map(q => q._id === id ? { ...q, ...updates } : q))
  }

  const deleteQuestion = (id: string) => {
    setQuestions(questions.filter(q => q._id !== id))
    if (editingId === id) setEditingId(null)
  }

  const handleToggleAddQuestion = () => {
    if (!showAddForm) {
      addQuestion()
      return
    }

    if (editingId && editingId.startsWith('new-')) {
      deleteQuestion(editingId)
    } else {
      setEditingId(null)
    }

    setShowAddForm(false)
  }

  const saveQuestions = () => {
    // Update orders to be sequential
    const reorderedQuestions = questions.map((q, index) => ({ ...q, order: index }))
    onSave?.(reorderedQuestions)
    toast({
      title: 'Success',
      description: 'Screening questions saved'
    })
  }

  const renderQuestionInput = (question: Question) => {
    switch (question.type) {
      case 'radio':
        return (
          <div className="space-y-2">
            <Label>Options</Label>
            {question.options?.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  placeholder="Option value"
                  value={opt.value}
                  onChange={(e) => {
                    const newOptions = [...(question.options || [])]
                    newOptions[idx] = { ...opt, value: e.target.value }
                    updateQuestion(question._id, { options: newOptions })
                  }}
                  className="flex-1"
                />
                <Input
                  placeholder="Option label"
                  value={opt.label}
                  onChange={(e) => {
                    const newOptions = [...(question.options || [])]
                    newOptions[idx] = { ...opt, label: e.target.value }
                    updateQuestion(question._id, { options: newOptions })
                  }}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const newOptions = (question.options || []).filter((_, i) => i !== idx)
                    updateQuestion(question._id, { options: newOptions })
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const newOptions = [...(question.options || []), { value: '', label: `Option ${(question.options?.length ?? 0) + 1}` }]
                updateQuestion(question._id, { options: newOptions })
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Option
            </Button>
          </div>
        )

      case 'checkbox':
      case 'select':
        return (
          <div className="space-y-2">
            <Label>Options</Label>
            {question.options?.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  placeholder="Option value"
                  value={opt.value}
                  onChange={(e) => {
                    const newOptions = [...(question.options || [])]
                    newOptions[idx] = { ...opt, value: e.target.value }
                    updateQuestion(question._id, { options: newOptions })
                  }}
                  className="flex-1"
                />
                <Input
                  placeholder="Option label"
                  value={opt.label}
                  onChange={(e) => {
                    const newOptions = [...(question.options || [])]
                    newOptions[idx] = { ...opt, label: e.target.value }
                    updateQuestion(question._id, { options: newOptions })
                  }}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const newOptions = (question.options || []).filter((_, i) => i !== idx)
                    updateQuestion(question._id, { options: newOptions })
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const newOptions = [...(question.options || []), { value: '', label: `Option ${(question.options?.length ?? 0) + 1}` }]
                updateQuestion(question._id, { options: newOptions })
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Option
            </Button>
          </div>
        )

      case 'multiselect':
        return (
          <div className="space-y-2">
            <Label>Options (candidates can select multiple)</Label>
            {question.options?.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  placeholder="Option value"
                  value={opt.value}
                  onChange={(e) => {
                    const newOptions = [...(question.options || [])]
                    newOptions[idx] = { ...opt, value: e.target.value }
                    updateQuestion(question._id, { options: newOptions })
                  }}
                  className="flex-1"
                />
                <Input
                  placeholder="Option label"
                  value={opt.label}
                  onChange={(e) => {
                    const newOptions = [...(question.options || [])]
                    newOptions[idx] = { ...opt, label: e.target.value }
                    updateQuestion(question._id, { options: newOptions })
                  }}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const newOptions = (question.options || []).filter((_, i) => i !== idx)
                    updateQuestion(question._id, { options: newOptions })
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const newOptions = [...(question.options || []), { value: '', label: `Option ${(question.options?.length ?? 0) + 1}` }]
                updateQuestion(question._id, { options: newOptions })
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Option
            </Button>
          </div>
        )

      default:
        return null
    }
  }

  const renderConditionalLogic = (question: Question, allQuestions: Question[]) => {
    if (!question.condition) return null

    const condition = question.condition
    const dependentQuestion = allQuestions.find(q => q._id === condition.dependsOn)
    if (!dependentQuestion) return null

    return (
      <div className="ml-4 mt-2 p-3 bg-muted/50 rounded-lg border border-border">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-medium">Show if</span>
          <Select
            value={condition.operator}
            onValueChange={(value) => updateQuestion(question._id, { 
              condition: { ...condition, operator: value as any }
            })}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="equals">equals</SelectItem>
              <SelectItem value="not_equals">not equals</SelectItem>
              <SelectItem value="contains">contains</SelectItem>
              <SelectItem value="not_contains">not contains</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Input
          placeholder="Value to compare"
          value={condition.value}
          onChange={(e) => updateQuestion(question._id, { 
            condition: { ...condition, value: e.target.value }
          })}
          className="w-40"
        />
      </div>
    )
  }

  const renderAutoAction = (question: Question) => {
    if (!question.action) return null
    const action = question.action

    return (
      <div className="ml-4 mt-2 p-3 bg-blue-50 dark:bg-blue-950/50 rounded-lg border border-blue-200 dark:border-blue-800">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-medium">Auto-Action</span>
          <Select
            value={action.actionType}
            onValueChange={(value) => updateQuestion(question._id, { 
              action: { ...action, actionType: value as any }
            })}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="shortlist">Auto-Shortlist</SelectItem>
              <SelectItem value="reject">Auto-Reject</SelectItem>
              <SelectItem value="flag">Flag for Review</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {action.actionType === 'reject' && (
          <Input
            placeholder="Rejection reason"
            value={action.reason || ''}
            onChange={(e) => updateQuestion(question._id, { 
              action: { ...action, reason: e.target.value }
            })}
            className="flex-1 ml-2"
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <CardTitle>Screening Questions</CardTitle>
          <CardDescription>
            Create custom screening questions for job applications. Supports dynamic question types and conditional logic.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={handleToggleAddQuestion}
            variant={showAddForm ? "outline" : "default"}
          >
            {showAddForm ? "Cancel" : <Plus className="h-4 w-4 mr-2" />}
            Add Question
          </Button>
          {questions.length > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={saveQuestions}
            >
              <Check className="h-4 w-4 mr-2" />
              Save Questions
            </Button>
          )}
        </div>
      </div>

      {/* Questions List */}
      <div className="space-y-4">
        {questions.map((question) => (
          <Card key={question._id} className={cn(
            "transition-all duration-200",
            editingId === question._id && "ring-2 ring-ring ring-offset-2"
          )}>
            <CardHeader className="cursor-move" style={{ cursor: 'grab' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs font-mono">
                        {question.type}
                      </Badge>
                      <CardTitle className="text-base font-semibold">
                        {question.question || 'Untitled Question'}
                      </CardTitle>
                      {question.isRequired && (
                        <span className="text-red-500 ml-2">*</span>
                      )}
                    </div>
                    {question.description && (
                      <CardDescription className="text-sm text-muted-foreground">
                        {question.description}
                      </CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditingId(editingId === question._id ? null : question._id)}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteQuestion(question._id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardHeader>

            {editingId === question._id && (
              <CardContent className="space-y-4 pt-4">
                <div className="space-y-4">
                  {/* Question Type */}
                  <div className="space-y-2">
                    <Label>Question Type</Label>
                    <Select
                      value={question.type}
                      onValueChange={(value) => updateQuestion(question._id, { type: value as any })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">Text Input</SelectItem>
                        <SelectItem value="radio">Radio Button</SelectItem>
                        <SelectItem value="checkbox">Checkbox</SelectItem>
                        <SelectItem value="select">Dropdown (Single)</SelectItem>
                        <SelectItem value="multiselect">Dropdown (Multiple)</SelectItem>
                        <SelectItem value="date">Date Picker</SelectItem>
                        <SelectItem value="number">Number Input</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Question Text */}
                  <div className="space-y-2">
                    <Label>Question <span className="text-red-500">*</span></Label>
                    <Textarea
                      placeholder="Enter your question..."
                      value={question.question || ''}
                      onChange={(e) => updateQuestion(question._id, { question: e.target.value })}
                      rows={3}
                    />
                  </div>

                  {/* Description */}
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea
                      placeholder="Optional additional context..."
                      value={question.description || ''}
                      onChange={(e) => updateQuestion(question._id, { description: e.target.value })}
                      rows={2}
                    />
                  </div>

                  {/* Required */}
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`required-${question._id}`}
                      checked={question.isRequired}
                      onCheckedChange={(checked) => updateQuestion(question._id, { isRequired: checked === true })}
                    />
                    <Label htmlFor={`required-${question._id}`}>Required</Label>
                  </div>

                  {/* Options for select/radio/checkbox */}
                  {renderQuestionInput(question)}

                  {/* Conditional Logic */}
                  {renderConditionalLogic(question, questions)}

                  {/* Auto-Action */}
                  {renderAutoAction(question)}
                </div>

                <CardFooter className="flex justify-end gap-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (question._id.startsWith('new-')) {
                        deleteQuestion(question._id)
                      } else {
                        setEditingId(null)
                      }
                      setShowAddForm(false)
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setEditingId(null)
                      setShowAddForm(false)
                      toast({
                        title: 'Success',
                        description: 'Question updated'
                      })
                    }}
                  >
                    Save
                  </Button>
                </CardFooter>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* Empty State */}
      {questions.length === 0 && (
        <Card className="p-12 text-center">
          <CardContent>
            <p className="text-muted-foreground mb-4">
              No screening questions yet. Click "Add Question" to create your first question.
            </p>
            <p className="text-sm text-muted-foreground">
              You can create questions with different types: text, radio, checkbox, select, multiselect, date, and number.
              Set up conditional logic to show/hide questions based on previous answers.
              Configure auto-actions like shortlist, reject, or flag for manual review.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
