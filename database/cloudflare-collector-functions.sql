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
  PERFORM pg_advisory_xact_lock(hashtextextended('bobaks.refresh_rankings', 0));
  current_day_start := date_trunc('day', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  current_week_start := date_trunc('week', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  next_week_start := current_week_start + interval '7 days';
  current_month_start := date_trunc('month', calculated_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  next_month_start := current_month_start + interval '1 month';
  summary_start_date := ((calculated_at AT TIME ZONE 'UTC')::date - 364);

  CREATE TEMP TABLE old_ranking_snapshot ON COMMIT DROP AS
  SELECT "gameId", "period", "rank" FROM public."Ranking";

  SELECT count(*) INTO active_game_count
  FROM public."Game" WHERE "isActive" = true;

  live_minimum_rows := GREATEST(
    1, CEIL(LEAST(active_game_count, 100)::numeric * 0.50)::bigint
  );

  SELECT count(*) INTO weekly_collection_opportunities
  FROM public."DataCollectionLog"
  WHERE "status" IN ('success','partial')
    AND "startedAt" >= current_week_start
    AND "startedAt" < next_week_start
    AND "startedAt" <= calculated_at;

  SELECT count(*) INTO monthly_collection_opportunities
  FROM public."DataCollectionLog"
  WHERE "status" IN ('success','partial')
    AND "startedAt" >= current_month_start
    AND "startedAt" < next_month_start
    AND "startedAt" <= calculated_at;

  DELETE FROM public."Ranking"
  WHERE "period" IN ('live','weekly','monthly','yearly');

  WITH ranked AS (
    SELECT g."id" AS "gameId", latest."playerCount"::double precision AS score,
      ROW_NUMBER() OVER (ORDER BY latest."playerCount" DESC, g."id" ASC) AS rank
    FROM public."Game" g
    LEFT JOIN LATERAL (
      SELECT s."playerCount", s."timestamp"
      FROM public."GameSnapshot" s
      LEFT JOIN public."DataCollectionLog" l ON l."collectionRunId" = s."collectionRunId"
      WHERE s."gameId" = g."id"
        AND s."timestamp" <= calculated_at
        AND (s."collectionRunId" IS NULL OR l."status" IN ('success','partial'))
      ORDER BY s."timestamp" DESC, s."id" DESC LIMIT 1
    ) latest ON true
    WHERE g."isActive" = true
      AND latest."timestamp" >= calculated_at - interval '15 minutes'
  )
  INSERT INTO public."Ranking"
    ("gameId","period","rank","score","calculatedAt","previousRank")
  SELECT r."gameId",'live',r.rank::integer,r.score,calculated_at,o."rank"
  FROM ranked r
  LEFT JOIN old_ranking_snapshot o ON o."gameId"=r."gameId" AND o."period"='live'
  WHERE r.rank <= 100;

  SELECT count(*) INTO live_candidate_rows
  FROM public."Ranking" WHERE "period"='live';

  IF live_candidate_rows < live_minimum_rows THEN
    RAISE EXCEPTION
      'Ranking refresh aborted: live candidate has % rows, minimum safe rows is % for % active games',
      live_candidate_rows, live_minimum_rows, active_game_count;
  END IF;

  WITH current_period_samples AS MATERIALIZED (
    SELECT s."gameId",
      AVG(s."playerCount") FILTER (
        WHERE COALESCE(l."startedAt",s."timestamp") >= current_week_start
          AND COALESCE(l."startedAt",s."timestamp") < next_week_start
      )::double precision AS weekly_score,
      COUNT(*) FILTER (
        WHERE COALESCE(l."startedAt",s."timestamp") >= current_week_start
          AND COALESCE(l."startedAt",s."timestamp") < next_week_start
      )::bigint AS weekly_sample_count,
      AVG(s."playerCount") FILTER (
        WHERE COALESCE(l."startedAt",s."timestamp") >= current_month_start
          AND COALESCE(l."startedAt",s."timestamp") < next_month_start
      )::double precision AS monthly_score,
      COUNT(*) FILTER (
        WHERE COALESCE(l."startedAt",s."timestamp") >= current_month_start
          AND COALESCE(l."startedAt",s."timestamp") < next_month_start
      )::bigint AS monthly_sample_count
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l ON l."collectionRunId"=s."collectionRunId"
    WHERE COALESCE(l."startedAt",s."timestamp") >= LEAST(current_week_start,current_month_start)
      AND COALESCE(l."startedAt",s."timestamp") <= calculated_at
      AND (s."collectionRunId" IS NULL OR l."status" IN ('success','partial'))
    GROUP BY s."gameId"
  ),
  weekly_ranked AS (
    SELECT g."id" AS "gameId",cps.weekly_score AS score,
      ROW_NUMBER() OVER (ORDER BY cps.weekly_score DESC,g."id" ASC) AS rank
    FROM public."Game" g JOIN current_period_samples cps ON cps."gameId"=g."id"
    WHERE g."isActive"=true AND cps.weekly_sample_count>=12
      AND weekly_collection_opportunities>0
      AND LEAST(cps.weekly_sample_count::numeric/weekly_collection_opportunities::numeric,1.0)>=0.50
  ),
  monthly_ranked AS (
    SELECT g."id" AS "gameId",cps.monthly_score AS score,
      ROW_NUMBER() OVER (ORDER BY cps.monthly_score DESC,g."id" ASC) AS rank
    FROM public."Game" g JOIN current_period_samples cps ON cps."gameId"=g."id"
    WHERE g."isActive"=true AND cps.monthly_sample_count>=12
      AND monthly_collection_opportunities>0
      AND LEAST(cps.monthly_sample_count::numeric/monthly_collection_opportunities::numeric,1.0)>=0.50
  )
  INSERT INTO public."Ranking"
    ("gameId","period","rank","score","calculatedAt","previousRank")
  SELECT wr."gameId",'weekly',wr.rank::integer,wr.score,calculated_at,o."rank"
  FROM weekly_ranked wr
  LEFT JOIN old_ranking_snapshot o ON o."gameId"=wr."gameId" AND o."period"='weekly'
  WHERE wr.rank<=100
  UNION ALL
  SELECT mr."gameId",'monthly',mr.rank::integer,mr.score,calculated_at,o."rank"
  FROM monthly_ranked mr
  LEFT JOIN old_ranking_snapshot o ON o."gameId"=mr."gameId" AND o."period"='monthly'
  WHERE mr.rank<=100;

  WITH yearly_totals AS (
    SELECT "gameId",SUM("playerSum")::numeric AS player_sum,SUM("totalSamples")::bigint AS total_samples
    FROM public."DailyGameStat"
    WHERE "date">=summary_start_date::timestamp AT TIME ZONE 'UTC' AND "date"<current_day_start
    GROUP BY "gameId"
    UNION ALL
    SELECT s."gameId",SUM(s."playerCount")::numeric,COUNT(*)::bigint
    FROM public."GameSnapshot" s
    LEFT JOIN public."DataCollectionLog" l ON l."collectionRunId"=s."collectionRunId"
    WHERE s."timestamp">=current_day_start AND s."timestamp"<=calculated_at
      AND (s."collectionRunId" IS NULL OR l."status" IN ('success','partial'))
    GROUP BY s."gameId"
  ),
  yearly_aggregates AS (
    SELECT "gameId",SUM(player_sum) AS player_sum,SUM(total_samples) AS total_samples
    FROM yearly_totals GROUP BY "gameId"
  ),
  averages AS (
    SELECT "gameId",(player_sum/total_samples)::double precision AS score
    FROM yearly_aggregates WHERE total_samples>0
  ),
  ranked AS (
    SELECT g."id" AS "gameId",averages.score AS score,
      ROW_NUMBER() OVER (ORDER BY averages.score DESC,g."id" ASC) AS rank
    FROM public."Game" g JOIN averages ON averages."gameId"=g."id"
    WHERE g."isActive"=true
  )
  INSERT INTO public."Ranking"
    ("gameId","period","rank","score","calculatedAt","previousRank")
  SELECT r."gameId",'yearly',r.rank::integer,r.score,calculated_at,o."rank"
  FROM ranked r
  LEFT JOIN old_ranking_snapshot o ON o."gameId"=r."gameId" AND o."period"='yearly'
  WHERE r.rank<=100;

  PERFORM public.assert_rankings_integrity();
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_rankings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_rankings() TO service_role;
ALTER FUNCTION public.refresh_rankings() SET search_path = public, pg_temp;
