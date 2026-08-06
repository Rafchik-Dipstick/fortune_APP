ALTER TABLE "SessionFamily"
ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1,
ADD CONSTRAINT "SessionFamily_session_version_positive_check" CHECK ("sessionVersion" >= 1);

ALTER TABLE "SessionFamily"
ALTER COLUMN "sessionVersion" DROP DEFAULT;
