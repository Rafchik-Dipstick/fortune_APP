CREATE TABLE "IdentityProofReplay" (
    "fingerprint" CHAR(64) NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IdentityProofReplay_pkey" PRIMARY KEY ("fingerprint")
);

CREATE INDEX "IdentityProofReplay_expiresAt_idx" ON "IdentityProofReplay"("expiresAt");

ALTER TABLE "IdentityProofReplay"
ADD CONSTRAINT "IdentityProofReplay_expiry_check" CHECK ("expiresAt" > "verifiedAt");
