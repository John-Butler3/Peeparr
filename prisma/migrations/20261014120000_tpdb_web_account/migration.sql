-- Optional ThePornDB website login (for the site's members-only popular
-- scenes), with its cached session and popular list.
CREATE TABLE "TpdbWebAccount" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "sessionCookies" JSONB,
    "popularSceneIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "popularSourcePath" TEXT,
    "popularFetchedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TpdbWebAccount_pkey" PRIMARY KEY ("id")
);
