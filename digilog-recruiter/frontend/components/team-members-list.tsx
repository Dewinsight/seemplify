"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { MoreHorizontal, Shield, Eye, Edit } from "lucide-react"
import { ChangeRoleDialog } from "./change-role-dialog"
import { RemoveMemberDialog } from "./remove-member-dialog"

// Mock data for team members
const teamMembers = [
  {
    id: "1",
    name: "John Doe",
    email: "john.doe@example.com",
    role: "Owner",
    status: "Active",
    avatarUrl: "/john-doe-avatar.png",
    lastActive: "2 hours ago",
  },
  {
    id: "2",
    name: "Jane Smith",
    email: "jane.smith@example.com",
    role: "Admin",
    status: "Active",
    avatarUrl: "/jane-smith-avatar.png",
    lastActive: "5 minutes ago",
  },
  {
    id: "3",
    name: "Mike Brown",
    email: "mike.brown@example.com",
    role: "Editor",
    status: "Active",
    avatarUrl: "",
    lastActive: "1 day ago",
  },
  {
    id: "4",
    name: "Sarah Johnson",
    email: "sarah.johnson@example.com",
    role: "Viewer",
    status: "Active",
    avatarUrl: "",
    lastActive: "3 days ago",
  },
]

export function TeamMembersList() {
  const [selectedMember, setSelectedMember] = useState<(typeof teamMembers)[0] | null>(null)
  const [showChangeRoleDialog, setShowChangeRoleDialog] = useState(false)
  const [showRemoveDialog, setShowRemoveDialog] = useState(false)

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "Owner":
        return "bg-purple-100 text-purple-800 hover:bg-purple-100"
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

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "Owner":
      case "Admin":
        return <Shield className="h-3 w-3 mr-1" />
      case "Editor":
        return <Edit className="h-3 w-3 mr-1" />
      case "Viewer":
        return <Eye className="h-3 w-3 mr-1" />
      default:
        return null
    }
  }

  const handleChangeRole = (member: (typeof teamMembers)[0]) => {
    setSelectedMember(member)
    setShowChangeRoleDialog(true)
  }

  const handleRemoveMember = (member: (typeof teamMembers)[0]) => {
    setSelectedMember(member)
    setShowRemoveDialog(true)
  }

  return (
    <div className="space-y-4">
      {/* Desktop view - Table */}
      <div className="hidden md:block rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Active</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teamMembers.map((member) => (
              <TableRow key={member.id}>
                <TableCell className="flex items-center gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={member.avatarUrl || "/placeholder.svg"} alt={member.name} />
                    <AvatarFallback>
                      {member.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-medium">{member.name}</div>
                    <div className="text-sm text-muted-foreground">{member.email}</div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`flex w-fit items-center ${getRoleBadgeColor(member.role)} animate-soft-pulse`}
                  >
                    {getRoleIcon(member.role)}
                    {member.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="bg-green-100 text-green-800 hover:bg-green-100">
                    {member.status}
                  </Badge>
                </TableCell>
                <TableCell>{member.lastActive}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0">
                        <span className="sr-only">Open menu</span>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleChangeRole(member)} disabled={member.role === "Owner"}>
                        Change Role
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleRemoveMember(member)}
                        disabled={member.role === "Owner"}
                        className="text-red-600"
                      >
                        Remove
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
        {teamMembers.map((member, index) => (
          <div
            key={member.id}
            className="rounded-xl border bg-card p-4 shadow-sm transition-all hover:shadow-md mobile-card animate-slide-in stagger-item"
            style={{ animationDelay: `${index * 0.05}s` }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 border-2 border-primary/10">
                  <AvatarImage src={member.avatarUrl || "/placeholder.svg"} alt={member.name} />
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {member.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-medium">{member.name}</div>
                  <div className="text-sm text-muted-foreground">{member.email}</div>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">More options</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleChangeRole(member)} disabled={member.role === "Owner"}>
                    Change Role
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleRemoveMember(member)}
                    disabled={member.role === "Owner"}
                    className="text-red-600"
                  >
                    Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Role</div>
                <Badge
                  variant="outline"
                  className={`flex w-fit items-center ${getRoleBadgeColor(member.role)} animate-soft-pulse`}
                >
                  {getRoleIcon(member.role)}
                  {member.role}
                </Badge>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Status</div>
                <Badge variant="outline" className="bg-green-100 text-green-800 hover:bg-green-100">
                  {member.status}
                </Badge>
              </div>
              <div className="space-y-1 col-span-2">
                <div className="text-xs text-muted-foreground">Last Active</div>
                <div className="text-sm">{member.lastActive}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <ChangeRoleDialog open={showChangeRoleDialog} onOpenChange={setShowChangeRoleDialog} member={selectedMember} />
      <RemoveMemberDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog} member={selectedMember} />
    </div>
  )
}
