import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertTriangle } from "lucide-react"

export const metadata = {
  title: "Teams Admin Setup | SMART HR",
  description: "Microsoft Teams admin configuration required for the Nylas Notetaker bot.",
}

export default function TeamsAdminSetupPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-3xl p-6 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Microsoft Teams Admin Setup for Nylas Notetaker Bot
          </h1>
          <p className="text-sm text-muted-foreground">
            This guide is for Microsoft 365 / Teams administrators. SmartHR cannot enable these settings via the Nylas
            API; they must be configured in your tenant.
          </p>
        </header>

        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Required For Reliable Bot Join</AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>
                Allow participants to join before meeting organizer joins: <strong>ENABLED</strong>
              </li>
              <li>
                Waiting room: <strong>DISABLED</strong> (or bot allowlisted)
              </li>
              <li>
                Cloud recording: <strong>ENABLED</strong>
              </li>
              <li>
                Transcription: <strong>ENABLED</strong>
              </li>
            </ul>
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Prerequisites</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ul className="list-disc list-inside space-y-1">
              <li>Microsoft 365 Admin Center access</li>
              <li>Teams Admin Center permissions</li>
              <li>Global admin or Teams admin role</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Step-by-Step Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 text-sm">
            <section className="space-y-2">
              <h2 className="text-base font-semibold">1. Enable Join Before Host</h2>
              <ol className="list-decimal list-inside space-y-1">
                <li>Open Teams Admin Center.</li>
                <li>Navigate to Meeting policies.</li>
                <li>Select the policy used by your organization (often &quot;Global&quot;).</li>
                <li>Enable: Allow participants to join before meeting organizer joins.</li>
                <li>Save.</li>
              </ol>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold">2. Configure Recording &amp; Transcription</h2>
              <ol className="list-decimal list-inside space-y-1">
                <li>In Teams Admin Center, open Meeting policies.</li>
                <li>Edit the active policy.</li>
                <li>Enable Cloud recording and Transcription (names may vary by tenant).</li>
                <li>Save.</li>
              </ol>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold">3. Organization-Wide Meeting Settings</h2>
              <ol className="list-decimal list-inside space-y-1">
                <li>In Teams Admin Center, navigate to Org-wide settings.</li>
                <li>Open Meetings settings.</li>
                <li>Ensure recording/transcription are allowed per your org policy.</li>
                <li>Save.</li>
              </ol>
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold">4. Verify</h2>
              <ol className="list-decimal list-inside space-y-1">
                <li>Create a Teams meeting in SmartHR.</li>
                <li>Enable the AI notetaker.</li>
                <li>Start the meeting and confirm the bot can join (including before organizer join).</li>
                <li>Confirm recording and transcript are generated and retrievable.</li>
              </ol>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

