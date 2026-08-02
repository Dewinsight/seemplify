import { createResource } from 'frappe-ui'

declare global {
  interface Window {
    posthog: any
  }
}

type PosthogSettings = {
  posthog_project_id: string
  posthog_host: string
  enable_telemetry: boolean
  telemetry_site_age: number
}

interface CaptureOptions {
  data: {
    user: string
    [key: string]: string | number | boolean | object
  }
}

const noopPosthog = {
  init: () => {},
  capture: () => {},
  identify: () => {},
}

let posthog: typeof window.posthog = window.posthog || noopPosthog

// Posthog Settings
let posthogSettings = createResource({
  url: 'lms.lms.telemetry.get_posthog_settings',
  cache: 'posthog_settings',
  onSuccess: (ps: PosthogSettings) => initPosthog(ps),
})

let isTelemetryEnabled = () => {
  if (!posthogSettings.data) return false

  return (
    posthogSettings.data.enable_telemetry &&
    posthogSettings.data.posthog_project_id &&
    posthogSettings.data.posthog_host
  )
}

// Posthog Initialization
function initPosthog(ps: PosthogSettings) {
  if (!isTelemetryEnabled()) return
  if (!posthog?.init) return

  posthog.init(ps.posthog_project_id, {
    api_host: ps.posthog_host,
    person_profiles: 'identified_only',
    autocapture: false,
    capture_pageview: true,
    capture_pageleave: true,
    enable_heatmaps: false,
    disable_session_recording: false,
    loaded: (ph: typeof posthog) => {
      window.posthog = ph
      ph.identify(window.location.hostname)
    },
  })
}

// Posthog Functions
function capture(
  event: string,
  options: CaptureOptions = { data: { user: '' } },
) {
  if (!isTelemetryEnabled()) return
  if (!window.posthog?.capture) return
  window.posthog.capture(`lms_${event}`, options)
}

function startRecording() {
}

function stopRecording() {
}

// Posthog Plugin
function posthogPlugin(app: any) {
    app.config.globalProperties.posthog = posthog
    if (window.posthog?.init && !window.posthog?.length) posthogSettings.fetch()
}

export {
  posthog,
  posthogSettings,
  posthogPlugin,
  capture,
  startRecording,
  stopRecording,
}
