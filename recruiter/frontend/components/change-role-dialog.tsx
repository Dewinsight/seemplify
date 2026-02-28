"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Shield, Edit, Eye } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface ChangeRoleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: {
    id: string
    name: string
    email?: string
    role: string
  } | null
  onRoleChange?: (newRole: string) => void | Promise<void>
}

export function ChangeRoleDialog({ open, onOpenChange, member, onRoleChange }: ChangeRoleDialogProps) {
  const { toast } = useToast()
  const [selectedRole, setSelectedRole] = useState<string>("")
  const [isSaving, setIsSaving] = useState(false)

  // Set the selected role when the dialog opens with a member
  if (open && member && !selectedRole) {
    setSelectedRole(member.role.toLowerCase())
  }

  // Reset selected role when dialog closes
  if (!open && selectedRole) {
    setTimeout(() => setSelectedRole(""), 300)
  }

  const handleSave = async () => {
    if (!member || !selectedRole) return

    setIsSaving(true)
    try {
      if (onRoleChange) {
        await onRoleChange(selectedRole)
      } else {
        // Fallback if no onRoleChange provided
        toast({
          title: "Role Updated",
          description: `${member.name}'s role has been updated to ${selectedRole}.`,
        })
      }
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to update role:', error)
    } finally {
      setIsSaving(false)
    }
  }

  if (!member) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] rounded-xl p-0 overflow-hidden z-[100] fixed-modal">
        <DialogHeader className="bg-primary/5 p-6">
          <DialogTitle className="text-lg md:text-xl">Change Role</DialogTitle>
          <DialogDescription>Change the role and permissions for {member.name}.</DialogDescription>
        </DialogHeader>
        <div className="p-6">
          <RadioGroup value={selectedRole} onValueChange={setSelectedRole} className="space-y-4">
            <div className="flex items-start space-x-3 space-y-0 rounded-lg p-3 hover:bg-muted/50 transition-colors">
              <RadioGroupItem value="admin" id="admin" />
              <div className="grid gap-1.5 leading-none">
                <Label htmlFor="admin" className="flex items-center gap-1.5">
                  <Shield className="h-4 w-4 text-blue-600" />
                  Admin
                </Label>
                <p className="text-sm text-muted-foreground">Can manage team members, billing, and all resources.</p>
              </div>
            </div>
            <div className="flex items-start space-x-3 space-y-0 rounded-lg p-3 hover:bg-muted/50 transition-colors">
              <RadioGroupItem value="editor" id="editor" />
              <div className="grid gap-1.5 leading-none">
                <Label htmlFor="editor" className="flex items-center gap-1.5">
                  <Edit className="h-4 w-4 text-green-600" />
                  Editor
                </Label>
                <p className="text-sm text-muted-foreground">
                  Can create and edit resources but cannot manage team members or billing.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3 space-y-0 rounded-lg p-3 hover:bg-muted/50 transition-colors">
              <RadioGroupItem value="viewer" id="viewer" />
              <div className="grid gap-1.5 leading-none">
                <Label htmlFor="viewer" className="flex items-center gap-1.5">
                  <Eye className="h-4 w-4 text-gray-600" />
                  Viewer
                </Label>
                <p className="text-sm text-muted-foreground">Can only view resources but cannot make any changes.</p>
              </div>
            </div>
          </RadioGroup>
        </div>
        <DialogFooter className="flex flex-col sm:flex-row gap-2 p-6 bg-muted/10">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-full" disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!selectedRole || selectedRole === member.role.toLowerCase() || isSaving}
            className="rounded-full"
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
