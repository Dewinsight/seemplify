/**
 * Invitation Gatekeeper
 * Forces users to accept or decline pending organization invitations
 * Blocks all pages until decision is made
 */
class InvitationGatekeeper {
  constructor() {
    this.modal = null
    this.init()
  }

  async init() {
    try {
      // Check for pending invitations
      const response = await fetch('/api/invitations/pending')
      const invitations = await response.json()

      if (invitations && invitations.length > 0) {
        this.showBlockingModal(invitations)
      }
    } catch (error) {
      console.error('Failed to check pending invitations:', error)
    }
  }

  showBlockingModal(invitations) {
    // Prevent scrolling
    document.body.style.overflow = 'hidden'

    // Create modal container
    this.modal = document.createElement('div')
    this.modal.id = 'invitation-gatekeeper'
    this.modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(8px);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
    `

    this.modal.innerHTML = this.getModalHTML(invitations)
    document.body.appendChild(this.modal)

    // Prevent escape key
    this.modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
      }
    }, true)

    // Prevent click outside
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        e.preventDefault()
        e.stopPropagation()
      }
    })
  }

  getModalHTML(invitations) {
    if (invitations.length === 1) {
      return this.getSingleInviteModal(invitations[0])
    } else {
      return this.getMultipleInvitesModal(invitations)
    }
  }

  getSingleInviteModal(invitation) {
    return `
      <div style="background: white; border-radius: 16px; padding: 40px; max-width: 500px; width: 90%; box-shadow: 0 25px 50px rgba(0, 0, 0, 0.3);">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="font-size: 48px; margin-bottom: 16px;">🏢</div>
          <h2 style="margin: 0 0 16px 0; color: #1f2937; font-size: 28px;">Pending Organization Invitation</h2>
          <p style="margin: 0 0 8px 0; color: #64748b;">You have been invited to join an organization</p>
        </div>

        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
          <div style="color: white; font-weight: 600; font-size: 20px; margin-bottom: 8px;">
            ${invitation.organization?.name || 'Organization'}
          </div>
          <div style="color: rgba(255, 255, 255, 0.9); font-size: 14px; line-height: 1.6;">
            <div><strong>Role:</strong> ${this.formatRole(invitation.role)}</div>
            <div><strong>Invited by:</strong> ${invitation.invitedBy?.name || invitation.invitedBy?.email || 'Unknown'}</div>
            ${invitation.expiresAt ? `<div><strong>Expires:</strong> ${new Date(invitation.expiresAt).toLocaleDateString()}</div>` : ''}
          </div>
        </div>

        <div style="text-align: center;">
          <button onclick="window.gatekeeper.accept('${invitation.id}')" 
                  style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 16px 32px; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; margin-right: 12px;"
                  onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 8px 20px rgba(102, 126, 234, 0.4)';"
                  onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none';">
            Accept Invitation
          </button>
          <button onclick="window.gatekeeper.decline('${invitation.id}')"
                  style="background: white; color: #64748b; padding: 16px 32px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.2s;"
                  onmouseover="this.style.borderColor='#667eea';"
                  onmouseout="this.style.borderColor='#e2e8f0';">
            Decline
          </button>
        </div>

        <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 13px;">
          This action cannot be dismissed. You must accept or decline to continue.
        </div>
      </div>
    `
  }

  getMultipleInvitesModal(invitations) {
    const invitesHTML = invitations.map((inv, index) => `
      <div style="background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 12px;">
        <div style="font-weight: 600; color: #1f2937; margin-bottom: 8px;">
          ${index + 1}. ${invitation.organization?.name || 'Organization'}
        </div>
        <div style="color: #64748b; font-size: 14px;">
          <strong>Role:</strong> ${this.formatRole(inv.role)} •
          <strong>From:</strong> ${invitation.invitedBy?.name || invitation.invitedBy?.email || 'Unknown'}
        </div>
        <div style="margin-top: 12px; display: flex; gap: 8px;">
          <button onclick="window.gatekeeper.accept('${inv.id}')"
                  style="flex: 1; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 10px 20px; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer;">
            Accept
          </button>
          <button onclick="window.gatekeeper.decline('${inv.id}')"
                  style="flex: 1; background: white; color: #64748b; padding: 10px 20px; border: 2px solid #e2e8f0; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer;">
            Decline
          </button>
        </div>
      </div>
    `).join('')

    return `
      <div style="background: white; border-radius: 16px; padding: 40px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; box-shadow: 0 25px 50px rgba(0, 0, 0, 0.3);">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="font-size: 48px; margin-bottom: 16px;">🏢</div>
          <h2 style="margin: 0 0 16px 0; color: #1f2937; font-size: 28px;">
            You have ${invitations.length} Pending Invitations
          </h2>
          <p style="margin: 0 0 8px 0; color: #64748b;">
            You have been invited to join ${invitations.length} organization${invitations.length > 1 ? 's' : ''}. Please accept or decline each invitation to continue.
          </p>
        </div>

        ${invitesHTML}

        <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 2px solid #e2e8f0; color: #9ca3af; font-size: 13px;">
          This action cannot be dismissed. You must accept or decline all invitations to continue.
        </div>
      </div>
    `
  }

  formatRole(role) {
    const roleMap = {
      'owner': 'Owner',
      'admin': 'Admin',
      'hr_manager': 'HR Manager',
      'recruiter': 'Recruiter',
      'interviewer': 'Interviewer',
      'staff': 'Staff'
    }
    return roleMap[role] || role
  }

  async accept(invitationId) {
    try {
      const btn = event?.target
      if (btn) {
        btn.disabled = true
        btn.textContent = 'Accepting...'
      }

      const response = await fetch(`/api/invitations/accept/${invitationId}`, {
        method: 'POST'
      })

      const data = await response.json()

      if (response.ok) {
        alert(`✅ Successfully joined ${data.organization?.name || 'the organization'}!`)
        window.location.href = '/organizations'
      } else {
        alert(data.error || 'Failed to accept invitation')
        if (btn) {
          btn.disabled = false
          btn.textContent = 'Accept'
        }
      }
    } catch (error) {
      console.error('Accept invitation error:', error)
      alert('Failed to accept invitation. Please try again.')
    }
  }

  async decline(invitationId) {
    if (!confirm('Are you sure you want to decline this invitation?')) {
      return
    }

    try {
      const btn = event?.target
      if (btn) {
        btn.disabled = true
        btn.textContent = 'Declining...'
      }

      const response = await fetch(`/api/invitations/decline/${invitationId}`, {
        method: 'POST'
      })

      if (response.ok) {
        alert('✅ Invitation declined successfully')
        this.removeModal()
        window.location.reload()
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to decline invitation')
        if (btn) {
          btn.disabled = false
          btn.textContent = 'Decline'
        }
      }
    } catch (error) {
      console.error('Decline invitation error:', error)
      alert('Failed to decline invitation. Please try again.')
    }
  }

  removeModal() {
    if (this.modal) {
      this.modal.remove()
      document.body.style.overflow = 'auto'
      this.modal = null
    }
  }
}

// Initialize gatekeeper when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.gatekeeper = new InvitationGatekeeper()
  })
} else {
  window.gatekeeper = new InvitationGatekeeper()
}
