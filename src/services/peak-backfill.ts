import { prisma } from "./db";

type PeakBackfillDb = Pick<typeof prisma, "$queryRaw">;

export async function backfillMissingPeaks(db: PeakBackfillDb = prisma): Promise<number> {
  const rows = await db.$queryRaw<Array<{ gameId: bigint }>>`
    WITH ranked AS (
      SELECT
        "gameId",
        "playerCount",
        "timestamp",
        ROW_NUMBER() OVER (
          PARTITION BY "gameId"
          ORDER BY "playerCount" DESC, "timestamp" ASC, "id" ASC
        ) AS row_number
      FROM "GameSnapshot"
    )
    INSERT INTO "GamePeak" ("gameId", "peakPlayers", "peakAt")
    SELECT
      ranked."gameId",
      ranked."playerCount",
      ranked."timestamp"
    FROM ranked
    WHERE ranked.row_number = 1
      AND NOT EXISTS (
        SELECT 1
        FROM "GamePeak" existing
        WHERE existing."gameId" = ranked."gameId"
      )
    ON CONFLICT ("gameId") DO NOTHING
    RETURNING "gameId"
  `;

  return rows.length;
}
