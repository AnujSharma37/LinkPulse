-- Bound the range of lp_daily_clicks. Any signed-in user can call it, and an unbounded p_days
-- (e.g. 2000000000) would make Postgres generate billions of rows.
CREATE OR REPLACE FUNCTION public.lp_daily_clicks(p_link_id uuid, p_days int DEFAULT 30, p_tz text DEFAULT 'UTC')
RETURNS TABLE (day date, clicks int)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH d AS (
    SELECT generate_series((now() AT TIME ZONE p_tz)::date - (LEAST(GREATEST(p_days, 1), 366) - 1), (now() AT TIME ZONE p_tz)::date, interval '1 day')::date AS day)
  SELECT d.day, count(e.id)::int
    FROM d LEFT JOIN click_events e ON e.link_id = p_link_id AND (e.clicked_at AT TIME ZONE p_tz)::date = d.day
   GROUP BY d.day ORDER BY d.day;
$$;
