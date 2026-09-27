-- Cloudflare collector support functions.
-- These functions are server-only and are callable by the Supabase service_role.

CREATE OR REPLACE FUNCTION public.record_game_peaks(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  affected integer;
BEGIN
  INSERT INTO public."GamePeak" ("gameId", "peakPlayers", "peakAt")
  SELECT
    (row->>'gameId')::bigint,
    (row->>'playerCount')::integer,
    (row->>'peakAt')::timestamptz
  FROM jsonb_array_elements(p_rows) AS row
  WHERE (row->>'gameId') ~ '^[0-9]+$'
    AND (row->>'playerCount') ~ '^[0-9]+$'
    AND NULLIF(row->>'peakAt', '') IS NOT NULL
  ON CONFLICT ("gameId") DO UPDATE
  SET
    "peakPlayers" = GREATEST(public."GamePeak"."peakPlayers", EXCLUDED."peakPlayers"),
    "peakAt" = CASE
      WHEN EXCLUDED."peakPlayers" > public."GamePeak"."peakPlayers"
        THEN EXCLUDED."peakAt"
      ELSE public."GamePeak"."peakAt"
    END;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.record_game_peaks(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_game_peaks(jsonb) TO service_role;
ALTER FUNCTION public.record_game_peaks(jsonb) SET search_path = public, pg_temp;

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

CREATE OR REPLACE FUNCTION public.refresh_rankings()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  calculated_at timestamptz := now();
  current_day_start timestamptz;
  current_week_start timestamptz;
  next_week_start timestamptz;
  current_month_start timestamptz;
  next_month_start timestamptz;
  summary_start_date date;
  weekly_collection_opportunities bigint;
  monthly_collection_opportunities bigint;
BEGIN
  -- Serialize refreshes so concurrent cron/manual calls cannot interleave
  -- DELETE/INSERT operations against the persisted ranking set.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('bobaks.refresh_rankings', 0)
  );

  current_day_start := date_trunc('day', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  current_week_start := date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  next_week_start := current_week_start + interval '7 days';
  current_month_start := date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  next_month_start := current_month_start + interval '1 month';
  summary_start_date := ((calculated_at AT TIME ZONE 'UTC')::date - 364);

  -- Coverage opportunities are finalized collector runs during each period.
  -- Successful and partial runs count; failed and daily-summary runs do not.
  SELECT count(*)
  INTO weekly_collection_opportunities
  FROM public."DataCollectionLog"
  WHERE "status" IN ('success', 'partial')
    AND "startedAt" >= current_week_start
    AND "startedAt" < next_week_start
    AND "startedAt" <= calculated_at;

  SELECT count(*)
  INTO monthly_collection_opportunities
  FROM public."DataCollectionLog"
  WHERE "status" IN ('success', 'partial')
    AND "startedAt" >= current_month_start
    AND "startedAt" < next_month_start
    AND "startedAt" <= calculated_at;

  DELETE FROM public."Ranking"
  WHERE "period" IN ('live', 'weekly', 'monthly', 'yearly');

  WITH latest AS (
    SELECT DISTINCT ON (s."gameId")
      s."gameId",
      s."playerCount",
      s."timestamp"
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId" = s."collectionRunId"
    WHERE s."timestamp" <= calculated_at
      AND (
        s."collectionRunId" IS NULL
        OR l."status" IN ('success', 'partial')
      )
    ORDER BY s."gameId", s."timestamp" DESC, s."id" DESC
  ),
  ranked AS (
    SELECT
      g."id" AS "gameId",
      latest."playerCount"::double precision AS score,
      ROW_NUMBER() OVER (
        ORDER BY latest."playerCount" DESC, g."id" ASC
      ) AS rank
    FROM public."Game" g
    INNER JOIN latest ON latest."gameId" = g."id"
    WHERE g."isActive" = true
      AND latest."timestamp" >= calculated_at - interval '15 minutes'
  )
  INSERT INTO public."Ranking" ("gameId", "period", "rank", "score", "calculatedAt")
  SELECT "gameId", 'live', rank::integer, score, calculated_at
  FROM ranked
  WHERE rank <= 100;

  -- Weekly ranking = current UTC calendar week, Monday through Sunday.
  -- Eligibility requires at least 12 observations and 50% coverage.
  WITH averages AS (
    SELECT
      s."gameId",
      AVG(s."playerCount")::double precision AS score,
      COUNT(*)::bigint AS sample_count
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId" = s."collectionRunId"
    WHERE COALESCE(l."startedAt", s."timestamp") >= current_week_start
      AND COALESCE(l."startedAt", s."timestamp") < next_week_start
      AND COALESCE(l."startedAt", s."timestamp") <= calculated_at
      AND (
        s."collectionRunId" IS NULL
        OR l."status" IN ('success', 'partial')
      )
    GROUP BY s."gameId"
  ),
  eligible AS (
    SELECT
      "gameId",
      score
    FROM averages
    WHERE sample_count >= 12
      AND weekly_collection_opportunities > 0
      AND LEAST(
        sample_count::numeric / weekly_collection_opportunities::numeric,
        1.0
      ) >= 0.50
  ),
  ranked AS (
    SELECT
      g."id" AS "gameId",
      eligible.score AS score,
      ROW_NUMBER() OVER (
        ORDER BY eligible.score DESC, g."id" ASC
      ) AS rank
    FROM public."Game" g
    INNER JOIN eligible ON eligible."gameId" = g."id"
    WHERE g."isActive" = true
  )
  INSERT INTO public."Ranking" ("gameId", "period", "rank", "score", "calculatedAt")
  SELECT "gameId", 'weekly', rank::integer, score, calculated_at
  FROM ranked
  WHERE rank <= 100;

  -- Monthly ranking = current UTC calendar month.
  -- Eligibility requires at least 12 observations and 50% coverage.
  WITH averages AS (
    SELECT
      s."gameId",
      AVG(s."playerCount")::double precision AS score,
      COUNT(*)::bigint AS sample_count
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId" = s."collectionRunId"
    WHERE COALESCE(l."startedAt", s."timestamp") >= current_month_start
      AND COALESCE(l."startedAt", s."timestamp") < next_month_start
      AND COALESCE(l."startedAt", s."timestamp") <= calculated_at
      AND (
        s."collectionRunId" IS NULL
        OR l."status" IN ('success', 'partial')
      )
    GROUP BY s."gameId"
  ),
  eligible AS (
    SELECT
      "gameId",
      score
    FROM averages
    WHERE sample_count >= 12
      AND monthly_collection_opportunities > 0
      AND LEAST(
        sample_count::numeric / monthly_collection_opportunities::numeric,
        1.0
      ) >= 0.50
  ),
  ranked AS (
    SELECT
      g."id" AS "gameId",
      eligible.score AS score,
      ROW_NUMBER() OVER (
        ORDER BY eligible.score DESC, g."id" ASC
      ) AS rank
    FROM public."Game" g
    INNER JOIN eligible ON eligible."gameId" = g."id"
    WHERE g."isActive" = true
  )
  INSERT INTO public."Ranking" ("gameId", "period", "rank", "score", "calculatedAt")
  SELECT "gameId", 'monthly', rank::integer, score, calculated_at
  FROM ranked
  WHERE rank <= 100;

  /*
    Yearly ranking uses 365 UTC calendar dates:
    - the current UTC day from raw GameSnapshot rows
    - the prior 364 complete UTC days from DailyGameStat

    DailyGameStat stores playerSum and totalSamples so the score remains
    a weighted average across the underlying samples.
  */
  WITH yearly_totals AS (
    SELECT
      "gameId",
      SUM("playerSum")::numeric AS player_sum,
      SUM("totalSamples")::bigint AS total_samples
    FROM public."DailyGameStat"
    WHERE "date" >= summary_start_date::timestamp AT TIME ZONE 'UTC'
      AND "date" < current_day_start
    GROUP BY "gameId"

    UNION ALL

    SELECT
      s."gameId",
      SUM(s."playerCount")::numeric AS player_sum,
      COUNT(*)::bigint AS total_samples
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId" = s."collectionRunId"
    WHERE s."timestamp" >= current_day_start
      AND s."timestamp" <= calculated_at
      AND (
        s."collectionRunId" IS NULL
        OR l."status" IN ('success', 'partial')
      )
    GROUP BY s."gameId"
  ),
  yearly_aggregates AS (
    SELECT
      "gameId",
      SUM(player_sum) AS player_sum,
      SUM(total_samples) AS total_samples
    FROM yearly_totals
    GROUP BY "gameId"
  ),
  averages AS (
    SELECT
      "gameId",
      CASE
        WHEN total_samples > 0
          THEN (player_sum / total_samples)::double precision
        ELSE 0::double precision
      END AS score
    FROM yearly_aggregates
    WHERE total_samples > 0
  ),
  ranked AS (
    SELECT
      g."id" AS "gameId",
      averages.score AS score,
      ROW_NUMBER() OVER (
        ORDER BY averages.score DESC, g."id" ASC
      ) AS rank
    FROM public."Game" g
    INNER JOIN averages ON averages."gameId" = g."id"
    WHERE g."isActive" = true
  )
  INSERT INTO public."Ranking" ("gameId", "period", "rank", "score", "calculatedAt")
  SELECT "gameId", 'yearly', rank::integer, score, calculated_at
  FROM ranked
  WHERE rank <= 100;
  PERFORM public.assert_rankings_integrity();
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_rankings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_rankings() TO service_role;
ALTER FUNCTION public.refresh_rankings() SET search_path = public, pg_temp;
