-- SchoolDocs PH phase 1 schema.
-- Run this whole file, then 20261021000100_phase1_functions.sql.

create extension if not exists pgcrypto;

create type public.user_role as enum ('administrator', 'principal', 'teacher');
create type public.requirement_state as enum ('draft', 'active', 'inactive');
create type public.workflow_status as enum ('not_submitted', 'submitted', 'under_review', 'needs_revision', 'approved');
create type public.assignment_target as enum ('teacher', 'grade_level', 'section', 'subject', 'all_teachers');
create type public.review_action as enum ('start', 'approve', 'return', 'recommend_approve', 'recommend_return', 'reopen');

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  deped_school_id text,
  address text,
  district text,
  division text,
  region text,
  contact_email text,
  logo_path text,
  timezone text not null default 'Asia/Manila',
  created_at timestamptz not null default now(),
  constraint schools_timezone_manila check (timezone = 'Asia/Manila')
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  school_id uuid not null references public.schools (id),
  full_name text not null,
  email text not null,
  role public.user_role not null,
  is_active boolean not null default true,
  employee_number text,
  phone text,
  privacy_notice_accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.school_years (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  label text not null,
  start_date date not null,
  end_date date not null,
  is_current boolean not null default false,
  unique (school_id, label)
);

create unique index school_years_one_current on public.school_years (school_id) where is_current;

create table public.grading_periods (
  id uuid primary key default gen_random_uuid(),
  school_year_id uuid not null references public.school_years (id) on delete cascade,
  name text not null,
  sequence integer not null,
  start_date date not null,
  end_date date not null,
  unique (school_year_id, sequence),
  unique (school_year_id, name)
);

create table public.grade_levels (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  name text not null,
  sort_order integer not null,
  unique (school_id, name)
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  name text not null,
  grade_level_id uuid references public.grade_levels (id),
  unique (school_id, name)
);

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  grade_level_id uuid not null references public.grade_levels (id),
  school_year_id uuid not null references public.school_years (id) on delete cascade,
  name text not null,
  adviser_id uuid references public.profiles (id),
  unique (school_year_id, grade_level_id, name)
);

create table public.teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  school_year_id uuid not null references public.school_years (id) on delete cascade,
  grade_level_id uuid references public.grade_levels (id),
  section_id uuid references public.sections (id),
  unique (profile_id, school_year_id)
);

create table public.teacher_assignment_subjects (
  teacher_assignment_id uuid not null references public.teacher_assignments (id) on delete cascade,
  subject_id uuid not null references public.subjects (id),
  primary key (teacher_assignment_id, subject_id)
);

create table public.document_categories (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  name text not null,
  description text,
  group_name text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  is_sensitive boolean not null default false,
  unique (school_id, name)
);

create table public.system_settings (
  school_id uuid primary key references public.schools (id),
  max_file_size_mb integer not null default 20,
  allowed_extensions text[] not null default array['pdf', 'docx', 'xlsx', 'pptx', 'jpg', 'png'],
  backup_note text,
  reminder_template text not null default 'This is a reminder to submit the required school document before the deadline.',
  constraint system_settings_size check (max_file_size_mb between 1 and 50)
);

create table public.requirements (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  category_id uuid not null references public.document_categories (id),
  school_year_id uuid not null references public.school_years (id),
  grading_period_id uuid references public.grading_periods (id),
  title text not null,
  instructions text,
  deadline timestamptz not null,
  allowed_extensions text[] not null default array['pdf', 'docx'],
  max_files integer not null default 1,
  max_size_mb integer not null default 20,
  state public.requirement_state not null default 'draft',
  recurrence_rule text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint requirements_files check (max_files between 1 and 10),
  constraint requirements_size check (max_size_mb between 1 and 50)
);

create table public.requirement_reviewers (
  requirement_id uuid not null references public.requirements (id) on delete cascade,
  profile_id uuid not null references public.profiles (id),
  primary key (requirement_id, profile_id)
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.requirements (id) on delete cascade,
  target_type public.assignment_target not null,
  teacher_id uuid references public.profiles (id),
  grade_level_id uuid references public.grade_levels (id),
  section_id uuid references public.sections (id),
  subject_id uuid references public.subjects (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.compliance_slots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  requirement_id uuid not null references public.requirements (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id),
  deadline timestamptz not null,
  workflow_status public.workflow_status not null default 'not_submitted',
  is_late boolean not null default false,
  approved_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now()
);

create unique index compliance_slots_open_unique
  on public.compliance_slots (requirement_id, teacher_id)
  where cancelled_at is null;

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.compliance_slots (id) on delete cascade,
  version integer not null,
  notes text,
  submitted_at timestamptz not null default now(),
  submitted_late boolean not null default false,
  unique (slot_id, version)
);

