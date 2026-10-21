-- SchoolDocs PH phase 1 workflow functions, reports, and grants.

create or replace function public.write_audit(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (school_id, actor_id, action, entity_type, entity_id, details)
  values (public.app_school_id(), auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
end;
$$;

create or replace function public.notify_user(
  p_user uuid,
  p_type text,
  p_title text,
  p_body text,
  p_slot uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school uuid;
begin
  select school_id into v_school from public.profiles where id = p_user;
  if v_school is null then
    return;
  end if;
  insert into public.notifications (school_id, user_id, type, title, body, slot_id)
  values (v_school, p_user, p_type, p_title, p_body, p_slot);
end;
$$;

create or replace function public.assert_principal()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.app_role() is distinct from 'principal' then
    raise exception 'You do not have permission to do that.';
  end if;
end;
$$;

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
  if public.app_role() is distinct from 'principal' or v_req.school_id is distinct from public.app_school_id() then
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

create or replace function public.add_assignment(
  p_requirement uuid,
  p_target public.assignment_target,
  p_teacher uuid,
  p_grade_level uuid,
  p_section uuid,
  p_subject uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.requirements%rowtype;
  v_id uuid;
begin
  perform public.assert_principal();
  select * into v_req from public.requirements where id = p_requirement and school_id = public.app_school_id();
  if not found then
    raise exception 'Requirement was not found.';
  end if;
  if v_req.state = 'inactive' then
    raise exception 'Inactive requirements cannot receive new assignments.';
  end if;
  if p_target = 'teacher' and p_teacher is null then
    raise exception 'Choose a teacher.';
  elsif p_target = 'grade_level' and p_grade_level is null then
    raise exception 'Choose a grade level.';
  elsif p_target = 'section' and p_section is null then
    raise exception 'Choose a section.';
  elsif p_target = 'subject' and p_subject is null then
    raise exception 'Choose a subject.';
  end if;

  insert into public.assignments (
    requirement_id, target_type, teacher_id, grade_level_id, section_id, subject_id, created_by
  ) values (
    p_requirement, p_target, p_teacher, p_grade_level, p_section, p_subject, auth.uid()
  ) returning id into v_id;

  perform public.expand_assignment(v_id, true);
  return v_id;
end;
$$;

create or replace function public.activate_requirement(p_requirement uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.requirements%rowtype;
  v_assignment uuid;
  v_slot record;
  v_count integer;
begin
  perform public.assert_principal();
  select * into v_req from public.requirements where id = p_requirement and school_id = public.app_school_id();
  if not found then
    raise exception 'Requirement was not found.';
  end if;
  if nullif(trim(v_req.title), '') is null or v_req.deadline is null then
    raise exception 'Title and deadline are required before activation.';
  end if;
  if not exists (select 1 from public.assignments a where a.requirement_id = p_requirement) then
    raise exception 'Add at least one assignment that includes a teacher before activating.';
  end if;

  for v_assignment in select id from public.assignments where requirement_id = p_requirement
  loop
    perform public.expand_assignment(v_assignment, false);
  end loop;

  select count(*) into v_count
  from public.compliance_slots
  where requirement_id = p_requirement and cancelled_at is null;
  if v_count < 1 then
    raise exception 'Add at least one assignment that includes a teacher before activating.';
  end if;

  update public.requirements set state = 'active' where id = p_requirement;

  for v_slot in
    select id, teacher_id from public.compliance_slots
    where requirement_id = p_requirement and cancelled_at is null
  loop
    perform public.notify_user(
      v_slot.teacher_id,
      'requirement_assigned',
      'New document requirement',
      v_req.title || ' is due ' || to_char(v_req.deadline at time zone 'Asia/Manila', 'YYYY-MM-DD') || '.',
      v_slot.id
    );
  end loop;

  perform public.write_audit('requirement_activated', 'requirement', p_requirement, jsonb_build_object('slots', v_count));
  return v_count;
end;
$$;

create or replace function public.update_requirement(
  p_requirement uuid,
  p_instructions text,
  p_deadline date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.requirements%rowtype;
  v_deadline timestamptz;
  v_updated integer := 0;
  v_slot record;
begin
  perform public.assert_principal();
  select * into v_req from public.requirements where id = p_requirement and school_id = public.app_school_id();
  if not found then
    raise exception 'Requirement was not found.';
  end if;
  if v_req.state = 'inactive' then
    raise exception 'Inactive requirements cannot be edited.';
  end if;

  if p_instructions is not null and nullif(trim(p_instructions), '') is distinct from coalesce(v_req.instructions, '') then
    update public.requirements set instructions = nullif(trim(p_instructions), '') where id = p_requirement;
    perform public.write_audit('requirement_edited', 'requirement', p_requirement, jsonb_build_object('field', 'instructions'));
  end if;

  if p_deadline is not null then
    v_deadline := public.manila_end_of_day(p_deadline);
    if v_deadline is distinct from v_req.deadline then
      update public.requirements set deadline = v_deadline where id = p_requirement;
      update public.compliance_slots
        set deadline = v_deadline
      where requirement_id = p_requirement
        and workflow_status <> 'approved'
        and cancelled_at is null;
      get diagnostics v_updated = row_count;
      for v_slot in
        select id, teacher_id from public.compliance_slots
        where requirement_id = p_requirement
          and workflow_status <> 'approved'
          and cancelled_at is null
      loop
        perform public.notify_user(
          v_slot.teacher_id,
          'deadline_changed',
          'Deadline changed',
          v_req.title || ' is now due ' || to_char(v_deadline at time zone 'Asia/Manila', 'YYYY-MM-DD') || '.',
          v_slot.id
        );
      end loop;
      perform public.write_audit(
        'deadline_changed',
        'requirement',
        p_requirement,
        jsonb_build_object('old_deadline', v_req.deadline, 'new_deadline', v_deadline, 'slots_updated', v_updated)
      );
    end if;
  end if;
end;
$$;

create or replace function public.deactivate_requirement(p_requirement uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_principal();
  update public.requirements
    set state = 'inactive'
  where id = p_requirement
    and school_id = public.app_school_id()
    and state <> 'inactive';
  if not found then
    raise exception 'Requirement was not found.';
  end if;
  perform public.write_audit('requirement_deactivated', 'requirement', p_requirement, '{}'::jsonb);
end;
$$;

create or replace function public.cancel_slot(p_slot uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_principal();
  if nullif(trim(p_reason), '') is null then
    raise exception 'A reason is required to cancel a slot.';
  end if;
  update public.compliance_slots
    set cancelled_at = now(),
        cancel_reason = trim(p_reason)
  where id = p_slot
    and school_id = public.app_school_id()
    and cancelled_at is null;
  if not found then
    raise exception 'Slot was not found.';
  end if;
  perform public.write_audit('slot_cancelled', 'slot', p_slot, jsonb_build_object('reason', trim(p_reason)));
end;
$$;

create or replace function public.register_submission(
  p_slot uuid,
  p_files jsonb,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.compliance_slots%rowtype;
  v_req public.requirements%rowtype;
  v_settings public.system_settings%rowtype;
  v_latest public.submissions%rowtype;
  v_submission uuid;
  v_version integer;
  v_file jsonb;
  v_path text;
  v_name text;
  v_ext text;
  v_size bigint;
  v_prefix text;
  v_late boolean;
  v_action text;
  v_previous text[];
  v_reviewer uuid;
begin
  select * into v_slot from public.compliance_slots where id = p_slot for update;
  if not found or v_slot.teacher_id is distinct from auth.uid() or v_slot.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'message', 'That requirement was not found.');
  end if;
  select * into v_req from public.requirements where id = v_slot.requirement_id;
  if v_req.state is distinct from 'active' then
    return jsonb_build_object('ok', false, 'message', 'This requirement is not open for submission.');
  end if;
  select * into v_settings from public.system_settings where school_id = v_slot.school_id;

  if v_slot.workflow_status not in ('not_submitted', 'submitted', 'needs_revision') then
    return jsonb_build_object('ok', false, 'message', 'This document cannot be changed right now.');
  end if;

  select * into v_latest
  from public.submissions
  where slot_id = p_slot
  order by version desc
  limit 1;

  if v_slot.workflow_status = 'submitted' and exists (
    select 1 from public.reviews rv
    where rv.submission_id = v_latest.id and rv.action = 'start'
  ) then
    return jsonb_build_object('ok', false, 'message', 'A reviewer has already started checking this file.');
  end if;

  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) < 1 then
    return jsonb_build_object('ok', false, 'message', 'Choose a file to upload.');
  end if;
  if jsonb_array_length(p_files) > v_req.max_files then
    return jsonb_build_object('ok', false, 'message', 'Too many files for this requirement.');
  end if;

  v_prefix := v_req.school_id::text || '/' || v_req.school_year_id::text || '/' || v_req.id::text || '/' || v_slot.teacher_id::text || '/';

  for v_file in select value from jsonb_array_elements(p_files)
  loop
    v_path := v_file->>'path';
    v_name := coalesce(v_file->>'name', v_path);
    v_ext := lower(regexp_replace(v_name, '^.*\.', ''));
    if v_path is null or v_path not like v_prefix || '%' or position('..' in v_path) > 0 then
      return jsonb_build_object('ok', false, 'message', 'The uploaded file is in the wrong place.');
    end if;
    if not (v_ext = any (v_req.allowed_extensions) and v_ext = any (v_settings.allowed_extensions)) then
      delete from storage.objects where bucket_id = 'school-documents' and name = v_path;
      return jsonb_build_object('ok', false, 'message', 'This file type is not allowed for this requirement.');
    end if;
    select nullif(metadata->>'size', '')::bigint into v_size
    from storage.objects
    where bucket_id = 'school-documents' and name = v_path;
    if not found then
      return jsonb_build_object('ok', false, 'message', 'Uploaded file was not found.');
    end if;
    if v_size is not null and v_size > least(v_req.max_size_mb, v_settings.max_file_size_mb) * 1024 * 1024 then
      delete from storage.objects where bucket_id = 'school-documents' and name = v_path;
      return jsonb_build_object('ok', false, 'message', 'The file is larger than the allowed size.');
    end if;
  end loop;

  v_late := now() > v_slot.deadline;

  if v_slot.workflow_status = 'submitted' then
    v_action := 'replace';
    v_version := v_latest.version;
    select coalesce(array_agg(storage_path), '{}') into v_previous
    from public.submission_files where submission_id = v_latest.id;
    delete from storage.objects
    where bucket_id = 'school-documents'
      and name in (select storage_path from public.submission_files where submission_id = v_latest.id);
    delete from public.submission_files where submission_id = v_latest.id;
    update public.submissions
      set notes = nullif(trim(p_notes), ''),
          submitted_at = now(),
          submitted_late = v_late
    where id = v_latest.id;
    v_submission := v_latest.id;
  else
    v_action := case when v_slot.workflow_status = 'needs_revision' then 'resubmit' else 'upload' end;
    v_version := coalesce(v_latest.version, 0) + 1;
    insert into public.submissions (slot_id, version, notes, submitted_at, submitted_late)
    values (p_slot, v_version, nullif(trim(p_notes), ''), now(), v_late)
    returning id into v_submission;
  end if;

  insert into public.submission_files (submission_id, storage_path, original_filename)
  select v_submission, value->>'path', coalesce(value->>'name', value->>'path')
  from jsonb_array_elements(p_files);

  update public.compliance_slots
    set workflow_status = 'submitted',
        is_late = is_late or v_late
  where id = p_slot;

  perform public.write_audit(
    v_action,
    'slot',
    p_slot,
    jsonb_build_object('version', v_version, 'late', v_late, 'previous_paths', coalesce(v_previous, '{}'::text[]))
  );

  perform public.notify_user(v_slot.teacher_id, 'submitted', 'Document submitted', v_req.title || ' was received.', p_slot);
  for v_reviewer in
    select id from public.profiles where school_id = v_slot.school_id and role = 'principal' and is_active
    union
    select profile_id from public.requirement_reviewers where requirement_id = v_req.id
  loop
    perform public.notify_user(v_reviewer, 'submission_received', 'Document ready for review', v_req.title || ' was submitted.', p_slot);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'version', v_version,
    'submitted_at', now(),
    'is_late', (select is_late from public.compliance_slots where id = p_slot)
  );
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

create or replace function public.create_announcement(
  p_title text,
  p_body text,
  p_role public.user_role,
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

create or replace function public.filtered_slots(
  p_school_year uuid,
  p_grading_period uuid,
  p_category uuid,
  p_grade_level uuid,
  p_teacher uuid,
  p_status text
)
returns setof public.slot_overview
language sql
stable
security invoker
set search_path = public
as $$
  select *
  from public.slot_overview
  where counts_toward_compliance
    and (p_school_year is null or school_year_id = p_school_year)
    and (p_grading_period is null or grading_period_id = p_grading_period)
    and (p_category is null or category_id = p_category)
    and (p_grade_level is null or grade_level_id = p_grade_level)
    and (p_teacher is null or teacher_id = p_teacher)
    and (
      p_status is null
      or p_status = ''
      or (p_status = 'overdue' and is_overdue)
      or (p_status = 'missing' and workflow_status = 'not_submitted')
      or (p_status = 'due_today' and is_due_today)
      or workflow_status::text = p_status
    );
$$;

create or replace function public.rate_text(p_part integer, p_total integer)
returns text
language sql
immutable
as $$
  select case
    when p_total = 0 then '0 (0%)'
    else p_part::text || ' (' || round(100.0 * p_part / p_total, 1)::text || '%)'
  end
$$;

create or replace function public.compliance_summary(
  p_school_year uuid,
  p_grading_period uuid,
  p_category uuid,
  p_grade_level uuid,
  p_teacher uuid,
  p_status text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_total integer;
  v_approved integer;
  v_pending integer;
  v_waiting integer;
  v_revision integer;
  v_overdue integer;
  v_missing integer;
  v_submitted integer;
  v_on_time integer;
  v_teachers jsonb;
  v_grades jsonb;
begin
  select
    count(*)::integer,
    count(*) filter (where workflow_status = 'approved')::integer,
    count(*) filter (where workflow_status in ('not_submitted', 'needs_revision') and deadline > now())::integer,
    count(*) filter (where workflow_status in ('submitted', 'under_review'))::integer,
    count(*) filter (where workflow_status = 'needs_revision')::integer,
    count(*) filter (where workflow_status <> 'approved' and deadline < now())::integer,
    count(*) filter (where workflow_status = 'not_submitted')::integer,
    count(*) filter (where has_submission)::integer,
    count(*) filter (where workflow_status = 'approved' and is_late = false)::integer
  into v_total, v_approved, v_pending, v_waiting, v_revision, v_overdue, v_missing, v_submitted, v_on_time
  from public.filtered_slots(p_school_year, p_grading_period, p_category, p_grade_level, p_teacher, p_status);

  select coalesce(jsonb_agg(to_jsonb(row) order by row.teacher_name), '[]'::jsonb)
    into v_teachers
  from (
    select
      teacher_id,
      teacher_name,
      coalesce(grade_level_name, 'Unassigned') as grade_level_name,
      count(*)::integer as total_required,
      count(*) filter (where workflow_status = 'approved')::integer as approved,
      count(*) filter (where workflow_status in ('not_submitted', 'needs_revision') and deadline > now())::integer as pending_submission,
      count(*) filter (where workflow_status in ('submitted', 'under_review'))::integer as awaiting_review,
      count(*) filter (where workflow_status = 'needs_revision')::integer as needs_revision,
      count(*) filter (where workflow_status <> 'approved' and deadline < now())::integer as overdue
    from public.filtered_slots(p_school_year, p_grading_period, p_category, p_grade_level, p_teacher, p_status)
    group by teacher_id, teacher_name, grade_level_name
  ) row;

  select coalesce(jsonb_agg(to_jsonb(row) order by row.grade_level_name), '[]'::jsonb)
    into v_grades
  from (
    select
      coalesce(grade_level_name, 'Unassigned') as grade_level_name,
      count(*)::integer as total_required,
      count(*) filter (where workflow_status = 'approved')::integer as approved,
      count(*) filter (where workflow_status <> 'approved' and deadline < now())::integer as overdue
    from public.filtered_slots(p_school_year, p_grading_period, p_category, p_grade_level, p_teacher, p_status)
    group by grade_level_name
  ) row;

  return jsonb_build_object(
    'total_required', v_total,
    'approved', v_approved,
    'pending_submission', v_pending,
    'awaiting_review', v_waiting,
    'needs_revision', v_revision,
    'overdue', v_overdue,
    'missing', v_missing,
    'with_submission', v_submitted,
    'approved_on_time', v_on_time,
    'submission_rate', case when v_total = 0 then 0 else round(100.0 * v_submitted / v_total, 1) end,
    'approval_rate', case when v_total = 0 then 0 else round(100.0 * v_approved / v_total, 1) end,
    'on_time_approval_rate', case when v_total = 0 then 0 else round(100.0 * v_on_time / v_total, 1) end,
    'by_teacher', v_teachers,
    'by_grade', v_grades
  );
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

revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on
  public.schools, public.profiles, public.school_years, public.grading_periods,
  public.grade_levels, public.subjects, public.sections, public.teacher_assignments,
  public.teacher_assignment_subjects,
  public.document_categories, public.system_settings, public.requirements,
  public.requirement_reviewers, public.assignments, public.compliance_slots,
  public.submissions, public.submission_files, public.reviews, public.notifications,
  public.announcements, public.reminders, public.audit_logs, public.slot_overview
to authenticated;

grant update on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant insert, update, delete on public.school_years to authenticated;
grant insert, update, delete on public.grading_periods to authenticated;
grant insert, update, delete on public.grade_levels to authenticated;
grant insert, update, delete on public.subjects to authenticated;
grant insert, update, delete on public.sections to authenticated;
grant insert, update, delete on public.teacher_assignments to authenticated;
grant insert, update, delete on public.teacher_assignment_subjects to authenticated;
grant insert, update, delete on public.document_categories to authenticated;
grant update on public.schools to authenticated;
grant update on public.system_settings to authenticated;

grant execute on function public.app_role() to authenticated;
grant execute on function public.app_school_id() to authenticated;
grant execute on function public.is_uuid(text) to authenticated;
grant execute on function public.manila_end_of_day(date) to authenticated;
grant execute on function public.create_requirement(text, text, uuid, uuid, uuid, date, text[], integer, integer, uuid[]) to authenticated;
grant execute on function public.add_assignment(uuid, public.assignment_target, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.activate_requirement(uuid) to authenticated;
grant execute on function public.update_requirement(uuid, text, date) to authenticated;
grant execute on function public.deactivate_requirement(uuid) to authenticated;
grant execute on function public.cancel_slot(uuid, text) to authenticated;
grant execute on function public.register_submission(uuid, jsonb, text) to authenticated;
grant execute on function public.review_slot(uuid, public.review_action, text) to authenticated;
grant execute on function public.send_reminder(uuid, uuid[]) to authenticated;
grant execute on function public.create_announcement(text, text, public.user_role, uuid[]) to authenticated;
grant execute on function public.filtered_slots(uuid, uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.compliance_summary(uuid, uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.report_dataset(text, uuid, uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.rate_text(integer, integer) to authenticated;
grant execute on function public.protect_profile() to authenticated;
grant execute on function public.keep_single_current_year() to authenticated;
grant execute on function public.protect_settings() to authenticated;
grant execute on function public.protect_notification() to authenticated;
