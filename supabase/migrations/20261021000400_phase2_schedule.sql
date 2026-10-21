-- Scheduled deadline reminders and recurring requirements.
-- The daily job runs at 00:15 Asia/Manila (16:15 UTC).

alter table public.system_settings
  add column if not exists reminder_lead_days integer not null default 1,
  add column if not exists scheduled_reminders boolean not null default true;

alter table public.system_settings
  drop constraint if exists system_settings_lead_days;

alter table public.system_settings
  add constraint system_settings_lead_days check (reminder_lead_days between 0 and 14);

alter table public.reminders
  alter column sender_id drop not null;

alter table public.reminders
  add column if not exists slot_id uuid references public.compliance_slots (id) on delete cascade,
  add column if not exists schedule_kind text not null default 'manual';

alter table public.reminders
  drop constraint if exists reminders_schedule_kind;

alter table public.reminders
  add constraint reminders_schedule_kind check (schedule_kind in ('manual', 'upcoming', 'overdue'));

create unique index if not exists reminders_scheduled_once
  on public.reminders (slot_id, schedule_kind)
  where schedule_kind <> 'manual' and slot_id is not null;

alter table public.requirements
  add column if not exists series_id uuid references public.requirements (id);

alter table public.requirements
  drop constraint if exists requirements_recurrence;

alter table public.requirements
  add constraint requirements_recurrence
  check (recurrence_rule is null or recurrence_rule in ('weekly', 'monthly'));

create index if not exists requirements_series_idx on public.requirements (series_id);


