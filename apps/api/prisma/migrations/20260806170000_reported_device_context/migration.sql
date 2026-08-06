ALTER TABLE "User"
ADD COLUMN "reportedDeviceLocale" VARCHAR(35) NOT NULL DEFAULT 'en',
ADD COLUMN "reportedDeviceTimeZone" VARCHAR(128) NOT NULL DEFAULT 'UTC';

UPDATE "User"
SET
  "reportedDeviceLocale" = "resolvedLocale",
  "reportedDeviceTimeZone" = "accountTimeZone";