create table public.submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  storage_path text not null,
  original_filename text not null
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.compliance_slots (id) on delete cascade,
  submission_id uuid references public.submissions (id),
  reviewer_id uuid not null references public.profiles (id),
  action public.review_action not null,
  comment text,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  read_at timestamptz,
  slot_id uuid references public.compliance_slots (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  title text not null,
  body text not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  requirement_id uuid not null references public.requirements (id),
  teacher_id uuid not null references public.profiles (id),
  sender_id uuid not null references public.profiles (id),
  slot_status public.workflow_status not null,
  sent_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id),
  actor_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index audit_logs_school_idx on public.audit_logs (school_id, created_at desc);
create index slots_teacher_idx on public.compliance_slots (teacher_id);
create index slots_requirement_idx on public.compliance_slots (requirement_id);

create or replace function public.app_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.app_school_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select school_id from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_uuid(p_value text)
returns boolean
language sql
immutable
as $$
  select p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;

create or replace function public.manila_end_of_day(p_date date)
returns timestamptz
language sql
immutable
as $$
  select (p_date::timestamp + time '23:59:59') at time zone 'Asia/Manila'
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

create trigger profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile();

create or replace function public.keep_single_current_year()
returns trigger
language plpgsql
as $$
begin
  if new.is_current then
    update public.school_years
      set is_current = false
    where school_id = new.school_id
      and id <> new.id
      and is_current;
  end if;
  return new;
end;
$$;

create trigger school_years_one_current
  before insert or update on public.school_years
  for each row execute function public.keep_single_current_year();

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.school_years enable row level security;
alter table public.grading_periods enable row level security;
alter table public.grade_levels enable row level security;
alter table public.subjects enable row level security;
alter table public.sections enable row level security;
alter table public.teacher_assignments enable row level security;
alter table public.teacher_assignment_subjects enable row level security;
alter table public.document_categories enable row level security;
alter table public.system_settings enable row level security;
alter table public.requirements enable row level security;
alter table public.requirement_reviewers enable row level security;
alter table public.assignments enable row level security;
alter table public.compliance_slots enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_files enable row level security;
alter table public.reviews enable row level security;
alter table public.notifications enable row level security;
alter table public.announcements enable row level security;
alter table public.reminders enable row level security;
alter table public.audit_logs enable row level security;

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
            or exists (select 1 from public.submissions s where s.slot_id = cs.id)
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

create policy schools_select on public.schools
  for select to authenticated
  using (id = public.app_school_id());

create policy schools_update on public.schools
  for update to authenticated
  using (id = public.app_school_id() and public.app_role() = 'administrator')
  with check (id = public.app_school_id() and public.app_role() = 'administrator');

create policy profiles_select on public.profiles
  for select to authenticated
  using (public.can_select_profile(id));

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or (school_id = public.app_school_id() and public.app_role() = 'administrator'))
  with check (school_id = public.app_school_id());

create policy master_select on public.school_years
  for select to authenticated
  using (school_id = public.app_school_id());

create policy master_write on public.school_years
  for all to authenticated
  using (school_id = public.app_school_id() and public.app_role() = 'administrator')
  with check (school_id = public.app_school_id() and public.app_role() = 'administrator');

create policy periods_select on public.grading_periods
  for select to authenticated
  using (
    exists (
      select 1 from public.school_years y
      where y.id = grading_periods.school_year_id
        and y.school_id = public.app_school_id()
    )
  );

create policy periods_write on public.grading_periods
  for all to authenticated
  using (
    public.app_role() = 'administrator'
    and exists (
      select 1 from public.school_years y
      where y.id = grading_periods.school_year_id
        and y.school_id = public.app_school_id()
    )
  )
  with check (
    public.app_role() = 'administrator'
    and exists (
      select 1 from public.school_years y
      where y.id = grading_periods.school_year_id
        and y.school_id = public.app_school_id()
    )
  );

create policy grades_select on public.grade_levels
  for select to authenticated using (school_id = public.app_school_id());
create policy grades_write on public.grade_levels
  for all to authenticated
  using (school_id = public.app_school_id() and public.app_role() = 'administrator')
  with check (school_id = public.app_school_id() and public.app_role() = 'administrator');

create policy subjects_select on public.subjects
  for select to authenticated using (school_id = public.app_school_id());
create policy subjects_write on public.subjects
  for all to authenticated
  using (school_id = public.app_school_id() and public.app_role() = 'administrator')
  with check (school_id = public.app_school_id() and public.app_role() = 'administrator');

create policy sections_select on public.sections
  for select to authenticated using (school_id = public.app_school_id());
create policy sections_write on public.sections
  for all to authenticated
  using (school_id = public.app_school_id() and public.app_role() = 'administrator')
  with check (school_id = public.app_school_id() and public.app_role() = 'administrator');

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

create policy placement_write on public.teacher_assignments
  for all to authenticated
  using (
    public.app_role() = 'administrator'
    and exists (
      select 1 from public.profiles p
      where p.id = teacher_assignments.profile_id
        and p.school_id = public.app_school_id()
    )
  )
  with check (
    public.app_role() = 'administrator'
    and exists (
      select 1 from public.profiles p
      where p.id = teacher_assignments.profile_id
        and p.school_id = public.app_school_id()
    )
  );