create or replace function public.expand_assignment(p_assignment uuid, p_notify boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asg public.assignments%rowtype;
  v_req public.requirements%rowtype;
  v_teacher uuid;
  v_slot uuid;
  v_count integer := 0;
begin
  select * into v_asg from public.assignments where id = p_assignment;
  if not found then
    raise exception 'Assignment was not found.';
  end if;
  select * into v_req from public.requirements where id = v_asg.requirement_id;
  if auth.uid() is not null and (
    public.app_role() is distinct from 'principal'
    or v_req.school_id is distinct from public.app_school_id()
  ) then
    raise exception 'You do not have permission to do that.';
  end if;

  for v_teacher in
    select candidate.id
    from (
      select p.id
      from public.profiles p
      where v_asg.target_type = 'teacher'
        and p.id = v_asg.teacher_id
        and p.school_id = v_req.school_id
        and p.role = 'teacher'
        and p.is_active
      union
      select p.id
      from public.teacher_assignments ta
      join public.profiles p on p.id = ta.profile_id
      where v_asg.target_type = 'grade_level'
        and ta.school_year_id = v_req.school_year_id
        and ta.grade_level_id = v_asg.grade_level_id
        and p.role = 'teacher'
        and p.is_active
      union
      select p.id
      from public.teacher_assignments ta
      join public.profiles p on p.id = ta.profile_id
      where v_asg.target_type = 'section'
        and ta.school_year_id = v_req.school_year_id
        and ta.section_id = v_asg.section_id
        and p.role = 'teacher'
        and p.is_active
      union
      select p.id
      from public.teacher_assignments ta
      join public.teacher_assignment_subjects tas on tas.teacher_assignment_id = ta.id
      join public.profiles p on p.id = ta.profile_id
      where v_asg.target_type = 'subject'
        and ta.school_year_id = v_req.school_year_id
        and tas.subject_id = v_asg.subject_id
        and p.role = 'teacher'
        and p.is_active
      union
      select p.id
      from public.profiles p
      where v_asg.target_type = 'all_teachers'
        and p.school_id = v_req.school_id
        and p.role = 'teacher'
        and p.is_active
    ) candidate
  loop
    insert into public.compliance_slots (school_id, requirement_id, teacher_id, deadline)
    select v_req.school_id, v_req.id, v_teacher, v_req.deadline
    where not exists (
      select 1 from public.compliance_slots existing
      where existing.requirement_id = v_req.id
        and existing.teacher_id = v_teacher
        and existing.cancelled_at is null
    )
    returning id into v_slot;

    if v_slot is not null then
      v_count := v_count + 1;
      if p_notify and v_req.state = 'active' then
        perform public.notify_user(
          v_teacher,
          'requirement_assigned',
          'New document requirement',
          v_req.title || ' is due ' || to_char(v_req.deadline at time zone 'Asia/Manila', 'YYYY-MM-DD') || '.',
          v_slot
        );
      end if;
    end if;
    v_slot := null;
  end loop;

  return v_count;
end;
$$;


create or replace function public.next_recurrence_date(p_deadline timestamptz, p_rule text)
returns date
language sql
immutable
as $$
  select case p_rule
    when 'weekly' then ((p_deadline at time zone 'Asia/Manila')::date + 7)
    when 'monthly' then (((p_deadline at time zone 'Asia/Manila')::date + interval '1 month')::date)
    else null
  end
$$;


drop function if exists public.create_requirement(text, text, uuid, uuid, uuid, date, text[], integer, integer, uuid[]);

create or replace function public.create_requirement(
  p_title text,
  p_instructions text,
  p_category uuid,
  p_school_year uuid,
  p_grading_period uuid,
  p_deadline date,
  p_extensions text[],
  p_max_files integer,
  p_max_size_mb integer,
  p_reviewer_ids uuid[],
  p_recurrence text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_reviewer uuid;
  v_cap integer;
  v_allowed text[];
  v_recurrence text := nullif(trim(p_recurrence), '');
begin
  perform public.assert_principal();
  if nullif(trim(p_title), '') is null then
    raise exception 'A title is required.';
  end if;
  if p_deadline is null then
    raise exception 'A deadline is required.';
  end if;
  if v_recurrence is not null and v_recurrence not in ('weekly', 'monthly') then
    raise exception 'Choose weekly, monthly, or no repeat.';
  end if;
  select max_file_size_mb, allowed_extensions into v_cap, v_allowed
  from public.system_settings where school_id = public.app_school_id();
  if v_cap is null then
    raise exception 'School file settings are missing.';
  end if;
  if p_extensions is null or cardinality(p_extensions) = 0 or not p_extensions <@ v_allowed then
    raise exception 'Choose at least one allowed file type.';
  end if;
  if p_max_files is null or p_max_files < 1 or p_max_files > 10 then
    raise exception 'File count must be from 1 to 10.';
  end if;
  if p_max_size_mb is null or p_max_size_mb < 1 or p_max_size_mb > v_cap then
    raise exception 'File size cannot exceed the school cap of % MB.', v_cap;
  end if;
  if not exists (
    select 1 from public.document_categories c
    where c.id = p_category and c.school_id = public.app_school_id() and c.is_active
  ) then
    raise exception 'Choose an active document category.';
  end if;
  if not exists (
    select 1 from public.school_years y
    where y.id = p_school_year and y.school_id = public.app_school_id()
  ) then
    raise exception 'Choose a school year.';
  end if;
  if p_grading_period is not null and not exists (
    select 1 from public.grading_periods g
    where g.id = p_grading_period and g.school_year_id = p_school_year
  ) then
    raise exception 'That grading period is not part of the selected school year.';
  end if;

  insert into public.requirements (
    school_id, category_id, school_year_id, grading_period_id, title, instructions,
    deadline, allowed_extensions, max_files, max_size_mb, state, recurrence_rule, created_by
  ) values (
    public.app_school_id(), p_category, p_school_year, p_grading_period, trim(p_title), nullif(trim(p_instructions), ''),
    public.manila_end_of_day(p_deadline), p_extensions, p_max_files, p_max_size_mb, 'draft', v_recurrence, auth.uid()
  ) returning id into v_id;

  update public.requirements set series_id = v_id where id = v_id;

  foreach v_reviewer in array coalesce(p_reviewer_ids, '{}'::uuid[])
  loop
    if not exists (
      select 1
      from public.profiles p
      where p.id = v_reviewer
        and p.school_id = public.app_school_id()
        and p.role = 'principal'
        and p.is_active
    ) then
      raise exception 'An extra reviewer must be an active principal.';
    end if;
    insert into public.requirement_reviewers (requirement_id, profile_id)
    values (v_id, v_reviewer);
  end loop;

  perform public.write_audit(
    'requirement_created',
    'requirement',
    v_id,
    jsonb_build_object('title', trim(p_title), 'recurrence', v_recurrence)
  );
  return v_id;
end;
$$;


create or replace function public.set_requirement_recurrence(p_requirement uuid, p_rule text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule text := nullif(trim(p_rule), '');
begin
  perform public.assert_principal();
  if v_rule is not null and v_rule not in ('weekly', 'monthly') then
    raise exception 'Choose weekly, monthly, or no repeat.';
  end if;
  update public.requirements
    set recurrence_rule = v_rule,
        series_id = coalesce(series_id, id)
  where id = p_requirement
    and school_id = public.app_school_id()
    and state <> 'inactive';
  if not found then
    raise exception 'Requirement was not found.';
  end if;
  perform public.write_audit(
    'requirement_edited',
    'requirement',
    p_requirement,
    jsonb_build_object('field', 'recurrence', 'recurrence', v_rule)
  );
end;
$$;


create or replace function public.dispatch_scheduled_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot record;
  v_kind text;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_due date;
  v_count integer := 0;
  v_body text;
begin
  for v_slot in
    select
      cs.id,
      cs.school_id,
      cs.requirement_id,
      cs.teacher_id,
      cs.workflow_status,
      cs.deadline,
      r.title,
      s.reminder_template,
      s.reminder_lead_days
    from public.compliance_slots cs
    join public.requirements r on r.id = cs.requirement_id
    join public.system_settings s on s.school_id = cs.school_id
    where s.scheduled_reminders
      and r.state = 'active'
      and cs.cancelled_at is null
      and cs.workflow_status <> 'approved'
  loop
    v_due := (v_slot.deadline at time zone 'Asia/Manila')::date;
    if v_slot.deadline < now() then
      v_kind := 'overdue';
    elsif (v_due - v_today) between 0 and v_slot.reminder_lead_days then
      v_kind := 'upcoming';
    else
      continue;
    end if;

    if exists (
      select 1
      from public.reminders existing
      where existing.slot_id = v_slot.id
        and existing.schedule_kind = v_kind
    ) then
      continue;
    end if;

    v_body := coalesce(v_slot.reminder_template, 'This is a reminder to submit the required school document before the deadline.')
      || ' ' || v_slot.title || ' is due ' || to_char(v_slot.deadline at time zone 'Asia/Manila', 'YYYY-MM-DD') || '.';

    insert into public.reminders (school_id, requirement_id, teacher_id, sender_id, slot_status, slot_id, schedule_kind)
    values (v_slot.school_id, v_slot.requirement_id, v_slot.teacher_id, null, v_slot.workflow_status, v_slot.id, v_kind);

    perform public.notify_user(
      v_slot.teacher_id,
      'reminder',
      case when v_kind = 'overdue' then 'Overdue reminder' else 'Deadline reminder' end,
      v_body,
      v_slot.id
    );

    insert into public.audit_logs (school_id, actor_id, action, entity_type, entity_id, details)
    values (
      v_slot.school_id,
      null,
      'reminder_sent',
      'requirement',
      v_slot.requirement_id,
      jsonb_build_object('teacher_id', v_slot.teacher_id, 'slot_id', v_slot.id, 'scheduled', true, 'kind', v_kind)
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


create or replace function public.spawn_recurring_requirements()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.requirements%rowtype;
  v_current public.requirements%rowtype;
  v_new uuid;
  v_next date;
  v_year_end date;
  v_assignment uuid;
  v_slots integer;
  v_count integer := 0;
  v_steps integer;
  v_series uuid;
begin
  for v_source in
    select r.*
    from public.requirements r
    where r.state = 'active'
      and r.recurrence_rule in ('weekly', 'monthly')
      and r.deadline < now()
      and not exists (
        select 1
        from public.requirements later
        where later.series_id = coalesce(r.series_id, r.id)
          and later.id <> r.id
          and later.deadline > r.deadline
      )
  loop
    v_current := v_source;
    v_steps := 0;
    while v_steps < 8 and v_current.deadline < now() loop
      select end_date into v_year_end from public.school_years where id = v_current.school_year_id;
      v_next := public.next_recurrence_date(v_current.deadline, v_current.recurrence_rule);
      exit when v_next is null or v_year_end is null or v_next > v_year_end;

      v_series := coalesce(v_current.series_id, v_current.id);
      update public.requirements set series_id = v_series where id = v_current.id and series_id is null;

      insert into public.requirements (
        school_id, category_id, school_year_id, grading_period_id, title, instructions,
        deadline, allowed_extensions, max_files, max_size_mb, state, recurrence_rule, series_id, created_by
      ) values (
        v_current.school_id, v_current.category_id, v_current.school_year_id, v_current.grading_period_id,
        v_current.title, v_current.instructions, public.manila_end_of_day(v_next), v_current.allowed_extensions,
        v_current.max_files, v_current.max_size_mb, 'active', v_current.recurrence_rule, v_series, v_current.created_by
      ) returning id into v_new;

      insert into public.requirement_reviewers (requirement_id, profile_id)
      select v_new, profile_id from public.requirement_reviewers where requirement_id = v_current.id;

      insert into public.assignments (
        requirement_id, target_type, teacher_id, grade_level_id, section_id, subject_id, created_by
      )
      select v_new, target_type, teacher_id, grade_level_id, section_id, subject_id, created_by
      from public.assignments
      where requirement_id = v_current.id;

      v_slots := 0;
      for v_assignment in select id from public.assignments where requirement_id = v_new
      loop
        v_slots := v_slots + public.expand_assignment(v_assignment, true);
      end loop;

      insert into public.audit_logs (school_id, actor_id, action, entity_type, entity_id, details)
      values (
        v_current.school_id,
        null,
        'requirement_created',
        'requirement',
        v_new,
        jsonb_build_object(
          'title', v_current.title,
          'recurrence', v_current.recurrence_rule,
          'spawned_from', v_current.id,
          'slots', v_slots
        )
      );

      v_count := v_count + 1;
      v_steps := v_steps + 1;
      select * into v_current from public.requirements where id = v_new;
    end loop;
  end loop;

  return v_count;
end;
$$;


create or replace function public.run_daily_schedule()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reminders integer;
  v_spawned integer;
begin
  if auth.uid() is not null and public.app_role() is distinct from 'principal' then
    raise exception 'You do not have permission to do that.';
  end if;
  v_reminders := public.dispatch_scheduled_reminders();
  v_spawned := public.spawn_recurring_requirements();
  return jsonb_build_object('reminders', v_reminders, 'spawned', v_spawned);
end;
$$;


revoke all on function public.next_recurrence_date(timestamptz, text) from public, anon, authenticated;
revoke all on function public.dispatch_scheduled_reminders() from public, anon, authenticated;
revoke all on function public.spawn_recurring_requirements() from public, anon, authenticated;
revoke all on function public.run_daily_schedule() from public, anon;
revoke all on function public.set_requirement_recurrence(uuid, text) from public, anon;
revoke all on function public.create_requirement(text, text, uuid, uuid, uuid, date, text[], integer, integer, uuid[], text) from public, anon;

grant execute on function public.create_requirement(text, text, uuid, uuid, uuid, date, text[], integer, integer, uuid[], text) to authenticated;
grant execute on function public.set_requirement_recurrence(uuid, text) to authenticated;
grant execute on function public.run_daily_schedule() to authenticated;


do $$
begin
  create extension if not exists pg_cron;
exception
  when others then
    raise notice 'pg_cron was not enabled: %', sqlerrm;
end
$$;

do $$
declare
  v_job bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform set_config('search_path', 'public, cron, extensions', true);
    select jobid into v_job from cron.job where jobname = 'schooldocs-daily';
    if v_job is not null then
      perform cron.unschedule(v_job);
    end if;
    perform cron.schedule(
      'schooldocs-daily',
      '15 16 * * *',
      'select public.run_daily_schedule()'
    );
  end if;
exception
  when others then
    raise notice 'The daily schedule was not installed: %', sqlerrm;
end
$$;

notify pgrst, 'reload schema';
