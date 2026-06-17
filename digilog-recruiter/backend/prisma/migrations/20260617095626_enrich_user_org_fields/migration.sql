-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "legacyUsers" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "calendarConnected" BOOLEAN,
ADD COLUMN     "calendarConnectedEmail" TEXT,
ADD COLUMN     "calendarEmail" TEXT,
ADD COLUMN     "calendarProvider" TEXT,
ADD COLUMN     "defaultOrganizationId" CHAR(24),
ADD COLUMN     "emailCapabilities" JSONB,
ADD COLUMN     "grantConnectedAt" TIMESTAMP(3),
ADD COLUMN     "hasCompletedOrganizationSetup" BOOLEAN,
ADD COLUMN     "idpAccessToken" TEXT,
ADD COLUMN     "idpTeamPermissions" JSONB,
ADD COLUMN     "idpTeams" JSONB,
ADD COLUMN     "idpTokenExpiry" TIMESTAMP(3),
ADD COLUMN     "lastGrantRefresh" TIMESTAMP(3),
ADD COLUMN     "lastGrantRevocation" TIMESTAMP(3),
ADD COLUMN     "lastPasswordChange" TIMESTAMP(3),
ADD COLUMN     "legacyOrganizations" JSONB,
ADD COLUMN     "nylasAccountId" CHAR(24),
ADD COLUMN     "nylasGrantId" TEXT,
ADD COLUMN     "nylasGrantStatus" TEXT,
ADD COLUMN     "resetPasswordExpires" TIMESTAMP(3),
ADD COLUMN     "resetPasswordToken" TEXT,
ADD COLUMN     "subscription" JSONB,
ADD COLUMN     "twoFactorEnabled" BOOLEAN;

-- CreateIndex
CREATE INDEX "User_resetPasswordToken_idx" ON "User"("resetPasswordToken");

-- CreateIndex
CREATE INDEX "User_nylasGrantId_idx" ON "User"("nylasGrantId");
