-- Remote access: the reverse proxy Peeparr trusts (null: none).
ALTER TABLE "AppSettings" ADD COLUMN "trustProxy" TEXT;
