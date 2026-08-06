import type { Metadata } from "next"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { TeamMembersList } from "@/components/team-members-list"
import { PendingInvitations } from "@/components/pending-invitations"
import { InviteTeamMember } from "@/components/invite-team-member"
import OrganizationUpdateNotice from "@/components/OrganizationUpdateNotice"
import "../team-animations.css"

export const metadata: Metadata = {
  title: "Team Management",
  description: "Manage your team members and their roles.",
}

export default function TeamSettingsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-xl font-semibold md:text-2xl">Team Management</h3>
        <p className="text-sm text-muted-foreground">Manage your team members, their roles, and send invitations.</p>
      </div>
      <Separator />
      
      <OrganizationUpdateNotice />

      <Tabs defaultValue="members" className="w-full">
        <div className="mb-6 overflow-x-auto pb-2 md:mb-0">
          <TabsList className="inline-flex w-auto md:w-auto">
            <TabsTrigger value="members" className="min-w-[120px] rounded-full">
              Team Members
            </TabsTrigger>
            <TabsTrigger value="pending" className="min-w-[120px] rounded-full">
              Pending Invites
            </TabsTrigger>
            <TabsTrigger value="invite" className="min-w-[120px] rounded-full">
              Invite Members
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="members" className="space-y-4 mt-4">
          <TeamMembersList />
        </TabsContent>
        <TabsContent value="pending" className="space-y-4 mt-4">
          <PendingInvitations />
        </TabsContent>
        <TabsContent value="invite" className="space-y-4 mt-4">
          <InviteTeamMember />
        </TabsContent>
      </Tabs>
    </div>
  )
}
