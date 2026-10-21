-- The administrator counts every school, its principals, and its teachers.
-- The principal still edits one school. This function does not change school records.

create or replace function public.school_directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.app_role() is distinct from 'administrator' then
    raise exception 'You do not have permission to do that.';
  end if;

  return coalesce((
    select jsonb_agg(school_row order by school_row->>'school_name')
    from (
      select jsonb_build_object(
        'school_id', sc.id,
        'school_name', sc.name,
        'deped_school_id', sc.deped_school_id,
        'district', sc.district,
        'division', sc.division,
        'region', sc.region,
        'principals', coalesce((
          select jsonb_agg(jsonb_build_object(
            'full_name', p.full_name,
            'email', p.email,
            'is_active', p.is_active
          ) order by p.full_name)
          from public.profiles p
          where p.school_id = sc.id and p.role::text = 'principal'
        ), '[]'::jsonb),
        'teachers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'full_name', p.full_name,
            'email', p.email,
            'is_active', p.is_active
          ) order by p.full_name)
          from public.profiles p
          where p.school_id = sc.id and p.role::text = 'teacher'
        ), '[]'::jsonb),
        'administrators', coalesce((
          select jsonb_agg(jsonb_build_object(
            'full_name', p.full_name,
            'email', p.email,
            'is_active', p.is_active
          ) order by p.full_name)
          from public.profiles p
          where p.school_id = sc.id and p.role::text = 'administrator'
        ), '[]'::jsonb)
      ) as school_row
      from public.schools sc
    ) rows
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.school_directory() from public, anon;
grant execute on function public.school_directory() to authenticated;

notify pgrst, 'reload schema';
