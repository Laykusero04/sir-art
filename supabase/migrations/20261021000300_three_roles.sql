-- The principal keeps review, return, approval, reminders, and school-wide reports.
-- Existing coordinator accounts become inactive principals so their review history stays.

update public.profiles
set role = 'principal',
    is_active = false
where role::text = 'coordinator';


create or replace function public.can_select_slot(p_slot uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.compliance_slots cs
    join public.requirements r on r.id = cs.requirement_id
    where cs.id = p_slot
      and cs.school_id = public.app_school_id()
      and (
        public.app_role() = 'principal'
        or (
          public.app_role() = 'teacher'
          and cs.teacher_id = auth.uid()
          and cs.cancelled_at is null
          and (
            r.state = 'active'
            or exists (
              select 1 from public.submissions s where s.slot_id = cs.id
            )
          )
        )
      )
  );
$$;



create or replace function public.can_select_profile(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_profile
      and (
        p.id = auth.uid()
        or (
          p.school_id = public.app_school_id()
          and (
            public.app_role() in ('administrator', 'principal')
            or (
              public.app_role() = 'teacher'
              and exists (
                select 1
                from public.reviews rv
                join public.compliance_slots cs on cs.id = rv.slot_id
                where rv.reviewer_id = p.id
                  and cs.teacher_id = auth.uid()
              )
            )
          )
        )
      )
  );
$$;



create or replace function public.protect_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if old.school_id is distinct from new.school_id then
    raise exception 'School cannot be changed.';
  end if;
  if new.id = auth.uid() and new.is_active = false then
    raise exception 'You cannot deactivate your own account.';
  end if;
  if public.app_role() = 'administrator' then
    if old.role is distinct from new.role then
      insert into public.audit_logs (school_id, actor_id, action, entity_type, entity_id, details)
      values (new.school_id, auth.uid(), 'role_changed', 'profile', new.id,
        jsonb_build_object('old_role', old.role, 'new_role', new.role));
    end if;
    if old.is_active is distinct from new.is_active then
      insert into public.audit_logs (school_id, actor_id, action, entity_type, entity_id, details)
      values (new.school_id, auth.uid(), 'user_deactivated', 'profile', new.id,
        jsonb_build_object('old_active', old.is_active, 'new_active', new.is_active));
    end if;
    return new;
  end if;
  if new.role is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.employee_number is distinct from old.employee_number
     or new.email is distinct from old.email
     or new.phone is distinct from old.phone
  then
    raise exception 'You do not have permission to do that.';
  end if;
  return new;
end;
$$;



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
  p_reviewer_ids uuid[]
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
begin
  perform public.assert_principal();
  if nullif(trim(p_title), '') is null then
    raise exception 'A title is required.';
  end if;
  if p_deadline is null then
    raise exception 'A deadline is required.';
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
    deadline, allowed_extensions, max_files, max_size_mb, state, created_by
  ) values (
    public.app_school_id(), p_category, p_school_year, p_grading_period, trim(p_title), nullif(trim(p_instructions), ''),
    public.manila_end_of_day(p_deadline), p_extensions, p_max_files, p_max_size_mb, 'draft', auth.uid()
  ) returning id into v_id;

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

  perform public.write_audit('requirement_created', 'requirement', v_id, jsonb_build_object('title', trim(p_title)));
  return v_id;
end;
$$;



