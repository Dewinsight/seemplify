"use client"

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { 
  Mail, 
  Send, 
  Settings, 
  TestTube, 
  Users, 
  AlertCircle, 
  CheckCircle, 
  Loader2, 
  Plus, 
  X,
  Copy,
  Eye,
  Code
} from 'lucide-react'
import candidateEmailService, { EmailSettings } from '../../services/candidateEmailService'

interface JobEmailSettingsProps {
  jobId: string
  jobTitle: string
  onSettingsChange?: (settings: EmailSettings) => void
}

export function JobEmailSettings({ jobId, jobTitle, onSettingsChange }: JobEmailSettingsProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingEmail, setTestingEmail] = useState(false)
  const [settings, setSettings] = useState<EmailSettings>({})
  const [testEmail, setTestEmail] = useState('')
  const [defaultTemplates, setDefaultTemplates] = useState<Record<string, string>>({})
  const [showPreview, setShowPreview] = useState(true)
  const [activeTemplate, setActiveTemplate] = useState<'rejection' | 'shortlistRejection' | 'shortlist' | 'advancement'>('shortlistRejection')

  // Load default templates on mount
  useEffect(() => {
    loadDefaultTemplates()
  }, [])

  // Load current email settings
  useEffect(() => {
    loadEmailSettings()
  }, [jobId])

  const formatHTML = (html: string): string => {
    // Simple HTML formatter for better readability
    let formatted = html
      // Add newlines after closing tags
      .replace(/></g, '>\n<')
      // Add indentation
      .split('\n')
      .map((line, index, lines) => {
        const trimmed = line.trim()
        if (!trimmed) return ''
        
        // Calculate indent level
        let indent = 0
        for (let i = 0; i < index; i++) {
          const prevLine = lines[i].trim()
          if (prevLine.match(/<(?!\/)[^>]+>$/)) indent++
          if (prevLine.match(/<\/[^>]+>$/)) indent = Math.max(0, indent - 1)
        }
        
        // Adjust for current line
        if (trimmed.startsWith('</')) indent = Math.max(0, indent - 1)
        
        return '  '.repeat(indent) + trimmed
      })
      .filter(line => line.trim())
      .join('\n')
    
    return formatted
  }

  const loadDefaultTemplates = async () => {
    try {
      const templateNames = [
        'rejection-notice',
        'shortlist-rejection',
        'shortlist-congratulations',
        'advancement-congratulations'
      ]
      
      const templates: Record<string, string> = {}
      
      await Promise.all(
        templateNames.map(async (name) => {
          try {
            const response = await fetch(`/api/candidate-emails/templates/${name}`)
            if (response.ok) {
              const html = await response.text()
              // Format HTML for better readability
              templates[name] = formatHTML(html)
            }
          } catch (error) {
            console.error(`Failed to load template ${name}:`, error)
          }
        })
      )
      
      setDefaultTemplates(templates)
      console.log('✅ Default templates loaded and formatted:', Object.keys(templates))
    } catch (error) {
      console.error('Error loading default templates:', error)
    }
  }

  const loadEmailSettings = async () => {
    try {
      setLoading(true)
      const response = await candidateEmailService.getEmailSettings(jobId)
      setSettings(response.emailSettings)
    } catch (error: any) {
      toast({
        title: "Error loading email settings",
        description: error.message,
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSettingChange = (key: keyof EmailSettings, value: any) => {
    const newSettings = { ...settings, [key]: value }
    setSettings(newSettings)
    onSettingsChange?.(newSettings)
  }

  const handleCustomTemplateChange = (templateType: string, value: string) => {
    const newSettings = {
      ...settings,
      customTemplates: {
        ...settings.customTemplates,
        [templateType]: value
      }
    }
    setSettings(newSettings)
    onSettingsChange?.(newSettings)
  }

  const saveSettings = async () => {
    try {
      setSaving(true)
      const settingsToSave = {
        ...settings
      }
      await candidateEmailService.updateEmailSettings(jobId, settingsToSave)
      toast({
        title: "Settings saved",
        description: "Email notification settings have been updated successfully.",
      })
    } catch (error: any) {
      toast({
        title: "Error saving settings",
        description: error.message,
        variant: "destructive"
      })
    } finally {
      setSaving(false)
    }
  }

  const sendTestEmail = async (templateType: 'advancement' | 'shortlist' | 'rejection' | 'shortlist-rejection') => {
    if (!testEmail) {
      toast({
        title: "Email required",
        description: "Please enter an email address to send the test to.",
        variant: "destructive"
      })
      return
    }

    try {
      setTestingEmail(true)
      await candidateEmailService.sendTestEmail(jobId, testEmail, templateType)
      toast({
        title: "Test email sent",
        description: `${templateType} test email sent to ${testEmail}`,
      })
    } catch (error: any) {
      toast({
        title: "Test email failed",
        description: error.message,
        variant: "destructive"
      })
    } finally {
      setTestingEmail(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Loading email settings...
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Notification Settings
        </CardTitle>
        <CardDescription>
          Configure automatic email notifications for candidates in the {jobTitle} pipeline
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="templates" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 gap-1">
            <TabsTrigger value="templates" className="text-xs sm:text-sm px-2 sm:px-4">
              <span className="hidden sm:inline">Email Templates</span>
              <span className="sm:hidden">Templates</span>
            </TabsTrigger>
            <TabsTrigger value="test" className="text-xs sm:text-sm px-2 sm:px-4">
              <span className="hidden sm:inline">Test Emails</span>
              <span className="sm:hidden">Test</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="templates" className="space-y-3 sm:space-y-4">
            {/* Template Selector */}
            <div className="flex items-center justify-between">
              <Select value={activeTemplate} onValueChange={(value: any) => setActiveTemplate(value)}>
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="shortlistRejection">Shortlist Rejection</SelectItem>
                  <SelectItem value="rejection">Pipeline Rejection</SelectItem>
                  <SelectItem value="shortlist">Shortlist Congratulations</SelectItem>
                  <SelectItem value="advancement">Advancement Congratulations</SelectItem>
                </SelectContent>
              </Select>

              {/* Toggle Preview */}
              <div className="flex items-center gap-2">
                <Button
                  variant={showPreview ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowPreview(!showPreview)}
                  className="h-8"
                >
                  <Eye className="h-4 w-4 mr-1" />
                  {showPreview ? 'Hide' : 'Show'} Preview
                </Button>
              </div>
            </div>

            {/* Editor with optional preview */}
            <div className={showPreview ? "grid grid-cols-1 lg:grid-cols-2 gap-4" : ""}>
              {/* HTML Editor */}
              <div className="space-y-4">
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <div className="flex items-start gap-2 text-blue-800 dark:text-blue-200 text-sm">
                    <Mail className="h-4 w-4 mt-0.5" />
                    <div className="flex-1">
                      <div className="font-semibold mb-2">Edit HTML Template</div>
                      <div className="text-xs space-y-2">
                        <div>
                          <strong>💡 Quick Tips:</strong>
                          <ul className="list-disc ml-4 mt-1 space-y-1">
                            <li>Edit text between <code className="bg-white/50 px-1">&gt;</code> and <code className="bg-white/50 px-1">&lt;</code> tags</li>
                            <li>Change colors in <code className="bg-white/50 px-1">style="color:#..."</code></li>
                            <li>Don't delete {`{{variables}}`} - they get replaced with real data</li>
                          </ul>
                        </div>
                        <div>
                          <strong>Available variables:</strong>
                          <div className="mt-1 space-x-1">
                            <code className="bg-white/50 px-1">{`{{candidateName}}`}</code>
                            <code className="bg-white/50 px-1">{`{{jobTitle}}`}</code>
                            <code className="bg-white/50 px-1">{`{{feedback}}`}</code>
                            <code className="bg-white/50 px-1">{`{{organizationName}}`}</code>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">Template HTML</Label>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const currentTemplate = settings.customTemplates?.[activeTemplate] || defaultTemplates[
                            activeTemplate === 'rejection' ? 'rejection-notice' :
                            activeTemplate === 'shortlistRejection' ? 'shortlist-rejection' :
                            activeTemplate === 'shortlist' ? 'shortlist-congratulations' :
                            'advancement-congratulations'
                          ] || ''
                          
                          if (currentTemplate) {
                            const formatted = formatHTML(currentTemplate)
                            handleCustomTemplateChange(activeTemplate, formatted)
                            toast({ title: "HTML formatted", description: "Code formatted for easier reading" })
                          }
                        }}
                        className="h-7 text-xs"
                      >
                        <Code className="h-3 w-3 mr-1" />
                        Format HTML
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const templateMap = {
                            'rejection': 'rejection-notice',
                            'shortlistRejection': 'shortlist-rejection',
                            'shortlist': 'shortlist-congratulations',
                            'advancement': 'advancement-congratulations'
                          }
                          if (defaultTemplates[templateMap[activeTemplate]]) {
                            handleCustomTemplateChange(activeTemplate, defaultTemplates[templateMap[activeTemplate]])
                            toast({ title: "Template reset", description: "Reset to default template" })
                          }
                        }}
                        className="h-7 text-xs"
                      >
                        Reset to Default
                      </Button>
                    </div>
                  </div>
                  <div className="relative">
                    <Textarea
                      value={settings.customTemplates?.[activeTemplate] || defaultTemplates[
                        activeTemplate === 'rejection' ? 'rejection-notice' :
                        activeTemplate === 'shortlistRejection' ? 'shortlist-rejection' :
                        activeTemplate === 'shortlist' ? 'shortlist-congratulations' :
                        'advancement-congratulations'
                      ] || ''}
                      onChange={(e) => handleCustomTemplateChange(activeTemplate, e.target.value)}
                      placeholder="Loading default template..."
                      rows={showPreview ? 25 : 35}
                      className="font-mono text-xs leading-relaxed"
                      spellCheck={false}
                    />
                    <div className="absolute top-2 right-2 bg-white/90 dark:bg-gray-800/90 px-2 py-1 rounded text-xs text-gray-500">
                      {(settings.customTemplates?.[activeTemplate] || defaultTemplates[
                        activeTemplate === 'rejection' ? 'rejection-notice' :
                        activeTemplate === 'shortlistRejection' ? 'shortlist-rejection' :
                        activeTemplate === 'shortlist' ? 'shortlist-congratulations' :
                        'advancement-congratulations'
                      ] || '').split('\n').length} lines
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded p-2">
                    <AlertCircle className="h-3 w-3 mt-0.5" />
                    <div>
                      <strong>To edit text:</strong> Find text between <code className="bg-white px-1">&gt;TEXT&lt;</code> tags and change it.
                      To show custom messages, use <code className="bg-white px-1">{`{{#if feedback}}{{feedback}}{{/if}}`}</code>
                    </div>
                  </div>
                </div>
              </div>

              {/* Live Preview */}
              {showPreview && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    Live Preview
                  </Label>
                  <div className="border rounded-lg bg-gray-50 dark:bg-gray-900 p-2">
                    <iframe
                      srcDoc={settings.customTemplates?.[activeTemplate] || defaultTemplates[
                        activeTemplate === 'rejection' ? 'rejection-notice' :
                        activeTemplate === 'shortlistRejection' ? 'shortlist-rejection' :
                        activeTemplate === 'shortlist' ? 'shortlist-congratulations' :
                        'advancement-congratulations'
                      ] || '<p>Loading...</p>'}
                      className="w-full h-[700px] bg-white rounded"
                      title="Email Preview"
                      sandbox="allow-same-origin"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Live preview of your email template. Variables like {`{{candidateName}}`} will be replaced when sent.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="test" className="space-y-3 sm:space-y-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="test-email" className="text-sm font-medium">Test Email Address</Label>
                <Input
                  id="test-email"
                  type="email"
                  placeholder="test@example.com"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  className="h-10"
                />
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Button
                  onClick={() => sendTestEmail('advancement')}
                  disabled={testingEmail || !testEmail}
                  variant="outline"
                  size="sm"
                  className="h-10 justify-start"
                >
                  {testingEmail ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TestTube className="h-4 w-4 mr-2" />}
                  <span className="hidden sm:inline">Advancement</span>
                  <span className="sm:hidden">Advance</span>
                </Button>
                
                <Button
                  onClick={() => sendTestEmail('shortlist')}
                  disabled={testingEmail || !testEmail}
                  variant="outline"
                  size="sm"
                  className="h-10 justify-start"
                >
                  {testingEmail ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TestTube className="h-4 w-4 mr-2" />}
                  Shortlist
                </Button>
                
                <Button
                  onClick={() => sendTestEmail('rejection')}
                  disabled={testingEmail || !testEmail}
                  variant="outline"
                  size="sm"
                  className="h-10 justify-start"
                >
                  {testingEmail ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TestTube className="h-4 w-4 mr-2" />}
                  Rejection
                </Button>
                
                <Button
                  onClick={() => sendTestEmail('shortlist-rejection')}
                  disabled={testingEmail || !testEmail}
                  variant="outline"
                  size="sm"
                  className="h-10 justify-start"
                >
                  {testingEmail ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TestTube className="h-4 w-4 mr-2" />}
                  <span className="hidden sm:inline">Shortlist Rej.</span>
                  <span className="sm:hidden">SL Reject</span>
                </Button>
              </div>

              <div className="p-4 bg-blue-50 rounded-lg">
                <h4 className="text-sm font-medium text-blue-900 mb-2">Test Email Information</h4>
                <p className="text-sm text-blue-700">
                  Test emails use mock candidate data (Test Candidate) and will be sent to the email address above. 
                  This helps you verify your email templates and configuration before sending to real candidates.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Save Button */}
        <div className="flex justify-end pt-6 border-t">
          <Button onClick={saveSettings} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Save Settings
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
