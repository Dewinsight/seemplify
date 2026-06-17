-- CreateTable
CREATE TABLE "SeedHistory" (
    "id" CHAR(24) NOT NULL,
    "name" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeedHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeedHistory_name_key" ON "SeedHistory"("name");
