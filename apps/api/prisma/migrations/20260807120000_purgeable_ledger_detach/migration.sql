-- Account purge deletes a user's `FortuneDraw` rows, which fires the declared
-- `ON DELETE SET NULL` action on `CreditLedgerEntry.drawId`. That action is an
-- UPDATE, and both the append-only trigger and the closed-subject trigger
-- refused it, while the reason-shape check demanded `drawId IS NOT NULL` for a
-- FORTUNE_DRAW row. A purge therefore aborted on every tick for any account
-- that had ever spent a pack credit, and the personal data survived forever.
--
-- The ledger stays append-only for everything that carries financial meaning.
-- Only the draw reference may be dropped, only in the direction that loses it,
-- and only when every other column is untouched.

CREATE OR REPLACE FUNCTION "fortuneness_reject_ledger_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD."drawId" IS NOT NULL
    AND NEW."drawId" IS NULL
    AND NEW."id" IS NOT DISTINCT FROM OLD."id"
    AND NEW."financialSubjectId" IS NOT DISTINCT FROM OLD."financialSubjectId"
    AND NEW."delta" IS NOT DISTINCT FROM OLD."delta"
    AND NEW."balanceAfter" IS NOT DISTINCT FROM OLD."balanceAfter"
    AND NEW."reason" IS NOT DISTINCT FROM OLD."reason"
    AND NEW."grantId" IS NOT DISTINCT FROM OLD."grantId"
    AND NEW."purchaseTransactionId" IS NOT DISTINCT FROM OLD."purchaseTransactionId"
    AND NEW."refundSourceId" IS NOT DISTINCT FROM OLD."refundSourceId"
    AND NEW."effectKey" IS NOT DISTINCT FROM OLD."effectKey"
    AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt"
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'credit ledger entries are append-only'
    USING ERRCODE = '23514';
END;
$$;

-- The detach necessarily happens after the irreversible cutoff has closed the
-- subject, so the closed-subject guard now covers insertion only. Nothing an
-- UPDATE is still permitted to do can grant a benefit: the append-only trigger
-- above allows no financial column to change, and `CreditLedgerEntry_immutable_owner`
-- continues to pin the owning subject.
DROP TRIGGER "CreditLedgerEntry_reject_closed_subject" ON "CreditLedgerEntry";

CREATE TRIGGER "CreditLedgerEntry_reject_closed_subject"
BEFORE INSERT ON "CreditLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "fortuneness_reject_closed_benefit_mutation"();

-- A detached FORTUNE_DRAW row must remain legal. The debit shape that actually
-- carries money -- one unit, against a real grant -- is unchanged, and the
-- double-debit guard was never `drawId`: it is the unique `effectKey`
-- (`draw:<id>`), which the detach leaves intact.
ALTER TABLE "CreditLedgerEntry"
DROP CONSTRAINT "CreditLedgerEntry_reason_shape_check";

ALTER TABLE "CreditLedgerEntry"
ADD CONSTRAINT "CreditLedgerEntry_reason_shape_check" CHECK (
  ("reason" = 'PACK_PURCHASE' AND "delta" = 10 AND "grantId" IS NOT NULL AND "purchaseTransactionId" IS NOT NULL AND "drawId" IS NULL)
  OR ("reason" = 'FORTUNE_DRAW' AND "delta" = -1 AND "grantId" IS NOT NULL)
  OR ("reason" = 'REFUND_DEBIT' AND "delta" BETWEEN -10 AND -1 AND "grantId" IS NOT NULL AND "refundSourceId" IS NOT NULL)
  OR ("reason" = 'REFUND_REINSTATEMENT' AND "delta" BETWEEN 1 AND 10 AND "grantId" IS NOT NULL AND "refundSourceId" IS NOT NULL)
  OR ("reason" IN ('SUPPORT_ADJUSTMENT', 'MIGRATION') AND "delta" <> 0)
);
