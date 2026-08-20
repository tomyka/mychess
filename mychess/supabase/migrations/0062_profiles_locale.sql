alter table public.profiles
  add column locale text not null default 'en' check (locale in ('en', 'lt'));
