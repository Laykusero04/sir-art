-- The principal keeps the school: setup, teacher accounts, categories, templates, requirements, and review.
-- The administrator monitors compliance, reports, the calendar, and the audit log, and still cannot approve a file.

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
        public.app_role() in ('principal', 'administrator')
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
  if public.app_role() = 'principal' and old.id is distinct from auth.uid() then
    if old.role::text is distinct from 'teacher' or new.role::text is distinct from 'teacher' then
      raise exception 'You can only update teacher accounts.';
    end if;
    if new.email is distinct from old.email then
      raise exception 'You do not have permission to do that.';
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

drop policy if exists schools_update on public.schools;
create policy schools_update on public.schools
  for update to authenticated
  using (id = public.app_school_id() and public.app_role() = 'principal')
  with check (id = public.app_school_id() and public.app_role() = 'principal');

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    id = auth.uid()
    or (
      school_id = public.app_school_id()
      and public.app_role() = 'principal'
      and role::text = 'teacher'
    )
  )
  with check (
    school_id = public.app_school_id()
    and (
      id = auth.uid()
      or (
        public.app_role() = 'principal'
        and role::text = 'teacher'
      )
    )
  );

drop policy if exists master_write on public.school_years;
create policy master_write on public.school_years
  for all to authenticated
  using (school_id = public.app_school_id() and public.app_role() = 'principal')
  with check (school_id = public.app_school_id() and public.app_role() = 'principal');

drop policy if exists periods_write on public.grading_periods;
create policy periods_write on public.grading_periods
  for all to authenticated
  using (
    public.app_role() = 'principal'
    and exists (
      select 1 from public.school_years y
      where y.id = grading_periods.school_year_id
        and y.school_id = public.app_school_id()
    )
  )
  with check (
    public.app_role() = 'principal'
    and exists (
      select 1 from public.school_years y
      where y.id = grading_periods.school_year_id
        and y.school_id = public.app_school_id()
    )
  );

drop policy if exists grades_write on public.grade_levels;
create policy grades_write on public.grade_levels
  for all to authenticated
  using (school_id = public.app_school_id() and public.app_role() = 'principal')
  with check (school_id = public.app_school_id() and public.app_role() = 'principal');

drop policy if exists subjects_write on public.subjects;
create policy subjects_write on public.subjects
  for all to authenticated
  using (school_id = public.app_school_id() and public.app_role() = 'principal')
  with check (school_id = public.app_school_id() and public.app_role() = 'principal');

drop policy if exists sections_write on public.sections;
create policy sections_write on public.sections
  for all to authenticated
  using (school_id = public.app_school_id() and public.app_role() = 'principal')
  with check (school_id = public.app_school_id() and public.app_role() = 'principal');

drop policy if exists placement_write on public.teacher_assignments;
create policy placement_write on public.teacher_assignments
  for all to authenticated
  using (
    public.app_role() = 'principal'
    and exists (
      select 1 from public.profiles p
      where p.id = teacher_assignments.profile_id
        and p.school_id = public.app_school_id()
        and p.role::text = 'teacher'
    )
  )
  with check (
    public.app_role() = 'principal'
    and exists (
      select 1 from public.profiles p
      where p.id = teacher_assignments.profile_id
        and p.school_id = public.app_school_id()
        and p.role::text = 'teacher'
    )
  );

drop policy if exists placement_subjects_write on public.teacher_assignment_subjects;
create policy placement_subjects_write on public.teacher_assignment_subjects
  for all to authenticated
  using (public.app_role() = 'principal')
  with check (public.app_role() = 'principal');

drop policy if exists categories_write on public.document_categories;
create policy categories_write on public.document_categories
  for all to authenticated
  using (school_id = public.app_school_id() and public.app_role() = 'principal')
  with check (school_id = public.app_school_id() and public.app_role() = 'principal');

