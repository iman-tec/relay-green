-- Project AI assistant — shared, attributed Q&A history per project.
-- Every question + answer is logged so any engineer/supervisor on the project
-- can see what's been asked before. Reads are staff-gated via RLS; writes go
-- through the service role (the /api/staff/project-qa route).
--
-- Applied to live via the Management API on 2026-06-03.

create table if not exists public.project_assistant_messages (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null,
  thread_id   uuid not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  user_id     uuid references auth.users(id) on delete set null,
  user_name   text,
  created_at  timestamptz not null default now()
);

create index if not exists project_assistant_messages_project_idx
  on public.project_assistant_messages (project_id, created_at);
create index if not exists project_assistant_messages_thread_idx
  on public.project_assistant_messages (thread_id, created_at);

alter table public.project_assistant_messages enable row level security;

-- Staff can read the shared project history.
drop policy if exists staff_read_project_assistant on public.project_assistant_messages;
create policy staff_read_project_assistant
  on public.project_assistant_messages for select to authenticated
  using (
    exists (
      select 1 from public.user_role_names r
      where r.user_id = auth.uid()
        and r.role in ('engineer', 'supervisor', 'pod_lead', 'ops_manager', 'admin', 'super_admin')
    )
  );

-- Inserts happen server-side via the service role (bypasses RLS); no end-user
-- insert policy is granted.
