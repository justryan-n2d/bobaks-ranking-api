-- Phase 4 Part 6.2: query optimization.
-- Preserve ranking formulas, coverage rules, and audit output while reducing
-- repeated full-table scans and sort work.

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
  -- Use one indexed lookup per ranked game instead of sorting the entire snapshot table.
  WITH calc AS (
    SELECT min("calculatedAt") AS calculated_at
    FROM public."Ranking"
    WHERE "period" = 'live'
  )
  SELECT count(*)
  INTO v_bad
  FROM public."Ranking" r
  JOIN public."Game" g ON g."id" = r."gameId"
  CROSS JOIN calc
  LEFT JOIN LATERAL (
    SELECT
      s."playerCount",
      s."timestamp"
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId" = s."collectionRunId"
    WHERE s."gameId" = r."gameId"
      AND s."timestamp" <= calc.calculated_at
      AND (
        s."collectionRunId" IS NULL
        OR l."status" IN ('success', 'partial')
      )
    ORDER BY s."timestamp" DESC, s."id" DESC
    LIMIT 1
  ) s ON true
  WHERE r."period" = 'live'
    AND (
      s."timestamp" IS NULL
      OR s."timestamp" < calc.calculated_at - interval '15 minutes'
      OR s."playerCount"::double precision <> r."score"
      OR g."isActive" IS DISTINCT FROM true
    );

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Ranking integrity failed: live has % invalid rows', v_bad;
  END IF;

  -- Weekly and monthly integrity checks share one current-period scan.
  -- The lower bound includes a week that crosses a UTC month boundary.
  WITH calc AS (
    SELECT min("calculatedAt") AS calculated_at
    FROM public."Ranking"
  ),
  bounds AS (
    SELECT
      date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS week_start,
      date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '7 days' AS week_end,
      date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS month_start,
      date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 month' AS month_end,
      calculated_at
    FROM calc
  ),
  opportunities AS (
    SELECT
      count(*) FILTER (
        WHERE l."startedAt" >= b.week_start
          AND l."startedAt" < b.week_end
      ) AS weekly_opportunity_count,
      count(*) FILTER (
        WHERE l."startedAt" >= b.month_start
          AND l."startedAt" < b.month_end
      ) AS monthly_opportunity_count
    FROM public."DataCollectionLog" l
    CROSS JOIN bounds b
    WHERE l."status" IN ('success', 'partial')
      AND l."startedAt" <= b.calculated_at
      AND l."startedAt" >= LEAST(b.week_start, b.month_start)
  ),
  current_month_samples AS MATERIALIZED (
    SELECT
      s."gameId",
      avg(s."playerCount") FILTER (
        WHERE COALESCE(l."startedAt", s."timestamp") >= b.week_start
          AND COALESCE(l."startedAt", s."timestamp") < b.week_end
          AND COALESCE(l."startedAt", s."timestamp") <= b.calculated_at
      )::double precision AS weekly_score,
      count(*) FILTER (
        WHERE COALESCE(l."startedAt", s."timestamp") >= b.week_start
          AND COALESCE(l."startedAt", s."timestamp") < b.week_end
          AND COALESCE(l."startedAt", s."timestamp") <= b.calculated_at
      )::bigint AS weekly_sample_count,
      avg(s."playerCount") FILTER (
        WHERE COALESCE(l."startedAt", s."timestamp") >= b.month_start
          AND COALESCE(l."startedAt", s."timestamp") < b.month_end
          AND COALESCE(l."startedAt", s."timestamp") <= b.calculated_at
      )::double precision AS monthly_score,
      count(*) FILTER (
        WHERE COALESCE(l."startedAt", s."timestamp") >= b.month_start
          AND COALESCE(l."startedAt", s."timestamp") < b.month_end
          AND COALESCE(l."startedAt", s."timestamp") <= b.calculated_at
      )::bigint AS monthly_sample_count
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId" = s."collectionRunId"
    CROSS JOIN bounds b
    WHERE COALESCE(l."startedAt", s."timestamp") >= LEAST(b.week_start, b.month_start)
      AND COALESCE(l."startedAt", s."timestamp") <= b.calculated_at
      AND (
        s."collectionRunId" IS NULL
        OR l."status" IN ('success', 'partial')
      )
    GROUP BY s."gameId"
  ),
  weekly_bad AS (
    SELECT count(*)::bigint AS invalid_rows
    FROM public."Ranking" r
    LEFT JOIN current_month_samples s ON s."gameId" = r."gameId"
    CROSS JOIN opportunities o
    WHERE r."period" = 'weekly'
      AND (
        s."gameId" IS NULL
        OR s.weekly_sample_count < 12
        OR o.weekly_opportunity_count = 0
        OR LEAST(
          s.weekly_sample_count::numeric / o.weekly_opportunity_count::numeric,
          1.0
        ) < 0.50
        OR s.weekly_score <> r."score"
      )
  ),
  monthly_bad AS (
    SELECT count(*)::bigint AS invalid_rows
    FROM public."Ranking" r
    LEFT JOIN current_month_samples s ON s."gameId" = r."gameId"
    CROSS JOIN opportunities o
    WHERE r."period" = 'monthly'
      AND (
        s."gameId" IS NULL
        OR s.monthly_sample_count < 12
        OR o.monthly_opportunity_count = 0
        OR LEAST(
          s.monthly_sample_count::numeric / o.monthly_opportunity_count::numeric,
          1.0
        ) < 0.50
        OR s.monthly_score <> r."score"
      )
  )
  SELECT weekly_bad.invalid_rows + monthly_bad.invalid_rows
  INTO v_bad
  FROM weekly_bad
  CROSS JOIN monthly_bad;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Ranking integrity failed: weekly or monthly has % invalid rows', v_bad;
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
  active_game_count bigint;
  live_candidate_rows bigint;
  live_minimum_rows bigint;
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

  SELECT count(*)
  INTO active_game_count
  FROM public."Game"
  WHERE "isActive" = true;

  live_minimum_rows := GREATEST(
    1,
    CEIL(LEAST(active_game_count, 100)::numeric * 0.50)::bigint
  );

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

  -- Live ranking uses one indexed latest-snapshot lookup per active game.
  WITH ranked AS (
    SELECT
      g."id" AS "gameId",
      latest."playerCount"::double precision AS score,
      ROW_NUMBER() OVER (
        ORDER BY latest."playerCount" DESC, g."id" ASC
      ) AS rank
    FROM public."Game" g
    LEFT JOIN LATERAL (
      SELECT
        s."playerCount",
        s."timestamp"
      FROM public."GameSnapshot" s
      LEFT JOIN public."DataCollectionLog" l
        ON l."collectionRunId" = s."collectionRunId"
      WHERE s."gameId" = g."id"
        AND s."timestamp" <= calculated_at
        AND (
          s."collectionRunId" IS NULL
          OR l."status" IN ('success', 'partial')
        )
      ORDER BY s."timestamp" DESC, s."id" DESC
      LIMIT 1
    ) latest ON true
    WHERE g."isActive" = true
      AND latest."timestamp" >= calculated_at - interval '15 minutes'
  )
  INSERT INTO public."Ranking" ("gameId", "period", "rank", "score", "calculatedAt")
  SELECT "gameId", 'live', rank::integer, score, calculated_at
  FROM ranked
  WHERE rank <= 100;

  SELECT count(*)
  INTO live_candidate_rows
  FROM public."Ranking"
  WHERE "period" = 'live';

  -- Fail closed when the live candidate set collapses unexpectedly.
  -- A source/discovery outage must not replace a healthy live ranking with
  -- an empty or severely depleted result.
  IF live_candidate_rows < live_minimum_rows THEN
    RAISE EXCEPTION
      'Ranking refresh aborted: live candidate has % rows, minimum safe rows is % for % active games',
      live_candidate_rows,
      live_minimum_rows,
      active_game_count;
  END IF;

  -- Weekly and monthly rankings share one current-period snapshot scan.
  -- The lower bound includes a week that crosses a UTC month boundary.
  WITH current_period_samples AS MATERIALIZED (
    SELECT
      s."gameId",
      AVG(s."playerCount") FILTER (
        WHERE COALESCE(l."startedAt", s."timestamp") >= current_week_start
          AND COALESCE(l."startedAt", s."timestamp") < next_week_start
      )::double precision AS weekly_score,
      COUNT(*) FILTER (
        WHERE COALESCE(l."startedAt", s."timestamp") >= current_week_start
          AND COALESCE(l."startedAt", s."timestamp") < next_week_start
      )::bigint AS weekly_sample_count,
      AVG(s."playerCount") FILTER (
        WHERE COALESCE(l."startedAt", s."timestamp") >= current_month_start
          AND COALESCE(l."startedAt", s."timestamp") < next_month_start
      )::double precision AS monthly_score,
      COUNT(*) FILTER (
        WHERE COALESCE(l."startedAt", s."timestamp") >= current_month_start
          AND COALESCE(l."startedAt", s."timestamp") < next_month_start
      )::bigint AS monthly_sample_count
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId" = s."collectionRunId"
    WHERE COALESCE(l."startedAt", s."timestamp") >= LEAST(current_week_start, current_month_start)
      AND COALESCE(l."startedAt", s."timestamp") <= calculated_at
      AND (
        s."collectionRunId" IS NULL
        OR l."status" IN ('success', 'partial')
      )
    GROUP BY s."gameId"
  ),
  weekly_ranked AS (
    SELECT
      g."id" AS "gameId",
      cps.weekly_score AS score,
      ROW_NUMBER() OVER (
        ORDER BY cps.weekly_score DESC, g."id" ASC
      ) AS rank
    FROM public."Game" g
    INNER JOIN current_period_samples cps ON cps."gameId" = g."id"
    WHERE g."isActive" = true
      AND cps.weekly_sample_count >= 12
      AND weekly_collection_opportunities > 0
      AND LEAST(
        cps.weekly_sample_count::numeric / weekly_collection_opportunities::numeric,
        1.0
      ) >= 0.50
  ),
  monthly_ranked AS (
    SELECT
      g."id" AS "gameId",
      cps.monthly_score AS score,
      ROW_NUMBER() OVER (
        ORDER BY cps.monthly_score DESC, g."id" ASC
      ) AS rank
    FROM public."Game" g
    INNER JOIN current_period_samples cps ON cps."gameId" = g."id"
    WHERE g."isActive" = true
      AND cps.monthly_sample_count >= 12
      AND monthly_collection_opportunities > 0
      AND LEAST(
        cps.monthly_sample_count::numeric / monthly_collection_opportunities::numeric,
        1.0
      ) >= 0.50
  )
  INSERT INTO public."Ranking" ("gameId", "period", "rank", "score", "calculatedAt")
  SELECT "gameId", 'weekly', rank::integer, score, calculated_at
  FROM weekly_ranked
  WHERE rank <= 100
  UNION ALL
  SELECT "gameId", 'monthly', rank::integer, score, calculated_at
  FROM monthly_ranked
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

