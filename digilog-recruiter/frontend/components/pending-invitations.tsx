"use client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MoreHorizontal, RefreshCw, Trash2, Copy } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

// Mock data for pending invitations
const pendingInvitations = [
  {
    id: "1",
    email: "alex.wilson@example.com",
    role: "Editor",
    status: "Pending",
    invitedBy: "John Doe",
    invitedAt: "2 days ago",
    expiresIn: "1 day",
  },
  {
    id: "2",
    email: "emma.taylor@example.com",
    role: "Viewer",
    status: "Pending",
    invitedBy: "Jane Smith",
    invitedAt: "1 week ago",
    expiresIn: "Expired",
  },
  {
    id: "3",
    email: "robert.johnson@example.com",
    role: "Admin",
    status: "Pending",
    invitedBy: "John Doe",
    invitedAt: "1 day ago",
    expiresIn: "2 days",
  },
]

export function PendingInvitations() {
  const { toast } = useToast()

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "Admin":
        return "bg-blue-100 text-blue-800 hover:bg-blue-100"
      case "Editor":
        return "bg-green-100 text-green-800 hover:bg-green-100"
      case "Viewer":
        return "bg-gray-100 text-gray-800 hover:bg-gray-100"
      default:
        return "bg-gray-100 text-gray-800 hover:bg-gray-100"
    }
  }

  const getStatusBadgeColor = (status: string, expiresIn: string) => {
    if (expiresIn === "Expired") {
      return "bg-red-100 text-red-800 hover:bg-red-100"
    }
    return "bg-yellow-100 text-yellow-800 hover:bg-yellow-100"
  }

  const handleResendInvitation = (id: string) => {
    toast({
      title: "Invitation Resent",
      description: "The invitation has been resent successfully.",
    })
  }

  const handleCopyInviteLink = (id: string) => {
    // In a real app, this would copy the actual invite link
    navigator.clipboard.writeText(`https://example.com/invite/${id}`)
    toast({
      title: "Invite Link Copied",
      description: "The invite link has been copied to your clipboard.",
    })
  }

  const handleCancelInvitation = (id: string) => {
    toast({
      title: "Invitation Cancelled",
      description: "The invitation has been cancelled successfully.",
    })
  }

  return (
    <div className="space-y-4">
      {/* Desktop view - Table */}
      <div className="hidden md:block rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Invited By</TableHead>
              <TableHead>Invited At</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pendingInvitations.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell>
                  <div className="font-medium">{invitation.email}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`flex w-fit items-center ${getRoleBadgeColor(invitation.role)}`}>
                    {invitation.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`flex w-fit items-center ${getStatusBadgeColor(invitation.status, invitation.expiresIn)}`}
                  >
                    {invitation.expiresIn === "Expired" ? "Expired" : "Pending"}
                  </Badge>
                  {invitation.expiresIn !== "Expired" && (
                    <div className="text-xs text-muted-foreground mt-1">Expires in {invitation.expiresIn}</div>
                  )}
                </TableCell>
                <TableCell>{invitation.invitedBy}</TableCell>
                <TableCell>{invitation.invitedAt}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0">
                        <span className="sr-only">Open menu</span>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleResendInvitation(invitation.id)}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Resend
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleCopyInviteLink(invitation.id)}>
                        <Copy className="mr-2 h-4 w-4" />
                        Copy Invite Link
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleCancelInvitation(invitation.id)} className="text-red-600">
                        <Trash2 className="mr-2 h-4 w-4" />
                        Cancel
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile view - Cards */}
      <div className="grid gap-4 md:hidden">
        {pendingInvitations.map((invitation) => (
          <div key={invitation.id} className="rounded-xl border bg-card p-4 shadow-sm transition-all hover:shadow-md">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{invitation.email}</div>
                <div className="text-sm text-muted-foreground">Invited {invitation.invitedAt}</div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">More options</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleResendInvitation(invitation.id)}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Resend
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleCopyInviteLink(invitation.id)}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy Invite Link
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleCancelInvitation(invitation.id)} className="text-red-600">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Cancel
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Role</div>
                <Badge variant="outline" className={`flex w-fit items-center ${getRoleBadgeColor(invitation.role)}`}>
                  {invitation.role}
                </Badge>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Status</div>
                <Badge
                  variant="outline"
                  className={`flex w-fit items-center ${getStatusBadgeColor(invitation.status, invitation.expiresIn)}`}
                >
                  {invitation.expiresIn === "Expired" ? "Expired" : "Pending"}
                </Badge>
                {invitation.expiresIn !== "Expired" && (
                  <div className="text-xs text-muted-foreground">Expires in {invitation.expiresIn}</div>
                )}
              </div>
              <div className="space-y-1 col-span-2">
                <div className="text-xs text-muted-foreground">Invited By</div>
                <div className="text-sm">{invitation.invitedBy}</div>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 rounded-full"
                onClick={() => handleResendInvitation(invitation.id)}
              >
                <RefreshCw className="mr-2 h-3 w-3" />
                Resend
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 rounded-full"
                onClick={() => handleCopyInviteLink(invitation.id)}
              >
                <Copy className="mr-2 h-3 w-3" />
                Copy Link
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
