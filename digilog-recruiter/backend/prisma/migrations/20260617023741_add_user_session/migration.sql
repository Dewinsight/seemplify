-- CreateTable
CREATE TABLE "UserSession" (
    "id" CHAR(24) NOT NULL,
    "userId" CHAR(24) NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "refreshTokenHash" TEXT NOT NULL,
    "accessTokenId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "reason" TEXT,
    "riskSignals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3),

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserSession_userId_revoked_idx" ON "UserSession"("userId", "revoked");

-- CreateIndex
CREATE INDEX "UserSession_accessTokenId_idx" ON "UserSession"("accessTokenId");

-- CreateIndex
CREATE INDEX "UserSession_fingerprint_idx" ON "UserSession"("fingerprint");

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
