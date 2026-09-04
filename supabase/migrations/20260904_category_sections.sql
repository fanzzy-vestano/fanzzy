alter table public.categories add column if not exists section text not null default 'normal';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'categories_section_check'
      and conrelid = 'public.categories'::regclass
  ) then
    alter table public.categories
      add constraint categories_section_check check (section in ('normal', 'luxury'));
  end if;
end $$;
