create or replace function public.update_xp_and_level(p_kid_id uuid, p_xp_delta integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_new_xp    integer;
  v_new_level integer := 1;
  v_threshold integer := 0;
  v_thresholds integer[] := array[0,100,250,500,1000];
begin
  update profiles set xp = greatest(0, xp + p_xp_delta)
  where id = p_kid_id returning xp into v_new_xp;

  loop
    if v_new_level <= array_length(v_thresholds,1) then
      v_threshold := v_thresholds[v_new_level];
    else
      v_threshold := round(v_threshold * 1.6 / 50.0) * 50;
    end if;
    exit when v_new_xp < v_threshold;
    v_new_level := v_new_level + 1;
  end loop;

  update profiles set level = greatest(1, v_new_level - 1) where id = p_kid_id;
end;
$$;

create or replace function public.update_streak(p_kid_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_last  date;
  v_today date := current_date;
  v_freeze integer;
begin
  select last_active_date, streak_freeze into v_last, v_freeze
  from profiles where id = p_kid_id;

  if v_last = v_today then return; end if;

  if v_last = v_today - 1 then
    update profiles set streak_days = streak_days + 1, last_active_date = v_today where id = p_kid_id;
  elsif v_last = v_today - 2 and v_freeze > 0 then
    update profiles set streak_freeze = streak_freeze - 1, last_active_date = v_today where id = p_kid_id;
  else
    update profiles set streak_days = 1, last_active_date = v_today where id = p_kid_id;
  end if;

  -- Grant a freeze every 7th day (max 2 stored)
  update profiles set streak_freeze = least(2, streak_freeze + 1)
  where id = p_kid_id and streak_days > 0 and streak_days % 7 = 0;
end;
$$;

create or replace function public.submit_session_result(
  p_session_id uuid,
  p_events     jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_kid_id   uuid;
  v_xp_total integer := 0;
  v_event    jsonb;
begin
  select kid_id into v_kid_id from sessions
  where id = p_session_id and kid_id = auth.uid();
  if not found then raise exception 'session not found or unauthorized'; end if;

  for v_event in select * from jsonb_array_elements(p_events) loop
    insert into review_events(session_id, move_id, rating, latency_ms, used_hint, xp_delta)
    values (
      p_session_id,
      (v_event->>'move_id')::uuid,
      v_event->>'rating',
      (v_event->>'latency_ms')::integer,
      (v_event->>'used_hint')::boolean,
      (v_event->>'xp_delta')::integer
    );

    update reviews set
      due_at         = (v_event->>'due_at')::timestamptz,
      stability      = (v_event->>'stability')::float8,
      difficulty     = (v_event->>'difficulty')::float8,
      elapsed_days   = (v_event->>'elapsed_days')::float8,
      scheduled_days = (v_event->>'scheduled_days')::float8,
      reps           = (v_event->>'reps')::integer,
      lapses         = (v_event->>'lapses')::integer,
      state          = v_event->>'state',
      last_review    = now()
    where kid_id = v_kid_id and move_id = (v_event->>'move_id')::uuid;

    v_xp_total := v_xp_total + (v_event->>'xp_delta')::integer;
  end loop;

  update sessions
  set cards_done = jsonb_array_length(p_events), xp_earned = greatest(0, v_xp_total), ended_at = now()
  where id = p_session_id;

  perform public.update_xp_and_level(v_kid_id, v_xp_total);
  perform public.update_streak(v_kid_id);

  update kid_stats set
    total_reviews = total_reviews + jsonb_array_length(p_events),
    total_correct = total_correct + (
      select count(*) from jsonb_array_elements(p_events) e
      where e->>'rating' != 'again'
    ),
    updated_at = now()
  where kid_id = v_kid_id;
end;
$$;