create or replace function public.review_slot(
  p_slot uuid,
  p_action public.review_action,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.compliance_slots%rowtype;
  v_req public.requirements%rowtype;
  v_submission uuid;
  v_role text;
begin
  select * into v_slot from public.compliance_slots where id = p_slot and school_id = public.app_school_id() for update;
  if not found or v_slot.cancelled_at is not null then
    raise exception 'That submission was not found.';
  end if;
  select * into v_req from public.requirements where id = v_slot.requirement_id;
  select id into v_submission from public.submissions where slot_id = p_slot order by version desc limit 1;
  v_role := public.app_role()::text;

  if p_action = 'start' then
    if v_slot.workflow_status <> 'submitted' then
      raise exception 'Only a submitted document can be marked under review.';
    end if;
    if v_role is distinct from 'principal' then
      raise exception 'You do not have permission to do that.';
    end if;
    update public.compliance_slots set workflow_status = 'under_review' where id = p_slot;
    insert into public.reviews (slot_id, submission_id, reviewer_id, action, comment)
    values (p_slot, v_submission, auth.uid(), 'start', nullif(trim(p_comment), ''));
    perform public.write_audit('review_started', 'slot', p_slot, jsonb_build_object('version', (select version from public.submissions where id = v_submission)));

  elsif p_action = 'approve' then
    if v_slot.workflow_status not in ('submitted', 'under_review') then
      raise exception 'This document cannot be approved from its current status.';
    end if;
    if v_role is distinct from 'principal' then
      raise exception 'You do not have permission to approve this document.';
    end if;
    update public.compliance_slots
      set workflow_status = 'approved',
          approved_at = now(),
          is_late = is_late or now() > deadline
    where id = p_slot;
    insert into public.reviews (slot_id, submission_id, reviewer_id, action, comment)
    values (p_slot, v_submission, auth.uid(), 'approve', nullif(trim(p_comment), ''));
    perform public.write_audit('approved', 'slot', p_slot, jsonb_build_object('comment', nullif(trim(p_comment), '') is not null));
    perform public.notify_user(v_slot.teacher_id, 'approved', 'Document approved', v_req.title || ' was approved.', p_slot);

  elsif p_action = 'return' then
    if v_slot.workflow_status not in ('submitted', 'under_review') then
      raise exception 'This document cannot be returned from its current status.';
    end if;
    if v_role is distinct from 'principal' then
      raise exception 'You do not have permission to do that.';
    end if;
    if nullif(trim(p_comment), '') is null then
      raise exception 'A comment is required when returning a document.';
    end if;
    update public.compliance_slots set workflow_status = 'needs_revision', approved_at = null where id = p_slot;
    insert into public.reviews (slot_id, submission_id, reviewer_id, action, comment)
    values (p_slot, v_submission, auth.uid(), 'return', trim(p_comment));
    perform public.write_audit('returned', 'slot', p_slot, jsonb_build_object('comment', true));
    perform public.notify_user(v_slot.teacher_id, 'revision_requested', 'Revision requested', v_req.title || ': ' || trim(p_comment), p_slot);

  elsif p_action = 'reopen' then
    if v_role is distinct from 'principal' then
      raise exception 'Only the principal can reopen an approved document.';
    end if;
    if v_slot.workflow_status <> 'approved' then
      raise exception 'Only an approved document can be reopened.';
    end if;
    if nullif(trim(p_comment), '') is null then
      raise exception 'A comment is required to reopen a document.';
    end if;
    update public.compliance_slots
      set workflow_status = 'needs_revision',
          approved_at = null
    where id = p_slot;
    insert into public.reviews (slot_id, submission_id, reviewer_id, action, comment)
    values (p_slot, v_submission, auth.uid(), 'reopen', trim(p_comment));
    perform public.write_audit('reopened', 'slot', p_slot, jsonb_build_object('comment', true));
    perform public.notify_user(v_slot.teacher_id, 'revision_requested', 'Document reopened', v_req.title || ': ' || trim(p_comment), p_slot);
  else
    raise exception 'Unknown review action.';
  end if;
end;
$$;



create or replace function public.send_reminder(p_requirement uuid, p_teacher_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.requirements%rowtype;
  v_slot record;
  v_count integer := 0;
  v_template text;
begin
  perform public.assert_principal();
  select * into v_req from public.requirements where id = p_requirement and school_id = public.app_school_id();
  if not found or v_req.state is distinct from 'active' then
    raise exception 'Requirement was not found.';
  end if;

  select reminder_template into v_template from public.system_settings where school_id = public.app_school_id();

  for v_slot in
    select cs.id, cs.teacher_id, cs.workflow_status, cs.deadline
    from public.compliance_slots cs
    where cs.requirement_id = p_requirement
      and cs.cancelled_at is null
      and (
        cs.workflow_status = 'not_submitted'
        or (cs.workflow_status <> 'approved' and cs.deadline < now())
      )
      and (p_teacher_ids is null or cardinality(p_teacher_ids) = 0 or cs.teacher_id = any (p_teacher_ids))
  loop
    insert into public.reminders (school_id, requirement_id, teacher_id, sender_id, slot_status)
    values (v_req.school_id, p_requirement, v_slot.teacher_id, auth.uid(), v_slot.workflow_status);
    perform public.notify_user(
      v_slot.teacher_id,
      'reminder',
      'Submission reminder',
      coalesce(v_template, 'Please submit ') || ' ' || v_req.title,
      v_slot.id
    );
    perform public.write_audit('reminder_sent', 'requirement', p_requirement, jsonb_build_object('teacher_id', v_slot.teacher_id));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;



create or replace function public.report_dataset(
  p_type text,
  p_school_year uuid,
  p_grading_period uuid,
  p_category uuid,
  p_grade_level uuid,
  p_teacher uuid,
  p_status text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_header jsonb;
  v_title text;
  v_columns jsonb;
  v_rows jsonb;
  v_summary jsonb;
  v_year text;
  v_period text;
begin
  if public.app_role() is distinct from 'principal' then
    raise exception 'You do not have permission to do that.';
  end if;

  select coalesce(y.label, 'All school years') into v_year
  from public.school_years y
  where y.id = p_school_year;
  if p_school_year is null then
    v_year := 'All school years';
  end if;
  select coalesce(g.name, 'All grading periods') into v_period
  from public.grading_periods g
  where g.id = p_grading_period;
  if p_grading_period is null then
    v_period := 'All grading periods';
  end if;

  v_header := jsonb_build_object(
    'school', (select name from public.schools where id = public.app_school_id()),
    'year', v_year,
    'period', v_period,
    'generated_at', to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI'),
    'generated_by', (select full_name from public.profiles where id = auth.uid()),
    'scope', 'Whole school'
  );

  if p_type = 'school_wide' then
    v_title := 'School-wide compliance';
    v_columns := jsonb_build_array('Metric', 'Value');
    v_summary := public.compliance_summary(p_school_year, p_grading_period, p_category, p_grade_level, p_teacher, p_status);
    v_rows := jsonb_build_array(
      jsonb_build_array('Total required', v_summary->>'total_required'),
      jsonb_build_array('Approved', v_summary->>'approved'),
      jsonb_build_array('Pending submission', v_summary->>'pending_submission'),
      jsonb_build_array('Awaiting review', v_summary->>'awaiting_review'),
      jsonb_build_array('Needs revision', v_summary->>'needs_revision'),
      jsonb_build_array('Overdue', v_summary->>'overdue'),
      jsonb_build_array('Missing', v_summary->>'missing'),
      jsonb_build_array('Submission rate', public.rate_text((v_summary->>'with_submission')::integer, (v_summary->>'total_required')::integer)),
      jsonb_build_array('Approval rate', public.rate_text((v_summary->>'approved')::integer, (v_summary->>'total_required')::integer)),
      jsonb_build_array('On-time approval rate', public.rate_text((v_summary->>'approved_on_time')::integer, (v_summary->>'total_required')::integer))
    );
  elsif p_type = 'teacher' then
    v_title := 'Teacher compliance';
    v_columns := jsonb_build_array('Teacher', 'Grade level', 'Total', 'Approved', 'Pending submission', 'Awaiting review', 'Needs revision', 'Overdue', 'Submission rate', 'Approval rate', 'On-time approval rate');
    select coalesce(jsonb_agg(jsonb_build_array(
      teacher_name,
      coalesce(grade_level_name, 'Unassigned'),
      total_required::text,
      approved::text,
      pending_submission::text,
      awaiting_review::text,
      needs_revision::text,
      overdue::text,
      public.rate_text(with_submission, total_required),
      public.rate_text(approved, total_required),
      public.rate_text(approved_on_time, total_required)
    ) order by teacher_name), '[]'::jsonb)
    into v_rows
    from (
      select
        teacher_name,
        grade_level_name,
        count(*)::integer as total_required,
        count(*) filter (where workflow_status = 'approved')::integer as approved,
        count(*) filter (where workflow_status in ('not_submitted', 'needs_revision') and deadline > now())::integer as pending_submission,
        count(*) filter (where workflow_status in ('submitted', 'under_review'))::integer as awaiting_review,
        count(*) filter (where workflow_status = 'needs_revision')::integer as needs_revision,
        count(*) filter (where workflow_status <> 'approved' and deadline < now())::integer as overdue,
        count(*) filter (where has_submission)::integer as with_submission,
        count(*) filter (where workflow_status = 'approved' and not is_late)::integer as approved_on_time
      from public.filtered_slots(p_school_year, p_grading_period, p_category, p_grade_level, p_teacher, p_status)
      group by teacher_id, teacher_name, grade_level_name
    ) grouped;
  elsif p_type = 'grade_level' then
    v_title := 'Grade-level compliance';
    v_columns := jsonb_build_array('Grade level', 'Total', 'Approved', 'Pending submission', 'Awaiting review', 'Needs revision', 'Overdue', 'Submission rate', 'Approval rate', 'On-time approval rate');
    select coalesce(jsonb_agg(jsonb_build_array(
      grade_name,
      total_required::text,
      approved::text,
      pending_submission::text,
      awaiting_review::text,
      needs_revision::text,
      overdue::text,
      public.rate_text(with_submission, total_required),
      public.rate_text(approved, total_required),
      public.rate_text(approved_on_time, total_required)
    ) order by grade_name), '[]'::jsonb)
    into v_rows
    from (
      select
        coalesce(grade_level_name, 'Unassigned') as grade_name,
        count(*)::integer as total_required,
        count(*) filter (where workflow_status = 'approved')::integer as approved,
        count(*) filter (where workflow_status in ('not_submitted', 'needs_revision') and deadline > now())::integer as pending_submission,
        count(*) filter (where workflow_status in ('submitted', 'under_review'))::integer as awaiting_review,
        count(*) filter (where workflow_status = 'needs_revision')::integer as needs_revision,
        count(*) filter (where workflow_status <> 'approved' and deadline < now())::integer as overdue,
        count(*) filter (where has_submission)::integer as with_submission,
        count(*) filter (where workflow_status = 'approved' and not is_late)::integer as approved_on_time
      from public.filtered_slots(p_school_year, p_grading_period, p_category, p_grade_level, p_teacher, p_status)
      group by grade_level_name
    ) grouped;
  elsif p_type = 'missing' then
    v_title := 'Missing documents';
    v_columns := jsonb_build_array('Teacher', 'Grade level', 'Requirement', 'Category', 'Deadline');
    select coalesce(jsonb_agg(jsonb_build_array(
      teacher_name, coalesce(grade_level_name, 'Unassigned'), requirement_title, category_name,
      to_char(deadline at time zone 'Asia/Manila', 'YYYY-MM-DD')
    ) order by teacher_name, requirement_title), '[]'::jsonb)
    into v_rows
    from public.filtered_slots(p_school_year, p_grading_period, p_category, p_grade_level, p_teacher, p_status)
    where workflow_status = 'not_submitted';
  elsif p_type = 'overdue' then
    v_title := 'Overdue documents';
    v_columns := jsonb_build_array('Teacher', 'Grade level', 'Requirement', 'Category', 'Status', 'Deadline');
    select coalesce(jsonb_agg(jsonb_build_array(
      teacher_name, coalesce(grade_level_name, 'Unassigned'), requirement_title, category_name,
      replace(initcap(replace(workflow_status::text, '_', ' ')), 'Needs Revision', 'Needs revision'),
      to_char(deadline at time zone 'Asia/Manila', 'YYYY-MM-DD')
    ) order by deadline, teacher_name), '[]'::jsonb)
    into v_rows
    from public.filtered_slots(p_school_year, p_grading_period, p_category, p_grade_level, p_teacher, p_status)
    where workflow_status <> 'approved' and deadline < now();
  elsif p_type = 'revision' then
    v_title := 'Document revision';
    v_columns := jsonb_build_array('Teacher', 'Requirement', 'Version count', 'Deadline');
    select coalesce(jsonb_agg(jsonb_build_array(
      teacher_name, requirement_title, version_count::text,
      to_char(deadline at time zone 'Asia/Manila', 'YYYY-MM-DD')
    ) order by teacher_name), '[]'::jsonb)
    into v_rows
    from public.filtered_slots(p_school_year, p_grading_period, p_category, p_grade_level, p_teacher, p_status)
    where workflow_status = 'needs_revision';
  elsif p_type = 'history' then
    v_title := 'Submission history';
    v_columns := jsonb_build_array('Teacher', 'Requirement', 'Version', 'Submitted at', 'Late', 'Decision', 'Reviewer', 'Decided at');
    select coalesce(jsonb_agg(jsonb_build_array(
      s.teacher_name,
      s.requirement_title,
      sub.version::text,
      to_char(sub.submitted_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI'),
      case when sub.submitted_late then 'Yes' else 'No' end,
      coalesce(initcap(replace(dec.action::text, '_', ' ')), ''),
      coalesce(reviewer.full_name, ''),
      coalesce(to_char(dec.created_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI'), '')
    ) order by sub.submitted_at), '[]'::jsonb)
    into v_rows
    from public.filtered_slots(p_school_year, p_grading_period, p_category, p_grade_level, p_teacher, p_status) s
    join public.submissions sub on sub.slot_id = s.id
    left join lateral (
      select rv.action, rv.created_at, rv.reviewer_id
      from public.reviews rv
      where rv.submission_id = sub.id
        and rv.action in ('approve', 'return', 'reopen')
      order by rv.created_at desc
      limit 1
    ) dec on true
    left join public.profiles reviewer on reviewer.id = dec.reviewer_id;
  else
    raise exception 'Unknown report.';
  end if;

  return jsonb_build_object('title', v_title, 'header', v_header, 'columns', v_columns, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;


drop policy if exists placement_select on public.teacher_assignments;
create policy placement_select on public.teacher_assignments
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = teacher_assignments.profile_id
        and p.school_id = public.app_school_id()
        and (
          public.app_role() in ('administrator', 'principal')
          or p.id = auth.uid()
        )
    )
  );

drop policy if exists requirements_select on public.requirements;
create policy requirements_select on public.requirements
  for select to authenticated
  using (
    school_id = public.app_school_id()
    and (
      public.app_role() = 'principal'
      or (
        state <> 'draft'
        and exists (
          select 1 from public.compliance_slots cs
          where cs.requirement_id = requirements.id
            and public.app_role() = 'teacher'
            and cs.teacher_id = auth.uid()
        )
      )
    )
  );

drop policy if exists school_documents_read on storage.objects;
create policy school_documents_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'school-documents'
    and (
      (
        public.app_role() = 'principal'
        and (storage.foldername(name))[1] = public.app_school_id()::text
      )
      or (
        public.app_role() = 'teacher'
        and (storage.foldername(name))[4] = auth.uid()::text
      )
    )
  );

drop trigger if exists profiles_after_insert on public.profiles;
drop function if exists public.profile_after_insert();
drop table if exists public.coordinator_scopes cascade;
drop table if exists public.coordinator_grants cascade;
drop function if exists public.audit_coordinator_change() cascade;
drop function if exists public.coordinator_can_read_object(text) cascade;
drop function if exists public.coordinator_can_approve_slot(uuid) cascade;
drop function if exists public.coordinator_can_review_slot(uuid) cascade;
drop function if exists public.coordinator_can_see_teacher(uuid) cascade;
drop function if exists public.coordinator_can_see_slot(uuid) cascade;

alter table public.profiles
  drop constraint if exists profiles_three_roles;
alter table public.profiles
  add constraint profiles_three_roles
  check (role::text in ('administrator', 'principal', 'teacher'));

do $roles$
begin
  create type public.user_role_new as enum ('administrator', 'principal', 'teacher');
  alter table public.profiles
    alter column role type public.user_role_new
    using role::text::public.user_role_new;

  drop function public.app_role();

create or replace function public.app_role()
returns public.user_role_new
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;


drop function public.create_announcement(text, text, public.user_role, uuid[]);

create or replace function public.create_announcement(
  p_title text,
  p_body text,
  p_role public.user_role_new,
  p_user_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_user uuid;
begin
  perform public.assert_principal();
  if nullif(trim(p_title), '') is null or nullif(trim(p_body), '') is null then
    raise exception 'An announcement needs a title and a message.';
  end if;
  if p_role is null and coalesce(cardinality(p_user_ids), 0) = 0 then
    raise exception 'Choose a role or at least one person.';
  end if;
  insert into public.announcements (school_id, title, body, created_by)
  values (public.app_school_id(), trim(p_title), trim(p_body), auth.uid())
  returning id into v_id;

  for v_user in
    select id from public.profiles
    where school_id = public.app_school_id()
      and is_active
      and (p_role is null or role = p_role)
      and (coalesce(cardinality(p_user_ids), 0) = 0 or id = any (p_user_ids))
  loop
    perform public.notify_user(v_user, 'announcement', trim(p_title), trim(p_body), null);
  end loop;
  return v_id;
end;
$$;


  alter type public.user_role rename to user_role_old;
  alter type public.user_role_new rename to user_role;
  drop type public.user_role_old;
exception
  when others then
    raise notice 'Coordinator label stays unused because the role type is still referenced: %', sqlerrm;
end
$roles$;

grant execute on function public.app_role() to authenticated;
grant execute on function public.create_announcement(text, text, public.user_role, uuid[]) to authenticated;
grant execute on function public.can_select_slot(uuid) to authenticated;
grant execute on function public.can_select_profile(uuid) to authenticated;
