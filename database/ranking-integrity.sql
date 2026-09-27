-- Phase 2 ranking integrity hardening.
-- Prevent duplicate snapshots per game within one collection run and add
-- an in-transaction ranking integrity guard.

ALTER TABLE public."GameSnapshot"
  DROP CONSTRAINT IF EXISTS "GameSnapshot_playerCount_nonnegative";

ALTER TABLE public."GameSnapshot"
  ADD CONSTRAINT "GameSnapshot_playerCount_nonnegative"
  CHECK ("playerCount" >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS "GameSnapshot_gameId_collectionRunId_unique_idx"
  ON public."GameSnapshot" ("gameId", "collectionRunId")
  WHERE "collectionRunId" IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assert_rankings_integrity()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
DECLARE
  v_period text;
  v_rows bigint;
  v_distinct_games bigint;
  v_min_rank integer;
  v_max_rank integer;
  v_calc_timestamps bigint;
  v_bad bigint;
BEGIN
  FOR v_period IN
    SELECT unnest(ARRAY['live', 'weekly', 'monthly', 'yearly']::text[])
  LOOP
    SELECT
      count(*),
      count(DISTINCT "gameId"),
      min("rank"),
      max("rank"),
      count(DISTINCT "calculatedAt")
    INTO
      v_rows,
      v_distinct_games,
      v_min_rank,
      v_max_rank,
      v_calc_timestamps
    FROM public."Ranking"
    WHERE "period" = v_period;

    IF v_rows > 100 THEN
      RAISE EXCEPTION 'Ranking integrity failed: % has % rows', v_period, v_rows;
    END IF;

    IF v_rows > 0 AND (
      v_min_rank <> 1
      OR v_max_rank <> v_rows
      OR v_distinct_games <> v_rows
      OR v_calc_timestamps <> 1
    ) THEN
      RAISE EXCEPTION
        'Ranking integrity failed: % has non-contiguous ranks, duplicate games, or multiple calculation timestamps',
        v_period;
    END IF;

    SELECT count(*)
    INTO v_bad
    FROM public."Ranking" r
    WHERE r."period" = v_period
      AND (r."score" IS NULL OR r."score" < 0);

    IF v_bad > 0 THEN
      RAISE EXCEPTION 'Ranking integrity failed: % has % invalid scores', v_period, v_bad;
    END IF;

    SELECT count(*)
    INTO v_bad
    FROM (
      SELECT
        r."score",
        r."gameId",
        lead(r."score") OVER (ORDER BY r."rank") AS next_score,
        lead(r."gameId") OVER (ORDER BY r."rank") AS next_game
      FROM public."Ranking" r
      WHERE r."period" = v_period
    ) q
    WHERE q.next_score IS NOT NULL
      AND (
        q."score" < q.next_score
        OR (q."score" = q.next_score AND q."gameId" > q.next_game)
      );

    IF v_bad > 0 THEN
      RAISE EXCEPTION 'Ranking integrity failed: % has % ordering violations', v_period, v_bad;
    END IF;

    SELECT count(*)
    INTO v_bad
    FROM public."Ranking" r
    LEFT JOIN public."Game" g ON g."id" = r."gameId"
    WHERE r."period" = v_period
      AND g."isActive" IS DISTINCT FROM true;

    IF v_bad > 0 THEN
      RAISE EXCEPTION 'Ranking integrity failed: % contains % inactive or missing games', v_period, v_bad;
    END IF;
  END LOOP;

  -- Live: every ranked row must match the latest qualifying snapshot and
  -- that snapshot must be no older than 15 minutes at the ranking timestamp.
  WITH calc AS (
    SELECT min("calculatedAt") AS calculated_at
    FROM public."Ranking"
    WHERE "period" = 'live'
  ),
  latest AS (
    SELECT DISTINCT ON (s."gameId")
      s."gameId",
      s."playerCount",
      s."timestamp"
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId" = s."collectionRunId"
    CROSS JOIN calc
    WHERE s."timestamp" <= calc.calculated_at
      AND (
        s."collectionRunId" IS NULL
        OR l."status" IN ('success', 'partial')
      )
    ORDER BY s."gameId", s."timestamp" DESC, s."id" DESC
  )
  SELECT count(*)
  INTO v_bad
  FROM public."Ranking" r
  JOIN public."Game" g ON g."id" = r."gameId"
  LEFT JOIN latest s ON s."gameId" = r."gameId"
  CROSS JOIN calc
  WHERE r."period" = 'live'
    AND (
      s."gameId" IS NULL
      OR s."timestamp" < calc.calculated_at - interval '15 minutes'
      OR s."playerCount"::double precision <> r."score"
      OR g."isActive" IS DISTINCT FROM true
    );

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Ranking integrity failed: live has % invalid rows', v_bad;
  END IF;

  -- Weekly: verify score, 12-sample minimum, and 50% coverage for every
  -- persisted ranked game.
  WITH calc AS (
    SELECT min("calculatedAt") AS calculated_at
    FROM public."Ranking"
    WHERE "period" = 'weekly'
  ),
  bounds AS (
    SELECT
      date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS period_start,
      date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '7 days' AS period_end,
      calculated_at
    FROM calc
  ),
  opportunities AS (
    SELECT count(*) AS opportunity_count
    FROM public."DataCollectionLog" l
    CROSS JOIN bounds b
    WHERE l."status" IN ('success', 'partial')
      AND l."startedAt" >= b.period_start
      AND l."startedAt" < b.period_end
      AND l."startedAt" <= b.calculated_at
  ),
  samples AS (
    SELECT
      s."gameId",
      avg(s."playerCount")::double precision AS score,
      count(*)::bigint AS sample_count
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId" = s."collectionRunId"
    CROSS JOIN bounds b
    WHERE COALESCE(l."startedAt", s."timestamp") >= b.period_start
      AND COALESCE(l."startedAt", s."timestamp") < b.period_end
      AND COALESCE(l."startedAt", s."timestamp") <= b.calculated_at
      AND (
        s."collectionRunId" IS NULL
        OR l."status" IN ('success', 'partial')
      )
    GROUP BY s."gameId"
  )
  SELECT count(*)
  INTO v_bad
  FROM public."Ranking" r
  LEFT JOIN samples s ON s."gameId" = r."gameId"
  CROSS JOIN opportunities o
  WHERE r."period" = 'weekly'
    AND (
      s."gameId" IS NULL
      OR s.sample_count < 12
      OR o.opportunity_count = 0
      OR least(
        s.sample_count::numeric / o.opportunity_count::numeric,
        1.0
      ) < 0.50
      OR s.score <> r."score"
    );

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Ranking integrity failed: weekly has % invalid rows', v_bad;
  END IF;

  -- Monthly: same score and eligibility checks for the current UTC month.
  WITH calc AS (
    SELECT min("calculatedAt") AS calculated_at
    FROM public."Ranking"
    WHERE "period" = 'monthly'
  ),
  bounds AS (
    SELECT
      date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS period_start,
      date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 month' AS period_end,
      calculated_at
    FROM calc
  ),
  opportunities AS (
    SELECT count(*) AS opportunity_count
    FROM public."DataCollectionLog" l
    CROSS JOIN bounds b
    WHERE l."status" IN ('success', 'partial')
      AND l."startedAt" >= b.period_start
      AND l."startedAt" < b.period_end
      AND l."startedAt" <= b.calculated_at
  ),
  samples AS (
    SELECT
      s."gameId",
      avg(s."playerCount")::double precision AS score,
      count(*)::bigint AS sample_count
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId" = s."collectionRunId"
    CROSS JOIN bounds b
    WHERE s."timestamp" >= b.period_start
      AND s."timestamp" < b.period_end
      AND s."timestamp" <= b.calculated_at
      AND (
        s."collectionRunId" IS NULL
        OR l."status" IN ('success', 'partial')
      )
    GROUP BY s."gameId"
  )
  SELECT count(*)
  INTO v_bad
  FROM public."Ranking" r
  LEFT JOIN samples s ON s."gameId" = r."gameId"
  CROSS JOIN opportunities o
  WHERE r."period" = 'monthly'
    AND (
      s."gameId" IS NULL
      OR s.sample_count < 12
      OR o.opportunity_count = 0
      OR least(
        s.sample_count::numeric / o.opportunity_count::numeric,
        1.0
      ) < 0.50
      OR s.score <> r."score"
    );

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Ranking integrity failed: monthly has % invalid rows', v_bad;
  END IF;

  -- Yearly: verify each ranked score against the same weighted-average
  -- calculation used by refresh_rankings() for the 365 UTC calendar dates.
  WITH calc AS (
    SELECT min("calculatedAt") AS calculated_at
    FROM public."Ranking"
    WHERE "period" = 'yearly'
  ),
  bounds AS (
    SELECT
      date_trunc('day', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS current_day_start,
      ((calculated_at AT TIME ZONE 'UTC')::date - 364) AS summary_start_date,
      calculated_at
    FROM calc
  ),
  yearly_totals AS (
    SELECT
      d."gameId",
      sum(d."playerSum")::numeric AS player_sum,
      sum(d."totalSamples")::bigint AS total_samples
    FROM public."DailyGameStat" d
    CROSS JOIN bounds b
    WHERE d."date" >= b.summary_start_date::timestamp AT TIME ZONE 'UTC'
      AND d."date" < b.current_day_start
    GROUP BY d."gameId"

    UNION ALL

    SELECT
      s."gameId",
      sum(s."playerCount")::numeric AS player_sum,
      count(*)::bigint AS total_samples
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId" = s."collectionRunId"
    CROSS JOIN bounds b
    WHERE s."timestamp" >= b.current_day_start
      AND s."timestamp" <= b.calculated_at
      AND (
        s."collectionRunId" IS NULL
        OR l."status" IN ('success', 'partial')
      )
    GROUP BY s."gameId"
  ),
  expected AS (
    SELECT
      "gameId",
      (sum(player_sum) / sum(total_samples))::double precision AS score
    FROM yearly_totals
    GROUP BY "gameId"
    HAVING sum(total_samples) > 0
  )
  SELECT count(*)
  INTO v_bad
  FROM public."Ranking" r
  LEFT JOIN expected e ON e."gameId" = r."gameId"
  WHERE r."period" = 'yearly'
    AND (
      e."gameId" IS NULL
      OR e.score <> r."score"
    );

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Ranking integrity failed: yearly has % invalid score rows', v_bad;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.assert_rankings_integrity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_rankings_integrity() TO service_role;
ALTER FUNCTION public.assert_rankings_integrity() SET search_path = public, pg_temp;

-- The canonical refresh_rankings() function now invokes
-- assert_rankings_integrity() before committing its transaction.