drop policy if exists requirements_select on public.requirements;
create policy requirements_select on public.requirements
  for select to authenticated
  using (
    school_id = public.app_school_id()
    and (
      public.app_role() = 'principal'
      or (
        public.app_role() = 'administrator'
        and state <> 'draft'
      )
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

create or replace function public.set_category_template(
  p_category uuid,
  p_path text,
  p_filename text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category public.document_categories%rowtype;
  v_ext text;
  v_prefix text;
begin
  if public.app_role() is distinct from 'principal' then
    raise exception 'You do not have permission to change a category template.';
  end if;

  select * into v_category
  from public.document_categories
  where id = p_category and school_id = public.app_school_id();
  if not found then
    raise exception 'Category was not found.';
  end if;

  if p_path is null and p_filename is null then
    perform set_config('schooldocs.template_write', 'on', true);
    update public.document_categories
    set template_path = null, template_filename = null
    where id = v_category.id;
    if v_category.template_path is not null then
      delete from storage.objects
      where bucket_id = 'school-documents' and name = v_category.template_path;
    end if;
    perform public.write_audit(
      'template_removed', 'category', v_category.id,
      jsonb_build_object('filename', v_category.template_filename)
    );
    return;
  end if;

  if p_path is null or p_filename is null or trim(p_filename) = '' then
    raise exception 'Choose a template file.';
  end if;
  if p_path like '/%' or p_path like '%..%' or position(E'\\' in p_path) > 0 then
    raise exception 'That template path is not allowed.';
  end if;

  v_prefix := public.app_school_id()::text || '/templates/' || p_category::text || '/';
  if left(p_path, char_length(v_prefix)) <> v_prefix then
    raise exception 'That file is not a template for this category.';
  end if;

  v_ext := lower(regexp_replace(p_filename, '^.*\.', ''));
  if v_ext not in ('pdf', 'docx', 'xlsx', 'pptx', 'jpg', 'png')
     or lower(regexp_replace(p_path, '^.*\.', '')) is distinct from v_ext then
    raise exception 'Use a pdf, docx, xlsx, pptx, jpg, or png file.';
  end if;
  if char_length(trim(p_filename)) > 180 then
    raise exception 'That file name is too long.';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'school-documents' and name = p_path
  ) then
    raise exception 'Upload the template file before saving it.';
  end if;

  perform set_config('schooldocs.template_write', 'on', true);
  update public.document_categories
  set template_path = p_path, template_filename = trim(p_filename)
  where id = v_category.id;

  if v_category.template_path is not null and v_category.template_path is distinct from p_path then
    delete from storage.objects
    where bucket_id = 'school-documents' and name = v_category.template_path;
  end if;

  perform public.write_audit(
    'template_saved', 'category', v_category.id,
    jsonb_build_object('filename', trim(p_filename))
  );
end;
$$;

drop policy if exists school_documents_template_insert on storage.objects;
create policy school_documents_template_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'school-documents'
    and public.app_role() = 'principal'
    and (storage.foldername(name))[1] = public.app_school_id()::text
    and (storage.foldername(name))[2] = 'templates'
    and public.is_uuid((storage.foldername(name))[3])
  );

drop policy if exists school_documents_template_delete on storage.objects;
create policy school_documents_template_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'school-documents'
    and public.app_role() = 'principal'
    and (storage.foldername(name))[1] = public.app_school_id()::text
    and (storage.foldername(name))[2] = 'templates'
  );

drop policy if exists school_documents_template_read on storage.objects;
create policy school_documents_template_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'school-documents'
    and (storage.foldername(name))[1] = public.app_school_id()::text
    and (storage.foldername(name))[2] = 'templates'
    and public.is_uuid((storage.foldername(name))[3])
    and (
      public.app_role() = 'principal'
      or (
        public.app_role() = 'teacher'
        and exists (
          select 1
          from public.compliance_slots cs
          join public.requirements r on r.id = cs.requirement_id
          where cs.teacher_id = auth.uid()
            and cs.cancelled_at is null
            and r.state <> 'draft'
            and r.category_id = (storage.foldername(name))[3]::uuid
        )
      )
    )
  );

drop policy if exists saved_filters_owner on public.saved_report_filters;
create policy saved_filters_owner on public.saved_report_filters
  for all to authenticated
  using (
    owner_id = auth.uid()
    and school_id = public.app_school_id()
    and public.app_role() = 'administrator'
  )
  with check (
    owner_id = auth.uid()
    and school_id = public.app_school_id()
    and public.app_role() = 'administrator'
  );

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
  if public.app_role() is distinct from 'administrator' then
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

notify pgrst, 'reload schema';
