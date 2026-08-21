-- REFERENCE-ONLY HISTORICAL DESIGN DRAFT. DO NOT APPLY TO A DATABASE.
-- The executable PostgreSQL schema and advisory-locked migrations live in
-- src/db.js. schema-manifest.json is the CI-verified review snapshot.

create table tenants (
  id text primary key,
  slug text not null unique,
  name text not null,
  plan text not null default 'trial',
  status text not null default 'trialing',
  stripe_customer_id text,
  stripe_subscription_id text,
  billing_grace_ends_at timestamptz,
  billing_last_payment_failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id text primary key,
  email text not null unique,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table memberships (
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table billing_subscriptions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'trialing',
  plan text not null default 'trial',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table accounts (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  display_name text not null,
  normalized_name text not null,
  domain text,
  industry text,
  location text,
  status text not null default 'new',
  outreach_status text not null default 'not_started',
  owner_user_id text references users(id),
  target_score integer not null default 0,
  open_role_count integer not null default 0,
  next_action text,
  next_action_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, normalized_name)
);

create table contacts (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  account_id text references accounts(id) on delete set null,
  full_name text not null,
  first_name text,
  last_name text,
  email text,
  linkedin_url text,
  company_name text,
  title text,
  connected_on date,
  outreach_status text not null default 'not_started',
  priority_score integer not null default 0,
  notes text,
  source text not null default 'manual',
  source_metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index contacts_tenant_linkedin_unique
  on contacts (tenant_id, lower(linkedin_url))
  where linkedin_url is not null and linkedin_url <> '';

create unique index contacts_tenant_email_unique
  on contacts (tenant_id, lower(email))
  where email is not null and email <> '';

create table jobs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  account_id text references accounts(id) on delete set null,
  title text not null,
  company_name text not null,
  location text,
  source text,
  source_url text,
  posted_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table activities (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  account_id text references accounts(id) on delete set null,
  contact_id text references contacts(id) on delete set null,
  type text not null default 'note',
  summary text not null,
  notes text,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  created_by_user_id text references users(id),
  created_at timestamptz not null default now()
);

create table commercial_outcomes (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  account_id text not null,
  contact_id text not null default '',
  stage text not null check (stage in (
    'outreach_logged', 'replied', 'positive_reply', 'meeting_booked',
    'opportunity_created', 'won', 'lost'
  )),
  value_cents bigint check (value_cents is null or value_cents >= 0),
  currency text not null default 'USD',
  lost_reason text not null default '',
  notes text not null default '',
  source text not null default 'manual',
  source_activity_id text not null default '',
  occurred_at timestamptz not null,
  created_by_user_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index commercial_outcomes_tenant_occurred_idx
  on commercial_outcomes (tenant_id, occurred_at desc, id desc);
create index commercial_outcomes_tenant_stage_idx
  on commercial_outcomes (tenant_id, stage, occurred_at desc, id desc);
create index commercial_outcomes_tenant_account_idx
  on commercial_outcomes (tenant_id, account_id, occurred_at desc, id desc);
create unique index commercial_outcomes_tenant_activity_uidx
  on commercial_outcomes (tenant_id, source_activity_id)
  where source_activity_id <> '';

create table followups (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  account_id text references accounts(id) on delete cascade,
  contact_id text references contacts(id) on delete set null,
  due_at timestamptz not null,
  status text not null default 'open',
  note text not null,
  created_by_user_id text references users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table import_runs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  source text not null,
  source_file_name text,
  status text not null default 'queued',
  stats jsonb not null default '{}',
  metadata jsonb not null default '{}',
  created_by_user_id text references users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table background_jobs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  type text not null default '',
  status text not null default 'queued',
  snapshot jsonb not null default '{}',
  queued_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create index accounts_tenant_status_idx on accounts (tenant_id, status);
create index contacts_tenant_account_idx on contacts (tenant_id, account_id);
create index jobs_tenant_account_idx on jobs (tenant_id, account_id);
create index activities_tenant_account_idx on activities (tenant_id, account_id, occurred_at desc);
create index followups_tenant_due_idx on followups (tenant_id, status, due_at);
create index background_jobs_tenant_updated_idx on background_jobs (tenant_id, updated_at desc, id);

