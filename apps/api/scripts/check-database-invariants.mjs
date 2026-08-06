import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
  throw new Error('DATABASE_URL is required for invariant checks.');
}

const checks = [
  {
    name: 'completed migration history',
    query: `
      SELECT COUNT(*)::int AS violations
      FROM "_prisma_migrations"
      WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
    `,
  },
  {
    name: 'canonical card count',
    query: 'SELECT ABS(COUNT(*) - 78)::int AS violations FROM "TarotCard"',
  },
  {
    name: 'active content matrix',
    query: `
      SELECT COUNT(*)::int AS violations
      FROM (
        SELECT card."key"
        FROM "TarotCard" card
        LEFT JOIN "FortuneTemplate" template
          ON template."cardKey" = card."key"
          AND template."locale" = 'en'
          AND template."active" = true
        WHERE card."active" = true
        GROUP BY card."key"
        HAVING COUNT(DISTINCT (template."orientation", template."intention")) <> 8
      ) incomplete
    `,
  },
  {
    name: 'ledger running balances',
    query: `
      SELECT COUNT(*)::int AS violations
      FROM (
        SELECT
          "balanceAfter",
          SUM("delta") OVER (
            PARTITION BY "financialSubjectId"
            ORDER BY "createdAt", "id"
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS computed_balance
        FROM "CreditLedgerEntry"
      ) balances
      WHERE "balanceAfter" <> computed_balance OR computed_balance < 0
    `,
  },
  {
    name: 'closed financial subjects',
    query: `
      SELECT COUNT(*)::int AS violations
      FROM "FinancialSubject" subject
      LEFT JOIN "CreditLedgerEntry" entry ON entry."financialSubjectId" = subject."id"
      WHERE subject."benefitsDisabledAt" IS NOT NULL
      GROUP BY subject."id"
      HAVING COALESCE(SUM(entry."delta"), 0) <> 0
    `,
    aggregateRows: true,
  },
];

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  for (const check of checks) {
    const result = await pool.query(check.query);
    const violations = check.aggregateRows
      ? result.rows.reduce((total, row) => total + Number(row.violations ?? 0), 0)
      : Number(result.rows[0]?.violations ?? 0);
    if (violations !== 0) {
      throw new Error(`${check.name} invariant failed with ${String(violations)} violation(s).`);
    }
    process.stdout.write(`Database invariant passed: ${check.name}.\n`);
  }
} finally {
  await pool.end();
}
