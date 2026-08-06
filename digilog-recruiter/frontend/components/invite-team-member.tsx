"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { PlusCircle, Send, Copy, Check } from "lucide-react"

export function InviteTeamMember() {
  const { toast } = useToast()
  const [emails, setEmails] = useState<string[]>([""])
  const [role, setRole] = useState("viewer")
  const [message, setMessage] = useState("")
  const [inviteLink, setInviteLink] = useState("https://app.example.com/invite/team/abc123xyz789")
  const [linkCopied, setLinkCopied] = useState(false)

  const handleAddEmail = () => {
    setEmails([...emails, ""])
  }

  const handleEmailChange = (index: number, value: string) => {
    const newEmails = [...emails]
    newEmails[index] = value
    setEmails(newEmails)
  }

  const handleRemoveEmail = (index: number) => {
    if (emails.length > 1) {
      const newEmails = [...emails]
      newEmails.splice(index, 1)
      setEmails(newEmails)
    }
  }

  const handleSendInvites = () => {
    // Filter out empty emails
    const validEmails = emails.filter((email) => email.trim() !== "")

    if (validEmails.length === 0) {
      toast({
        title: "No valid emails",
        description: "Please enter at least one email address.",
        variant: "destructive",
      })
      return
    }

    // In a real app, this would send the invitations
    toast({
      title: "Invitations Sent",
      description: `Sent ${validEmails.length} invitation${validEmails.length > 1 ? "s" : ""}.`,
    })

    // Reset form
    setEmails([""])
    setMessage("")
  }

  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText(inviteLink)
    setLinkCopied(true)
    toast({
      title: "Invite Link Copied",
      description: "The invite link has been copied to your clipboard.",
    })

    setTimeout(() => {
      setLinkCopied(false)
    }, 3000)
  }

  const roleDescriptions = {
    admin: "Can manage team members, billing, and all resources.",
    editor: "Can create and edit resources but cannot manage team members or billing.",
    viewer: "Can only view resources but cannot make any changes.",
  }

  return (
    <div className="grid gap-6">
      <Card className="border rounded-xl overflow-hidden mobile-card animate-slide-in">
        <CardHeader className="bg-primary/5 pb-4">
          <CardTitle className="text-lg md:text-xl">Invite via Email</CardTitle>
          <CardDescription>Send email invitations to people you want to join your team.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          <div className="space-y-2">
            <Label htmlFor="role" className="text-sm font-medium">
              Role
            </Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="role" className="rounded-lg">
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground mt-1">
              {roleDescriptions[role as keyof typeof roleDescriptions]}
            </p>
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-medium">Email Addresses</Label>
            {emails.map((email, index) => (
              <div key={index} className="flex gap-2 items-center">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => handleEmailChange(index, e.target.value)}
                  placeholder="colleague@example.com"
                  className="flex-1 rounded-lg"
                />
                {index === emails.length - 1 ? (
                  <Button type="button" variant="outline" size="icon" className="rounded-full" onClick={handleAddEmail}>
                    <PlusCircle className="h-4 w-4" />
                    <span className="sr-only">Add email</span>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="rounded-full"
                    onClick={() => handleRemoveEmail(index)}
                  >
                    <span className="font-semibold">×</span>
                    <span className="sr-only">Remove email</span>
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="message" className="text-sm font-medium">
              Personal Message (Optional)
            </Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="I'd like to invite you to join our team..."
              className="min-h-[100px] rounded-lg"
            />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row gap-3 bg-muted/10 pt-4">
          <Button onClick={handleSendInvites} className="w-full sm:w-auto rounded-full mobile-button">
            <Send className="mr-2 h-4 w-4" />
            Send Invitations
          </Button>
        </CardFooter>
      </Card>

      <Card className="border rounded-xl overflow-hidden mobile-card animate-slide-in">
        <CardHeader className="bg-primary/5 pb-4">
          <CardTitle className="text-lg md:text-xl">Invite via Link</CardTitle>
          <CardDescription>
            Share this link with anyone you want to join your team. They will be assigned the Viewer role by default.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="grid w-full flex-1 gap-2">
              <Label htmlFor="invite-link" className="sr-only">
                Invite Link
              </Label>
              <Input id="invite-link" value={inviteLink} readOnly className="font-mono text-sm rounded-lg" />
            </div>
            <Button type="button" className="w-full sm:w-auto rounded-full" onClick={handleCopyInviteLink}>
              {linkCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              {linkCopied ? "Copied" : "Copy Link"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
