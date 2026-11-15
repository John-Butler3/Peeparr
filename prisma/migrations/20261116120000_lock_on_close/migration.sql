-- Lock on close: the session ends once the app has been left for a while.
ALTER TABLE "AdminUser" ADD COLUMN "lockOnClose" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AdminSession" ADD COLUMN "lockAt" TIMESTAMP(3);
