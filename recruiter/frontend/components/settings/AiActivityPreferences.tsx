"use client"

import { useEffect, useMemo, useState } from "react"
import { RotateCcw, Save, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import type {
  AiAccountModel,
  AiAccountDefaultPreference,
  AiActivityOverride,
  AiActivityPreference,
  AiReasoningEffort,
  AiSettingProvenance
} from "@/services/aiAccountService"
import {
  activityMatchesQuery,
  groupAiActivities,
  hasAiActivityOverride,
  INHERIT_AI_SETTING,
  REASONING_OPTIONS,
  supportedReasoningEfforts
} from "@/utils/aiActivityPreferences"

interface AiActivityPreferencesProps {
  defaults: AiAccountDefaultPreference | null
  activities: AiActivityPreference[]
  models: AiAccountModel[]
  loading?: boolean
  disabled?: boolean
  savingActivity?: string
  error?: string
  onRetry: () => void
  onSaveDefault: (override: AiActivityOverride) => Promise<void>
  onResetDefault: () => Promise<void>
  onSave: (activity: string, override: AiActivityOverride) => Promise<void>
  onReset: (activity: string) => Promise<void>
}

function modelName(models: AiAccountModel[], modelId?: string | null, markUnavailable = false) {
  if (!modelId) return "Varies by activity"
  const model = models.find((candidate) => candidate.id === modelId)
  if (model) return model.displayName
  return markUnavailable ? `${modelId} (not in live catalogue)` : modelId
}

function reasoningLabel(value?: AiReasoningEffort | null) {
  if (!value) return "Varies by activity"
  return REASONING_OPTIONS.find((option) => option.value === value)?.label || value
}

function sameOverride(left: AiActivityOverride, right: AiActivityOverride) {
  return left.codexModel === right.codexModel && left.reasoningEffort === right.reasoningEffort
}

function sourceLabel(source: AiSettingProvenance) {
  const labels: Record<string, string> = {
    activity_override: "your activity override",
    account_default: "your account default",
    admin_default: "admin default",
    app_default: "application default"
  }
  return labels[source] || String(source || "inherited default").replaceAll("_", " ")
}

function appLabel(app: string) {
  if (app === "performance") return "Performance Management"
  if (app === "recruiter") return "Recruiter"
  return app.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function AiActivityPreferences({
  defaults,
  activities,
  models,
  loading = false,
  disabled = false,
  savingActivity = "",
  error = "",
  onRetry,
  onSaveDefault,
  onResetDefault,
  onSave,
  onReset
}: AiActivityPreferencesProps) {
  const [query, setQuery] = useState("")
  const [appFilter, setAppFilter] = useState("all")
  const [defaultDraft, setDefaultDraft] = useState<AiActivityOverride>({ codexModel: null, reasoningEffort: null })
  const [drafts, setDrafts] = useState<Record<string, AiActivityOverride>>({})

  useEffect(() => {
    setDrafts(Object.fromEntries(activities.map((activity) => [
      activity.activity,
      {
        codexModel: activity.override?.codexModel || null,
        reasoningEffort: activity.override?.reasoningEffort || null
      }
    ])))
  }, [activities])

  useEffect(() => {
    setDefaultDraft({
      codexModel: defaults?.override?.codexModel || null,
      reasoningEffort: defaults?.override?.reasoningEffort || null
    })
  }, [defaults])

  const apps = useMemo(() => Array.from(new Set(activities.map((activity) => activity.app || "recruiter"))), [activities])
  const visibleGroups = useMemo(() => groupAiActivities(
    activities.filter((activity) => (
      (appFilter === "all" || activity.app === appFilter) && activityMatchesQuery(activity, query)
    ))
  ), [activities, appFilter, query])

  const customCount = activities.filter((activity) => hasAiActivityOverride(activity.override)).length
  const accountDefaultIsCustom = hasAiActivityOverride(defaults?.override)

  function updateDraft(activity: string, patch: Partial<AiActivityOverride>) {
    setDrafts((current) => ({
      ...current,
      [activity]: {
        codexModel: current[activity]?.codexModel || null,
        reasoningEffort: current[activity]?.reasoningEffort || null,
        ...patch
      }
    }))
  }

  function draftForModel(
    current: AiActivityOverride,
    modelValue: string,
    inheritedModel?: string | null
  ): AiActivityOverride {
    const codexModel = modelValue === INHERIT_AI_SETTING ? null : modelValue
    const selectedModelId = codexModel || inheritedModel
    const selectedModel = models.find((model) => model.id === selectedModelId)
    const supportedEfforts = supportedReasoningEfforts(selectedModel)
    return {
      ...current,
      codexModel,
      reasoningEffort: current.reasoningEffort && !supportedEfforts.includes(current.reasoningEffort)
        ? null
        : current.reasoningEffort
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-card" data-testid="ai-activity-preferences">
      <div className="border-b px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Activity preferences</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Override the administrator&apos;s ChatGPT model or reasoning level for your own work across Seemplify. Local inference continues to use Control Center.
            </p>
          </div>
          <p className="shrink-0 text-xs text-muted-foreground" aria-live="polite">
            {customCount > 0
              ? `${customCount} custom ${customCount === 1 ? "activity" : "activities"}`
              : accountDefaultIsCustom ? "Account default set" : "Using inherited defaults"}
          </p>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex gap-4 overflow-x-auto border-b" role="tablist" aria-label="Filter AI activities by application">
            {["all", ...apps].map((app) => (
              <button
                key={app}
                type="button"
                role="tab"
                aria-selected={appFilter === app}
                onClick={() => setAppFilter(app)}
                className={`shrink-0 border-b-2 px-0.5 pb-2 text-sm transition-colors ${
                  appFilter === app
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {app === "all" ? "All apps" : appLabel(app)}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
            placeholder="Find an AI activity"
            aria-label="Find an AI activity"
          />
          </div>
        </div>
        {!loading && activities.length > 0 && models.length === 0 ? (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-300" role="status">
            The live ChatGPT model catalogue did not return any models. Inherited settings remain visible, but new model overrides are unavailable.
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="m-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          <p>{error}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : loading ? (
        <p className="px-5 py-8 text-sm text-muted-foreground" role="status">Loading your activity preferences…</p>
      ) : activities.length === 0 ? (
        <p className="px-5 py-8 text-sm text-muted-foreground">
          Connect ChatGPT to load the models available on your account and configure activity overrides.
        </p>
      ) : (
        <>
          {defaults ? (() => {
            const saved = defaults.override || { codexModel: null, reasoningEffort: null }
            const selectedModelId = defaultDraft.codexModel || defaults.effective?.codexModel
            const selectedModel = models.find((model) => model.id === selectedModelId)
            const efforts = supportedReasoningEfforts(selectedModel)
            const dirty = !sameOverride(saved, defaultDraft)
            const saving = savingActivity === "__default__"
            const rowDisabled = disabled || saving || models.length === 0
            const savedModelAvailable = !defaultDraft.codexModel || models.some((model) => model.id === defaultDraft.codexModel)
            return (
              <div className="border-b px-4 py-4 sm:px-5" data-testid="ai-account-defaults">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold">Your account defaults</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Used for an activity unless you set a more specific override below.
                  </p>
                </div>
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_auto] lg:items-start">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium" htmlFor="ai-account-default-model">Model</label>
                    <Select
                      value={defaultDraft.codexModel || INHERIT_AI_SETTING}
                      disabled={rowDisabled}
                      onValueChange={(value) => setDefaultDraft((current) => draftForModel(
                        current,
                        value,
                        defaults.effective?.codexModel
                      ))}
                    >
                      <SelectTrigger id="ai-account-default-model"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={INHERIT_AI_SETTING}>Use each action&apos;s workspace default</SelectItem>
                        {!savedModelAvailable && defaultDraft.codexModel ? (
                          <SelectItem value={defaultDraft.codexModel}>{defaultDraft.codexModel} (saved; unavailable)</SelectItem>
                        ) : null}
                        {models.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.displayName}{model.isDefault ? " (ChatGPT default)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Current effective: {modelName(models, defaults.effective?.codexModel, true)} · {sourceLabel(defaults.provenance.codexModel)}
                    </p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium" htmlFor="ai-account-default-reasoning">Reasoning</label>
                    <Select
                      value={defaultDraft.reasoningEffort || INHERIT_AI_SETTING}
                      disabled={rowDisabled}
                      onValueChange={(value) => setDefaultDraft((current) => ({
                        ...current,
                        reasoningEffort: value === INHERIT_AI_SETTING ? null : value as AiReasoningEffort
                      }))}
                    >
                      <SelectTrigger id="ai-account-default-reasoning"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={INHERIT_AI_SETTING}>Use each action&apos;s workspace default</SelectItem>
                        {defaultDraft.reasoningEffort && !efforts.includes(defaultDraft.reasoningEffort) ? (
                          <SelectItem value={defaultDraft.reasoningEffort}>
                            {reasoningLabel(defaultDraft.reasoningEffort)} (saved; unsupported by selected model)
                          </SelectItem>
                        ) : null}
                        {REASONING_OPTIONS.filter(({ value }) => efforts.includes(value)).map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Current effective: {reasoningLabel(defaults.effective?.reasoningEffort)} · {sourceLabel(defaults.provenance.reasoningEffort)}
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-2 lg:pt-6">
                    {hasAiActivityOverride(saved) && !dirty ? (
                      <Button type="button" size="sm" variant="ghost" disabled={rowDisabled} onClick={() => void onResetDefault()}>
                        <RotateCcw className="mr-2 h-4 w-4" />Reset
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="outline" disabled={rowDisabled || !dirty} onClick={() => void onSaveDefault(defaultDraft)}>
                      <Save className="mr-2 h-4 w-4" />{saving ? "Saving" : "Save"}
                    </Button>
                  </div>
                </div>
              </div>
            )
          })() : null}

          {visibleGroups.length === 0 ? (
            <p className="px-5 py-8 text-sm text-muted-foreground">No activities match “{query}”.</p>
          ) : <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-56">Activity</TableHead>
              <TableHead className="min-w-64">Model</TableHead>
              <TableHead className="min-w-48">Reasoning</TableHead>
              <TableHead className="w-44"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleGroups.flatMap(({ app, group, activities: groupedActivities }) => [
              <TableRow key={`group-${app}-${group}`} className="bg-muted/35 hover:bg-muted/35">
                <TableCell colSpan={4} className="px-4 py-2 text-xs font-medium text-muted-foreground">
                  {appFilter === "all" ? `${appLabel(app)} · ${group}` : group}
                </TableCell>
              </TableRow>,
              ...groupedActivities.map((activity) => {
                const saved = activity.override || { codexModel: null, reasoningEffort: null }
                const draft = drafts[activity.activity] || saved
                const inheritedModel = activity.accountDefault?.codexModel || activity.adminDefault.codexModel
                const selectedModelId = draft.codexModel || inheritedModel
                const selectedModel = models.find((model) => model.id === selectedModelId)
                const efforts = supportedReasoningEfforts(selectedModel)
                const dirty = !sameOverride(saved, draft)
                const saving = savingActivity === activity.activity
                const rowDisabled = disabled || saving || !activity.enabled || models.length === 0
                const savedModelAvailable = !draft.codexModel || models.some((model) => model.id === draft.codexModel)

                return (
                  <TableRow key={activity.activity} data-testid={`ai-activity-${activity.activity}`}>
                    <TableCell>
                      <p className="font-medium">{activity.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {activity.enabled
                          ? hasAiActivityOverride(saved) ? "Custom for this activity" : "Inherited settings"
                          : "Disabled by an administrator"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={draft.codexModel || INHERIT_AI_SETTING}
                        disabled={rowDisabled}
                        onValueChange={(value) => setDrafts((current) => ({
                          ...current,
                          [activity.activity]: draftForModel(
                            current[activity.activity] || saved,
                            value,
                            inheritedModel
                          )
                        }))}
                      >
                        <SelectTrigger aria-label={`Model for ${activity.label}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={INHERIT_AI_SETTING}>
                            Use inherited default
                          </SelectItem>
                          {!savedModelAvailable && draft.codexModel ? (
                            <SelectItem value={draft.codexModel}>
                              {draft.codexModel} (saved; unavailable)
                            </SelectItem>
                          ) : null}
                          {models.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.displayName}{model.isDefault ? " (ChatGPT default)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Current effective: {modelName(models, activity.effective.codexModel, true)} · {sourceLabel(activity.provenance.codexModel)}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={draft.reasoningEffort || INHERIT_AI_SETTING}
                        disabled={rowDisabled}
                        onValueChange={(value) => updateDraft(activity.activity, {
                          reasoningEffort: value === INHERIT_AI_SETTING ? null : value as AiReasoningEffort
                        })}
                      >
                        <SelectTrigger aria-label={`Reasoning for ${activity.label}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={INHERIT_AI_SETTING}>
                            Use inherited default
                          </SelectItem>
                          {draft.reasoningEffort && !efforts.includes(draft.reasoningEffort) ? (
                            <SelectItem value={draft.reasoningEffort}>
                              {reasoningLabel(draft.reasoningEffort)} (saved; unsupported by selected model)
                            </SelectItem>
                          ) : null}
                          {REASONING_OPTIONS.filter(({ value }) => efforts.includes(value)).map((option) => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Current effective: {reasoningLabel(activity.effective.reasoningEffort)} · {sourceLabel(activity.provenance.reasoningEffort)}
                      </p>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {hasAiActivityOverride(saved) && !dirty ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={rowDisabled}
                            onClick={() => void onReset(activity.activity)}
                          >
                            <RotateCcw className="mr-2 h-4 w-4" />Reset
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={rowDisabled || !dirty}
                          onClick={() => void onSave(activity.activity, draft)}
                        >
                          <Save className="mr-2 h-4 w-4" />{saving ? "Saving" : "Save"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            ])}
          </TableBody>
          </Table>}
        </>
      )}
    </section>
  )
}

export default AiActivityPreferences