create policy placement_subjects_select on public.teacher_assignment_subjects
  for select to authenticated
  using (
    exists (
      select 1 from public.teacher_assignments ta
      where ta.id = teacher_assignment_subjects.teacher_assignment_id
    )
  );

create policy placement_subjects_write on public.teacher_assignment_subjects
  for all to authenticated
  using (public.app_role() = 'administrator')
  with check (public.app_role() = 'administrator');

create policy categories_select on public.document_categories
  for select to authenticated using (school_id = public.app_school_id());

create policy categories_write on public.document_categories
  for all to authenticated
  using (school_id = public.app_school_id() and public.app_role() in ('administrator', 'principal'))
  with check (school_id = public.app_school_id() and public.app_role() in ('administrator', 'principal'));

create policy settings_select on public.system_settings
  for select to authenticated using (school_id = public.app_school_id());

create policy settings_update on public.system_settings
  for update to authenticated
  using (school_id = public.app_school_id() and public.app_role() in ('administrator', 'principal'))
  with check (school_id = public.app_school_id() and public.app_role() in ('administrator', 'principal'));

create or replace function public.protect_settings()
returns trigger
language plpgsql
as $$
begin
  if public.app_role() = 'principal' then
    new.max_file_size_mb := old.max_file_size_mb;
    new.allowed_extensions := old.allowed_extensions;
    new.backup_note := old.backup_note;
  elsif public.app_role() is distinct from 'administrator' and auth.uid() is not null then
    raise exception 'You do not have permission to do that.';
  end if;
  if new.max_file_size_mb > 50 then
    raise exception 'The file size cap cannot be higher than 50 MB.';
  end if;
  return new;
end;
$$;

create trigger system_settings_protect
  before update on public.system_settings
  for each row execute function public.protect_settings();

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

create policy reviewers_select on public.requirement_reviewers
  for select to authenticated
  using (
    exists (
      select 1 from public.requirements r
      where r.id = requirement_reviewers.requirement_id
    )
  );

create policy assignments_select on public.assignments
  for select to authenticated
  using (
    exists (
      select 1 from public.requirements r
      where r.id = assignments.requirement_id
        and public.app_role() = 'principal'
    )
  );

create policy slots_select on public.compliance_slots
  for select to authenticated
  using (public.can_select_slot(id));

create policy submissions_select on public.submissions
  for select to authenticated
  using (public.can_select_slot(slot_id));

create policy files_select on public.submission_files
  for select to authenticated
  using (
    exists (
      select 1
      from public.submissions s
      where s.id = submission_files.submission_id
        and public.can_select_slot(s.slot_id)
    )
  );

create policy reviews_select on public.reviews
  for select to authenticated
  using (public.can_select_slot(slot_id));

create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.protect_notification()
returns trigger
language plpgsql
as $$
begin
  new.school_id := old.school_id;
  new.user_id := old.user_id;
  new.type := old.type;
  new.title := old.title;
  new.body := old.body;
  new.slot_id := old.slot_id;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger notifications_protect
  before update on public.notifications
  for each row execute function public.protect_notification();

create policy announcements_select on public.announcements
  for select to authenticated
  using (school_id = public.app_school_id() and public.app_role() in ('principal', 'administrator'));

create policy reminders_select on public.reminders
  for select to authenticated
  using (
    school_id = public.app_school_id()
    and (public.app_role() = 'principal' or sender_id = auth.uid())
  );

create policy audit_select on public.audit_logs
  for select to authenticated
  using (
    school_id = public.app_school_id()
    and (
      public.app_role() = 'administrator'
      or (
        public.app_role() = 'principal'
        and action = any (array[
          'upload', 'replace', 'resubmit', 'review_started', 'returned', 'approved',
          'reopened', 'recommend_approve', 'recommend_return', 'requirement_created',
          'requirement_edited', 'requirement_activated', 'requirement_deactivated',
          'deadline_changed', 'reminder_sent', 'slot_cancelled'
        ])
      )
    )
  );

insert into storage.buckets (id, name, public, file_size_limit)
values ('school-documents', 'school-documents', false, 52428800)
on conflict (id) do update
set public = false,
    file_size_limit = 52428800;

create policy school_documents_teacher_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'school-documents'
    and public.app_role() = 'teacher'
    and (storage.foldername(name))[1] = public.app_school_id()::text
    and (storage.foldername(name))[4] = auth.uid()::text
    and public.is_uuid((storage.foldername(name))[2])
    and public.is_uuid((storage.foldername(name))[3])
    and exists (
      select 1
      from public.compliance_slots cs
      join public.requirements r on r.id = cs.requirement_id
      where cs.teacher_id = auth.uid()
        and cs.cancelled_at is null
        and r.state = 'active'
        and r.id = (storage.foldername(name))[3]::uuid
        and r.school_year_id = (storage.foldername(name))[2]::uuid
        and r.school_id = public.app_school_id()
    )
  );

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
  sec.name as section_name
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
