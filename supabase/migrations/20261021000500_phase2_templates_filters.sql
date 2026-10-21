-- Category template files and saved report filters.
-- A template is a blank form, not a submission. The administrator stores it.
-- A teacher can download it only when they hold a slot in that category.
-- Saved filters belong to the principal who created them.

alter table public.document_categories
  add column if not exists template_path text,
  add column if not exists template_filename text;

alter table public.document_categories
  drop constraint if exists document_categories_template;

alter table public.document_categories
  add constraint document_categories_template
  check ((template_path is null) = (template_filename is null));

create or replace function public.protect_category_template()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.template_path is not null or new.template_filename is not null then
      if current_setting('schooldocs.template_write', true) is distinct from 'on' then
        raise exception 'Use the category template action to change the template file.';
      end if;
    end if;
  elsif new.template_path is distinct from old.template_path
     or new.template_filename is distinct from old.template_filename then
    if current_setting('schooldocs.template_write', true) is distinct from 'on' then
      raise exception 'Use the category template action to change the template file.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists categories_protect_template on public.document_categories;
create trigger categories_protect_template
  before insert or update on public.document_categories
  for each row execute function public.protect_category_template();

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
  if public.app_role() is distinct from 'administrator' then
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
    and public.app_role() = 'administrator'
    and (storage.foldername(name))[1] = public.app_school_id()::text
    and (storage.foldername(name))[2] = 'templates'
    and public.is_uuid((storage.foldername(name))[3])
    and exists (
      select 1 from public.document_categories c
      where c.id = (storage.foldername(objects.name))[3]::uuid
        and c.school_id = public.app_school_id()
    )
  );

drop policy if exists school_documents_template_delete on storage.objects;
create policy school_documents_template_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'school-documents'
    and public.app_role() = 'administrator'
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
      public.app_role() = 'administrator'
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

create or replace view public.slot_overview
with (security_invoker = true) as
select
  cs.id,
  cs.school_id,
  cs.requirement_id,
  cs.teacher_id,
  cs.deadline,
  cs.workflow_status,
  cs.is_late,
  cs.approved_at,
  cs.cancelled_at,
  cs.cancel_reason,
  (cs.cancelled_at is null and r.state = 'active') as counts_toward_compliance,
  (
    cs.workflow_status <> 'approved'
    and cs.deadline < now()
    and cs.cancelled_at is null
  ) as is_overdue,
  (
    cs.workflow_status <> 'approved'
    and cs.cancelled_at is null
    and (cs.deadline at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date
  ) as is_due_today,
  exists (select 1 from public.submissions s where s.slot_id = cs.id) as has_submission,
  (select count(*) from public.submissions s where s.slot_id = cs.id)::integer as version_count,
  (select max(s.version) from public.submissions s where s.slot_id = cs.id) as latest_version,
  r.title as requirement_title,
  r.instructions,
  r.state as requirement_state,
  r.category_id,
  r.school_year_id,
  r.grading_period_id,
  r.allowed_extensions,
  r.max_files,
  r.max_size_mb,
  c.name as category_name,
  c.is_sensitive,
  sy.label as school_year_label,
  gp.name as grading_period_name,
  p.full_name as teacher_name,
  ta.grade_level_id,
  gl.name as grade_level_name,
  sec.name as section_name,
  c.template_path,
  c.template_filename
from public.compliance_slots cs
join public.requirements r on r.id = cs.requirement_id
join public.document_categories c on c.id = r.category_id
join public.school_years sy on sy.id = r.school_year_id
join public.profiles p on p.id = cs.teacher_id
left join public.grading_periods gp on gp.id = r.grading_period_id
left join public.teacher_assignments ta
  on ta.profile_id = cs.teacher_id
 and ta.school_year_id = r.school_year_id
left join public.grade_levels gl on gl.id = ta.grade_level_id
left join public.sections sec on sec.id = ta.section_id;

create table if not exists public.saved_report_filters (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  owner_id uuid not null references public.profiles (id),
  name text not null,
  report_type text not null,
  school_year_id uuid references public.school_years (id),
  grading_period_id uuid references public.grading_periods (id),
  category_id uuid references public.document_categories (id),
  grade_level_id uuid references public.grade_levels (id),
  teacher_id uuid references public.profiles (id),
  status text,
  created_at timestamptz not null default now(),
  constraint saved_report_filters_name check (char_length(trim(name)) between 1 and 80),
  constraint saved_report_filters_type check (report_type in (
    'school_wide', 'teacher', 'grade_level', 'missing', 'overdue', 'revision', 'history'
  )),
  constraint saved_report_filters_status check (status is null or status in (
    'not_submitted', 'submitted', 'under_review', 'needs_revision', 'approved',
    'overdue', 'missing', 'due_today'
  ))
);

create unique index if not exists saved_report_filters_owner_name
  on public.saved_report_filters (owner_id, lower(name));

alter table public.saved_report_filters enable row level security;

drop policy if exists saved_filters_owner on public.saved_report_filters;
create policy saved_filters_owner on public.saved_report_filters
  for all to authenticated
  using (
    owner_id = auth.uid()
    and school_id = public.app_school_id()
    and public.app_role() = 'principal'
  )
  with check (
    owner_id = auth.uid()
    and school_id = public.app_school_id()
    and public.app_role() = 'principal'
  );

revoke all on function public.protect_category_template() from public, anon;
revoke all on function public.set_category_template(uuid, text, text) from public, anon;
grant execute on function public.protect_category_template() to authenticated;
grant execute on function public.set_category_template(uuid, text, text) to authenticated;
grant select, insert, update, delete on public.saved_report_filters to authenticated;

notify pgrst, 'reload schema';
