-- n8n workflow registry: stores workflows the user has connected from their n8n instance
create table if not exists n8n_workflows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  workflow_id text,
  webhook_url text not null,
  trigger_event text not null default 'message.received',
  is_active boolean not null default true,
  n8n_instance_url text,
  secret_token text,
  last_triggered_at timestamptz,
  last_status_code int,
  last_error text,
  execution_count int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table n8n_workflows enable row level security;
create policy "authenticated users manage n8n_workflows"
  on n8n_workflows for all using (auth.role() = 'authenticated');

-- n8n connection settings per-account
create table if not exists n8n_settings (
  id uuid primary key default gen_random_uuid(),
  instance_url text,
  api_key text,
  is_connected boolean default false,
  last_ping_at timestamptz,
  last_ping_status int,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table n8n_settings enable row level security;
create policy "authenticated users manage n8n_settings"
  on n8n_settings for all using (auth.role() = 'authenticated');
