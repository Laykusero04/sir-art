-- Sign-in could not load a profile because row policies queried each other.
-- These checks run as the function owner, so the policies no longer loop.

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

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (public.can_select_profile(id));

drop policy if exists slots_select on public.compliance_slots;
create policy slots_select on public.compliance_slots
  for select to authenticated
  using (public.can_select_slot(id));

drop policy if exists submissions_select on public.submissions;
create policy submissions_select on public.submissions
  for select to authenticated
  using (public.can_select_slot(slot_id));

drop policy if exists files_select on public.submission_files;
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

drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews
  for select to authenticated
  using (public.can_select_slot(slot_id));

revoke all on function public.can_select_slot(uuid) from public, anon;
revoke all on function public.can_select_profile(uuid) from public, anon;
grant execute on function public.can_select_slot(uuid) to authenticated;
grant execute on function public.can_select_profile(uuid) to authenticated;