CREATE OR REPLACE FUNCTION public.get_rankings_audit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
DECLARE
  result jsonb;
  calculated_at timestamptz;
  latest_collection_started_at timestamptz;
  latest_collection_status text;
  weekly_opportunities bigint;
  monthly_opportunities bigint;
  weekly_min_samples bigint;
  weekly_min_coverage numeric;
  monthly_min_samples bigint;
  monthly_min_coverage numeric;
  live_max_age_seconds double precision;
  historical_recovery jsonb;
BEGIN
  PERFORM public.assert_rankings_integrity();
  historical_recovery := public.get_historical_recovery_audit(31);

  SELECT max("calculatedAt")
  INTO calculated_at
  FROM public."Ranking";

  SELECT "startedAt","status"
  INTO latest_collection_started_at, latest_collection_status
  FROM public."DataCollectionLog"
  WHERE "status" IN ('success','partial','failed')
  ORDER BY "startedAt" DESC
  LIMIT 1;

  SELECT count(*)
  INTO weekly_opportunities
  FROM public."DataCollectionLog"
  WHERE "status" IN ('success','partial')
    AND "startedAt" >= date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND "startedAt" < (date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '7 days')
    AND "startedAt" <= calculated_at;

  SELECT count(*)
  INTO monthly_opportunities
  FROM public."DataCollectionLog"
  WHERE "status" IN ('success','partial')
    AND "startedAt" >= date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND "startedAt" < (date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 month')
    AND "startedAt" <= calculated_at;

  -- Weekly and monthly coverage metrics share one current-period snapshot scan.
  -- The lower bound includes a week that crosses a UTC month boundary.
  WITH current_month_samples AS MATERIALIZED (
    SELECT
      s."gameId",
      COUNT(*) FILTER (
        WHERE COALESCE(l."startedAt", s."timestamp") >= date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          AND COALESCE(l."startedAt", s."timestamp") < date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '7 days'
      )::bigint AS weekly_sample_count,
      COUNT(*) FILTER (
        WHERE COALESCE(l."startedAt", s."timestamp") >= date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          AND COALESCE(l."startedAt", s."timestamp") < date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 month'
      )::bigint AS monthly_sample_count
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId" = s."collectionRunId"
    WHERE COALESCE(l."startedAt", s."timestamp") >= LEAST(
      date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
      date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    )
      AND COALESCE(l."startedAt", s."timestamp") <= calculated_at
      AND (
        s."collectionRunId" IS NULL
        OR l."status" IN ('success','partial')
      )
    GROUP BY s."gameId"
  ),
  stats AS (
    SELECT
      MIN(c.weekly_sample_count) FILTER (WHERE r."period"='weekly') AS weekly_min_samples,
      MIN(LEAST(
        c.weekly_sample_count::numeric / NULLIF(weekly_opportunities, 0)::numeric,
        1.0
      )) FILTER (WHERE r."period"='weekly') AS weekly_min_coverage,
      MIN(c.monthly_sample_count) FILTER (WHERE r."period"='monthly') AS monthly_min_samples,
      MIN(LEAST(
        c.monthly_sample_count::numeric / NULLIF(monthly_opportunities, 0)::numeric,
        1.0
      )) FILTER (WHERE r."period"='monthly') AS monthly_min_coverage
    FROM public."Ranking" r
    JOIN current_month_samples c ON c."gameId"=r."gameId"
    WHERE r."period" IN ('weekly','monthly')
  )
  SELECT
    weekly_min_samples,
    weekly_min_coverage,
    monthly_min_samples,
    monthly_min_coverage
  INTO weekly_min_samples, weekly_min_coverage,
       monthly_min_samples, monthly_min_coverage
  FROM stats;

  -- Live audit uses one indexed lookup per ranked game.
  WITH calc AS (
    SELECT min("calculatedAt") AS calculated_at
    FROM public."Ranking"
    WHERE "period"='live'
  )
  SELECT max(extract(epoch from (calc.calculated_at - latest."timestamp")))
  INTO live_max_age_seconds
  FROM public."Ranking" r
  CROSS JOIN calc
  LEFT JOIN LATERAL (
    SELECT s."timestamp"
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId"=s."collectionRunId"
    WHERE s."gameId"=r."gameId"
      AND s."timestamp"<=calc.calculated_at
      AND (s."collectionRunId" IS NULL OR l."status" IN ('success','partial'))
    ORDER BY s."timestamp" DESC, s."id" DESC
    LIMIT 1
  ) latest ON true
  WHERE r."period"='live'
    AND latest."timestamp" IS NOT NULL;

  result := jsonb_build_object(
    'methodologyVersion', '2026-09-28',
    'auditStatus', CASE
      WHEN historical_recovery->>'status' = 'passed' THEN 'passed'
      ELSE 'needs_repair'
    END,
    'historicalRecovery', historical_recovery,
    'auditedAt', now(),
    'collection', jsonb_build_object(
      'cadenceSeconds', 600,
      'latestStartedAt', latest_collection_started_at,
      'latestStatus', latest_collection_status
    ),
    'rankings', jsonb_build_object(
      'live', jsonb_build_object(
        'rows', (select count(*) from public."Ranking" where "period"='live'),
        'calculatedAt', (select max("calculatedAt") from public."Ranking" where "period"='live'),
        'maxLatestSnapshotAgeSeconds', live_max_age_seconds
      ),
      'weekly', jsonb_build_object(
        'rows', (select count(*) from public."Ranking" where "period"='weekly'),
        'calculatedAt', (select max("calculatedAt") from public."Ranking" where "period"='weekly'),
        'collectionOpportunities', weekly_opportunities,
        'minimumSamplesObserved', weekly_min_samples,
        'minimumCoverageObserved', weekly_min_coverage
      ),
      'monthly', jsonb_build_object(
        'rows', (select count(*) from public."Ranking" where "period"='monthly'),
        'calculatedAt', (select max("calculatedAt") from public."Ranking" where "period"='monthly'),
        'collectionOpportunities', monthly_opportunities,
        'minimumSamplesObserved', monthly_min_samples,
        'minimumCoverageObserved', monthly_min_coverage
      ),
      'yearly', jsonb_build_object(
        'rows', (select count(*) from public."Ranking" where "period"='yearly'),
        'calculatedAt', (select max("calculatedAt") from public."Ranking" where "period"='yearly')
      )
    )
  );

  RETURN result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_rankings_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rankings_audit() TO service_role;
ALTER FUNCTION public.get_rankings_audit() SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.get_historical_recovery_audit(
  p_lookback_days integer DEFAULT 31
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  current_utc_date date := (now() AT TIME ZONE 'UTC')::date;
  oldest_date date;
  recoverable_mismatches bigint := 0;
  raw_days bigint := 0;
  summary_days bigint := 0;
  success_runs bigint := 0;
  partial_runs bigint := 0;
  failed_runs bigint := 0;
  collection_gaps bigint := 0;
  largest_gap_seconds double precision := 0;
  oldest_snapshot timestamptz;
  newest_snapshot timestamptz;
  raw_days_without_summary jsonb := '[]'::jsonb;
  gap_details jsonb := '[]'::jsonb;
BEGIN
  IF p_lookback_days < 1 OR p_lookback_days > 31 THEN
    RAISE EXCEPTION 'p_lookback_days must be between 1 and 31';
  END IF;

  oldest_date := current_utc_date - p_lookback_days;

  WITH source AS (
    SELECT
      s."gameId",
      (s."timestamp" AT TIME ZONE 'UTC')::date AS day,
      AVG(s."playerCount")::double precision AS average_players,
      MAX(s."playerCount") AS peak_players,
      MIN(s."playerCount") AS lowest_players,
      COUNT(*)::integer AS total_samples,
      SUM(s."playerCount")::bigint AS player_sum,
      MIN(s."timestamp") AS oldest_snapshot_at,
      MAX(s."timestamp") AS newest_snapshot_at
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l
      ON l."collectionRunId" = s."collectionRunId"
    WHERE s."timestamp" >= oldest_date::timestamp AT TIME ZONE 'UTC'
      AND s."timestamp" < current_utc_date::timestamp AT TIME ZONE 'UTC'
      AND (
        s."collectionRunId" IS NULL
        OR l."status" IN ('success', 'partial')
      )
    GROUP BY s."gameId", (s."timestamp" AT TIME ZONE 'UTC')::date
  ),
  summary AS (
    SELECT
      d."gameId",
      (d."date" AT TIME ZONE 'UTC')::date AS day,
      d."averagePlayers" AS average_players,
      d."peakPlayers" AS peak_players,
      d."lowestPlayers" AS lowest_players,
      d."totalSamples" AS total_samples,
      d."playerSum" AS player_sum
    FROM public."DailyGameStat" d
    WHERE d."date" >= oldest_date::timestamp AT TIME ZONE 'UTC'
      AND d."date" < current_utc_date::timestamp AT TIME ZONE 'UTC'
  ),
  comparison AS (
    SELECT
      source.day,
      source."gameId",
      source.oldest_snapshot_at,
      source.newest_snapshot_at,
      summary."gameId" AS summary_game_id,
      summary.average_players,
      source.average_players AS source_average_players,
      summary.peak_players,
      source.peak_players AS source_peak_players,
      summary.lowest_players,
      source.lowest_players AS source_lowest_players,
      summary.total_samples,
      source.total_samples AS source_total_samples,
      summary.player_sum,
      source.player_sum AS source_player_sum
    FROM source
    LEFT JOIN summary
      ON summary."gameId" = source."gameId"
     AND summary.day = source.day
  )
  SELECT
    COUNT(*) FILTER (
      WHERE summary_game_id IS NULL
         OR average_players IS DISTINCT FROM source_average_players
         OR peak_players IS DISTINCT FROM source_peak_players
         OR lowest_players IS DISTINCT FROM source_lowest_players
         OR total_samples IS DISTINCT FROM source_total_samples
         OR player_sum IS DISTINCT FROM source_player_sum
    ),
    COUNT(DISTINCT day),
    COALESCE(
      jsonb_agg(day ORDER BY day) FILTER (WHERE summary_game_id IS NULL),
      '[]'::jsonb
    ),
    MIN(oldest_snapshot_at),
    MAX(newest_snapshot_at)
  INTO recoverable_mismatches, raw_days, raw_days_without_summary,
       oldest_snapshot, newest_snapshot
  FROM comparison;

  SELECT COUNT(DISTINCT day)
  INTO summary_days
  FROM summary;

  SELECT
    COUNT(*) FILTER (WHERE "status" = 'success'),
    COUNT(*) FILTER (WHERE "status" = 'partial'),
    COUNT(*) FILTER (WHERE "status" = 'failed')
  INTO success_runs, partial_runs, failed_runs
  FROM public."DataCollectionLog"
  WHERE "status" IN ('success','partial','failed')
    AND "startedAt" >= oldest_date::timestamp AT TIME ZONE 'UTC'
    AND "startedAt" < (current_utc_date + 1)::timestamp AT TIME ZONE 'UTC';

  WITH ordered AS (
    SELECT
      "startedAt",
      LAG("startedAt") OVER (ORDER BY "startedAt") AS previous_started_at
    FROM public."DataCollectionLog"
    WHERE "status" IN ('success','partial','failed')
      AND "startedAt" >= oldest_date::timestamp AT TIME ZONE 'UTC'
      AND "startedAt" < (current_utc_date + 1)::timestamp AT TIME ZONE 'UTC'
  ),
  gaps AS (
    SELECT
      previous_started_at,
      "startedAt",
      EXTRACT(EPOCH FROM ("startedAt" - previous_started_at))::double precision AS gap_seconds
    FROM ordered
    WHERE previous_started_at IS NOT NULL
      AND "startedAt" - previous_started_at > interval '20 minutes'
  )
  SELECT
    COUNT(*),
    COALESCE(MAX(gap_seconds), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'from', previous_started_at,
          'to', "startedAt",
          'gapSeconds', gap_seconds
        )
        ORDER BY gap_seconds DESC, "startedAt" DESC
      ) FILTER (WHERE gap_seconds IS NOT NULL),
      '[]'::jsonb
    )
  INTO collection_gaps, largest_gap_seconds, gap_details
  FROM gaps;

  gap_details := COALESCE(
    (
      SELECT jsonb_agg(item)
      FROM (
        SELECT item
        FROM jsonb_array_elements(gap_details) AS entries(item)
        LIMIT 20
      ) limited
    ),
    '[]'::jsonb
  );

  RETURN jsonb_build_object(
    'status', CASE
      WHEN recoverable_mismatches = 0 THEN 'passed'
      ELSE 'needs_repair'
    END,
    'lookbackDays', p_lookback_days,
    'recoverableDailyRows', recoverable_mismatches,
    'rawDaysObserved', raw_days,
    'dailySummaryDaysObserved', summary_days,
    'rawDaysWithoutSummary', raw_days_without_summary,
    'history', jsonb_build_object(
      'oldestSnapshotAt', oldest_snapshot,
      'newestSnapshotAt', newest_snapshot
    ),
    'collection', jsonb_build_object(
      'expectedCadenceSeconds', 600,
      'gapThresholdSeconds', 1200,
      'successRuns', success_runs,
      'partialRuns', partial_runs,
      'failedRuns', failed_runs,
      'gapsOverThreshold', collection_gaps,
      'largestGapSeconds', largest_gap_seconds,
      'gaps', gap_details
    ),
    'recoveryRule', 'Only days with retained qualifying snapshots are repairable. Days with no qualifying snapshots are left without synthesized statistics.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_historical_recovery_audit(integer) FROM PUBLIC;
