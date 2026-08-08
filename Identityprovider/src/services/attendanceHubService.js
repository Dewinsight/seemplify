import { SignJWT } from 'jose'

const ISSUER = 'seemplify-idp-hub'
const AUDIENCE = 'time-attendance'

function getSecret() {
  const value = String(process.env.ATTENDANCE_HUB_SECRET || '').trim()
  if (!value) throw new Error('ATTENDANCE_HUB_SECRET is not configured')
  return new TextEncoder().encode(value)
}

export async function issueAttendanceHubToken({ account, organization, role, teams = [] }) {
  const organizationId = organization?._id?.toString?.() || organization?.id?.toString?.()
  if (!account?.sub || !organizationId) throw new Error('Attendance token requires an account and organization')

  return new SignJWT({
    scope: 'attendance:self',
    email: account.email,
    name: account.profile?.name || account.profile?.preferred_username || account.email,
    currentOrganization: {
      id: organizationId,
      name: organization.name || 'Organization',
      role: role || 'staff'
    },
    teams: teams.map(team => ({
      id: team.team?._id?.toString?.() || team.team?.toString?.(),
      organizationId,
      role: team.role
    }))
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(account.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(getSecret())
}
