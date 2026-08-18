-- ================================================================
-- Pulso — schema inicial (perfis + tarefas), com controle de acesso
-- por papel (gestor / gerente / base) e por clínica.
--
-- Como usar: Supabase > SQL Editor > New query > cole este arquivo
-- inteiro > Run. Pode rodar de novo sem problema (é seguro repetir).
-- ================================================================

-- Perfis: estende auth.users com os dados do Pulso (nome, papel, clínica)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  role text not null check (role in ('owner','gerente','base','tecnico')),
  clinica_id text check (clinica_id in ('sorridents','gio')),
  login_email text not null unique,
  created_at timestamptz not null default now()
);

-- Tarefas
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text default '',
  clinica_id text not null check (clinica_id in ('sorridents','gio')),
  responsavel_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pendente' check (status in ('pendente','em_andamento','concluida')),
  prazo date,
  criado_por uuid references public.profiles(id),
  criado_em timestamptz not null default now(),
  concluido_em timestamptz,
  recorrencia jsonb,
  prioridade text not null default 'media' check (prioridade in ('alta','media','baixa')),
  categoria text
);

-- Garante o papel "tecnico" mesmo se a tabela profiles já existia de uma
-- versão anterior sem ele (time técnico da GIO, aba de indicações)
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('owner','gerente','base','tecnico'));

-- Garante as colunas novas mesmo se a tabela já existia de uma versão anterior
alter table public.tasks add column if not exists recorrencia jsonb;
alter table public.tasks add column if not exists prioridade text not null default 'media';
alter table public.tasks add column if not exists categoria text;
do $$ begin
  alter table public.tasks add constraint tasks_prioridade_check check (prioridade in ('alta','media','baixa'));
exception when duplicate_object then null;
end $$;

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;

-- Funções auxiliares (security definer: evitam recursão infinita nas policies)
create or replace function public.my_role()
returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.my_clinica()
returns text
language sql stable security definer set search_path = public as $$
  select clinica_id from public.profiles where id = auth.uid();
$$;

-- Verdadeiro se o usuário logado pode ver a tarefa t_id (dono, gerente da
-- clínica dela, ou a pessoa responsável). Usado pelas policies de
-- comentários, checklist e histórico, que seguem a mesma visibilidade das
-- tarefas.
create or replace function public.can_access_task(t_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id = t_id
    and (
      public.my_role() = 'owner'
      or (public.my_role() = 'gerente' and public.my_clinica() = t.clinica_id)
      or t.responsavel_id = auth.uid()
    )
  );
$$;

-- A tela de login agora pede login + senha digitados (sem lista de nomes),
-- então não precisamos mais de uma view pública pra alimentar um seletor
-- antes do login — ela expunha o identificador de login de todo mundo pra
-- qualquer visitante da internet, sem estar autenticado. Se ela ainda
-- existir de uma versão anterior do banco, remove.
drop view if exists public.login_directory;

-- ---------- Policies: profiles ----------
-- `auth.uid()` embrulhado em `(select ...)` é otimização recomendada pelo
-- linter do Supabase: sem isso, é reavaliado linha por linha; com isso, o
-- Postgres calcula uma vez só por consulta (mesmo resultado, mais rápido
-- conforme o histórico cresce).
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated
using (
  public.my_role() = 'owner'
  or role = 'owner'
  or clinica_id = public.my_clinica()
  or id = (select auth.uid())
);

-- Divide o que antes era um "for all" (profiles_owner_write) em 3 policies
-- específicas de escrita — um "for all" cobre SELECT também, e ter 2
-- policies permissivas cobrindo SELECT ao mesmo tempo (esta + a de cima)
-- é outro ponto que o linter de performance aponta.
drop policy if exists "profiles_owner_write" on public.profiles;
drop policy if exists "profiles_owner_insert" on public.profiles;
create policy "profiles_owner_insert" on public.profiles for insert to authenticated
with check (public.my_role() = 'owner');
drop policy if exists "profiles_owner_update" on public.profiles;
create policy "profiles_owner_update" on public.profiles for update to authenticated
using (public.my_role() = 'owner')
with check (public.my_role() = 'owner');
drop policy if exists "profiles_owner_delete" on public.profiles;
create policy "profiles_owner_delete" on public.profiles for delete to authenticated
using (public.my_role() = 'owner');

-- ---------- Policies: tasks ----------
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks for select to authenticated
using (
  public.my_role() = 'owner'
  or (public.my_role() = 'gerente' and public.my_clinica() = clinica_id)
  or responsavel_id = (select auth.uid())
);

drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks for insert to authenticated
with check (
  public.my_role() = 'owner'
  or (
    public.my_role() = 'gerente'
    and public.my_clinica() = clinica_id
    and exists (
      select 1 from public.profiles r
      where r.id = responsavel_id
      and (r.role = 'owner' or r.clinica_id = public.my_clinica())
    )
  )
  or (
    public.my_role() = 'base'
    and public.my_clinica() = clinica_id
    and (
      responsavel_id = (select auth.uid())
      or exists (
        select 1 from public.profiles g
        where g.id = responsavel_id and g.role = 'gerente' and g.clinica_id = public.my_clinica()
      )
    )
  )
);

drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks for update to authenticated
using (
  public.my_role() = 'owner'
  or (public.my_role() = 'gerente' and public.my_clinica() = clinica_id)
  or responsavel_id = (select auth.uid())
)
with check (
  public.my_role() = 'owner'
  or (
    public.my_role() = 'gerente'
    and public.my_clinica() = clinica_id
    and exists (
      select 1 from public.profiles r
      where r.id = responsavel_id
      and (r.role = 'owner' or r.clinica_id = public.my_clinica())
    )
  )
  or (responsavel_id = (select auth.uid()) and public.my_clinica() = clinica_id)
);

drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks for delete to authenticated
using (
  public.my_role() = 'owner'
  or (public.my_role() = 'gerente' and public.my_clinica() = clinica_id)
);

-- Anexos das tarefas
create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.task_attachments enable row level security;

drop policy if exists "attachments_select" on public.task_attachments;
create policy "attachments_select" on public.task_attachments for select to authenticated
using (
  exists (
    select 1 from public.tasks t
    where t.id = task_attachments.task_id
    and (
      public.my_role() = 'owner'
      or (public.my_role() = 'gerente' and public.my_clinica() = t.clinica_id)
      or t.responsavel_id = (select auth.uid())
    )
  )
);

-- uploaded_by = auth.uid() garante que ninguém grava um anexo em nome de
-- outra pessoa da equipe (só quem está logado pode aparecer como autor).
drop policy if exists "attachments_insert" on public.task_attachments;
create policy "attachments_insert" on public.task_attachments for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and exists (
    select 1 from public.tasks t
    where t.id = task_attachments.task_id
    and (
      public.my_role() = 'owner'
      or (public.my_role() = 'gerente' and public.my_clinica() = t.clinica_id)
      or t.responsavel_id = (select auth.uid())
    )
  )
);

drop policy if exists "attachments_delete" on public.task_attachments;
create policy "attachments_delete" on public.task_attachments for delete to authenticated
using (
  uploaded_by = (select auth.uid())
  or public.my_role() = 'owner'
  or exists (
    select 1 from public.tasks t
    where t.id = task_attachments.task_id
    and public.my_role() = 'gerente' and public.my_clinica() = t.clinica_id
  )
);

-- Bucket privado pra guardar os arquivos anexados (os arquivos em si ficam
-- aqui; a tabela acima só guarda o "endereço" de cada um)
insert into storage.buckets (id, name, public)
values ('task-files', 'task-files', false)
on conflict (id) do nothing;

drop policy if exists "task_files_select" on storage.objects;
create policy "task_files_select" on storage.objects for select to authenticated
using (
  bucket_id = 'task-files'
  and exists (
    select 1 from public.tasks t
    where t.id::text = (storage.foldername(name))[1]
    and (
      public.my_role() = 'owner'
      or (public.my_role() = 'gerente' and public.my_clinica() = t.clinica_id)
      or t.responsavel_id = auth.uid()
    )
  )
);

drop policy if exists "task_files_insert" on storage.objects;
create policy "task_files_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'task-files'
  and exists (
    select 1 from public.tasks t
    where t.id::text = (storage.foldername(name))[1]
    and (
      public.my_role() = 'owner'
      or (public.my_role() = 'gerente' and public.my_clinica() = t.clinica_id)
      or t.responsavel_id = auth.uid()
    )
  )
);

drop policy if exists "task_files_delete" on storage.objects;
create policy "task_files_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'task-files'
  and exists (
    select 1 from public.tasks t
    where t.id::text = (storage.foldername(name))[1]
    and (
      public.my_role() = 'owner'
      or (public.my_role() = 'gerente' and public.my_clinica() = t.clinica_id)
    )
  )
);

-- Comentários das tarefas
create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  autor_id uuid references public.profiles(id),
  texto text not null,
  created_at timestamptz not null default now()
);

alter table public.task_comments enable row level security;

drop policy if exists "comments_select" on public.task_comments;
create policy "comments_select" on public.task_comments for select to authenticated
using (public.can_access_task(task_id));

-- autor_id = auth.uid() garante que ninguém grava um comentário em nome de
-- outra pessoa da equipe (só quem está logado pode aparecer como autor).
drop policy if exists "comments_insert" on public.task_comments;
create policy "comments_insert" on public.task_comments for insert to authenticated
with check (autor_id = (select auth.uid()) and public.can_access_task(task_id));

drop policy if exists "comments_delete" on public.task_comments;
create policy "comments_delete" on public.task_comments for delete to authenticated
using (
  autor_id = (select auth.uid())
  or public.my_role() = 'owner'
  or exists (
    select 1 from public.tasks t
    where t.id = task_comments.task_id
    and public.my_role() = 'gerente' and public.my_clinica() = t.clinica_id
  )
);

-- Checklist (subtarefas) de cada tarefa
create table if not exists public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  texto text not null,
  concluido boolean not null default false,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.task_checklist_items enable row level security;

drop policy if exists "checklist_select" on public.task_checklist_items;
create policy "checklist_select" on public.task_checklist_items for select to authenticated
using (public.can_access_task(task_id));

drop policy if exists "checklist_insert" on public.task_checklist_items;
create policy "checklist_insert" on public.task_checklist_items for insert to authenticated
with check (public.can_access_task(task_id));

drop policy if exists "checklist_update" on public.task_checklist_items;
create policy "checklist_update" on public.task_checklist_items for update to authenticated
using (public.can_access_task(task_id))
with check (public.can_access_task(task_id));

drop policy if exists "checklist_delete" on public.task_checklist_items;
create policy "checklist_delete" on public.task_checklist_items for delete to authenticated
using (public.can_access_task(task_id));

-- Histórico de atividade de cada tarefa (registro simples, sem edição/remoção)
create table if not exists public.task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  autor_id uuid references public.profiles(id),
  tipo text not null,
  detalhe text,
  created_at timestamptz not null default now()
);

alter table public.task_activity enable row level security;

drop policy if exists "activity_select" on public.task_activity;
create policy "activity_select" on public.task_activity for select to authenticated
using (public.can_access_task(task_id));

-- autor_id = auth.uid() garante que ninguém grava um item de histórico em
-- nome de outra pessoa da equipe (só quem está logado pode aparecer como autor).
drop policy if exists "activity_insert" on public.task_activity;
create policy "activity_insert" on public.task_activity for insert to authenticated
with check (autor_id = (select auth.uid()) and public.can_access_task(task_id));

-- Kanban comercial (leads/oportunidades). Uma tabela só pra GIO e Sorridents;
-- os campos que não se aplicam a uma clínica ficam null pra ela (a tela só
-- mostra os campos relevantes de cada clínica).
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  clinica_id text not null check (clinica_id in ('sorridents','gio')),
  etapa text not null default 'avaliacao_agendada' check (etapa in (
    'indicacao_recebida','avaliacao_agendada','faltou_avaliacao','orcamento_apresentado','negociacao',
    'follow_up','aguardando_pagamento','fechado','perdido'
  )),
  nome_paciente text not null,
  codigo_paciente text,
  whatsapp text,
  responsavel_comercial uuid references public.profiles(id),
  procedimento text,
  valor_orcado numeric,
  valor_pago numeric,
  origem text,
  indicado_por text,
  data_avaliacao date,
  proximo_contato date,
  prioridade text check (prioridade in ('alta','media','baixa')),
  historia text,
  evolucao text,
  indicado_por_tecnico_id uuid references public.profiles(id),
  observacoes text,
  criado_por uuid references public.profiles(id),
  criado_em timestamptz not null default now()
);

-- Garante as colunas mesmo se a tabela já existia de uma versão anterior
alter table public.leads add column if not exists proximo_contato date;
alter table public.leads add column if not exists indicado_por_tecnico_id uuid references public.profiles(id);
alter table public.leads add column if not exists observacoes text;
alter table public.leads add column if not exists evolucao text;

-- Garante a etapa "indicacao_recebida" (indicações do time técnico da GIO)
-- mesmo se a tabela já existia com o check antigo
alter table public.leads drop constraint if exists leads_etapa_check;
alter table public.leads add constraint leads_etapa_check check (etapa in (
  'indicacao_recebida','avaliacao_agendada','faltou_avaliacao','orcamento_apresentado','negociacao',
  'follow_up','aguardando_pagamento','fechado','perdido'
));

alter table public.leads enable row level security;

-- Técnico só enxerga os leads que ele mesmo indicou (pra alimentar o "valor
-- pago" na aba Indicações) — nunca a carteira inteira da clínica.
drop policy if exists "leads_select" on public.leads;
create policy "leads_select" on public.leads for select to authenticated
using (
  public.my_role() = 'owner'
  or (public.my_role() <> 'tecnico' and public.my_clinica() = clinica_id)
  or (public.my_role() = 'tecnico' and indicado_por_tecnico_id = (select auth.uid()))
);

-- Técnico nunca cria/edita lead direto: quando ele manda uma indicação, é o
-- gatilho de public.indicacoes (SECURITY DEFINER) que cria o card por ele.
drop policy if exists "leads_insert" on public.leads;
create policy "leads_insert" on public.leads for insert to authenticated
with check (
  public.my_role() = 'owner'
  or (public.my_role() <> 'tecnico' and public.my_clinica() = clinica_id)
);

drop policy if exists "leads_update" on public.leads;
create policy "leads_update" on public.leads for update to authenticated
using (
  public.my_role() = 'owner'
  or (public.my_role() <> 'tecnico' and public.my_clinica() = clinica_id)
)
with check (
  public.my_role() = 'owner'
  or (public.my_role() <> 'tecnico' and public.my_clinica() = clinica_id)
);

drop policy if exists "leads_delete" on public.leads;
create policy "leads_delete" on public.leads for delete to authenticated
using (
  public.my_role() = 'owner'
  or (public.my_role() = 'gerente' and public.my_clinica() = clinica_id)
);

-- Controle de estoque (itens por clínica). GIO e Sorridents têm listas
-- separadas; cada item tem categoria livre (área técnica, invasivos,
-- serviços gerais na GIO; cirurgia, endodontia, ortodontia etc na
-- Sorridents — conforme a planilha original de cada uma).
create table if not exists public.estoque_itens (
  id uuid primary key default gen_random_uuid(),
  clinica_id text not null check (clinica_id in ('sorridents','gio')),
  tipo text not null default 'clinico' check (tipo in ('clinico','limpeza_papelaria')),
  categoria text,
  nome text not null,
  quantidade_ideal numeric not null default 0,
  quantidade_atual numeric not null default 0,
  criado_por uuid references public.profiles(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Garante a coluna "tipo" mesmo se a tabela já existia de uma versão
-- anterior (separa o estoque clínico do estoque de limpeza/papelaria,
-- hoje só usado pela Sorridents)
alter table public.estoque_itens add column if not exists tipo text not null default 'clinico';
alter table public.estoque_itens drop constraint if exists estoque_itens_tipo_check;
alter table public.estoque_itens add constraint estoque_itens_tipo_check check (tipo in ('clinico','limpeza_papelaria'));

alter table public.estoque_itens enable row level security;

-- Todo mundo da clínica (base, gerente) e o gestor podem ver os itens.
-- Técnico não tem nenhum acesso ao estoque (nem consulta) — não usa essa aba.
drop policy if exists "estoque_select" on public.estoque_itens;
create policy "estoque_select" on public.estoque_itens for select to authenticated
using (
  public.my_role() = 'owner'
  or (public.my_role() <> 'tecnico' and public.my_clinica() = clinica_id)
);

-- Só gestor e gerente da clínica podem cadastrar item novo.
drop policy if exists "estoque_insert" on public.estoque_itens;
create policy "estoque_insert" on public.estoque_itens for insert to authenticated
with check (
  public.my_role() = 'owner'
  or (public.my_role() = 'gerente' and public.my_clinica() = clinica_id)
);

-- Gestor e gerente editam tudo; papel-base da clínica também pode
-- atualizar a linha (é o que os botões de +/- usam) — o trigger abaixo
-- trava pra ele só conseguir mexer em quantidade_atual. Técnico não edita
-- nada aqui.
drop policy if exists "estoque_update" on public.estoque_itens;
create policy "estoque_update" on public.estoque_itens for update to authenticated
using (
  public.my_role() = 'owner'
  or (public.my_role() <> 'tecnico' and public.my_clinica() = clinica_id)
)
with check (
  public.my_role() = 'owner'
  or (public.my_role() <> 'tecnico' and public.my_clinica() = clinica_id)
);

drop policy if exists "estoque_delete" on public.estoque_itens;
create policy "estoque_delete" on public.estoque_itens for delete to authenticated
using (
  public.my_role() = 'owner'
  or (public.my_role() = 'gerente' and public.my_clinica() = clinica_id)
);

-- Trava extra: usuário com papel "base" só pode alterar a quantidade
-- atual (o que os botões de +/- fazem) — nunca nome, categoria ou a
-- quantidade ideal, mesmo que tentem chamar a API direto por fora da tela.
create or replace function public.estoque_check_update()
returns trigger
language plpgsql
security definer set search_path = public as $$
begin
  if public.my_role() = 'base' then
    if new.nome is distinct from old.nome
       or new.categoria is distinct from old.categoria
       or new.quantidade_ideal is distinct from old.quantidade_ideal
       or new.clinica_id is distinct from old.clinica_id
       or new.tipo is distinct from old.tipo then
      raise exception 'Sem permissão para alterar esse campo do item de estoque';
    end if;
  end if;
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists estoque_before_update on public.estoque_itens;
create trigger estoque_before_update
before update on public.estoque_itens
for each row execute function public.estoque_check_update();

-- Indicações do time técnico (só GIO): a menina do time técnico registra o
-- nome do paciente, o procedimento indicado e uma observação opcional; a
-- data é sempre a do dia do envio. Cada indicação, ao ser inserida, cria
-- sozinha (via trigger) um card novo no comercial da GIO (etapa "indicação
-- recebida") e uma tarefa pra gerente da GIO ligar pro paciente.
create table if not exists public.indicacoes (
  id uuid primary key default gen_random_uuid(),
  clinica_id text not null default 'gio' check (clinica_id = 'gio'),
  tecnico_id uuid not null references public.profiles(id),
  nome_paciente text not null,
  procedimento text not null,
  observacao text,
  data_indicacao date not null default current_date,
  lead_id uuid references public.leads(id),
  criado_em timestamptz not null default now()
);

alter table public.indicacoes enable row level security;

-- Dono vê tudo; gerente da GIO vê tudo da GIO; cada técnica só vê as
-- próprias indicações.
drop policy if exists "indicacoes_select" on public.indicacoes;
create policy "indicacoes_select" on public.indicacoes for select to authenticated
using (
  public.my_role() = 'owner'
  or (public.my_role() = 'gerente' and public.my_clinica() = 'gio')
  or tecnico_id = (select auth.uid())
);

-- Técnica só cria indicação em nome dela mesma; dono e gerente da GIO
-- também podem registrar em nome de alguém do time se precisar.
drop policy if exists "indicacoes_insert" on public.indicacoes;
create policy "indicacoes_insert" on public.indicacoes for insert to authenticated
with check (
  public.my_role() = 'owner'
  or (public.my_role() = 'gerente' and public.my_clinica() = 'gio')
  or (public.my_role() = 'tecnico' and tecnico_id = (select auth.uid()))
);

-- Indicação é um registro histórico — não tem edição, só exclusão (por
-- engano) pelo dono ou gerente da GIO.
drop policy if exists "indicacoes_delete" on public.indicacoes;
create policy "indicacoes_delete" on public.indicacoes for delete to authenticated
using (
  public.my_role() = 'owner'
  or (public.my_role() = 'gerente' and public.my_clinica() = 'gio')
);

-- Ao inserir uma indicação: cria o card no comercial da GIO (etapa
-- "indicação recebida", já linkando quem indicou pra comissão futura) e
-- uma tarefa pra gerente da GIO ligar pro paciente — tudo automático.
create or replace function public.indicacao_processar()
returns trigger
language plpgsql
security definer set search_path = public as $$
declare
  v_lead_id uuid;
  v_gerente_id uuid;
  v_tecnico_nome text;
begin
  select nome into v_tecnico_nome from public.profiles where id = new.tecnico_id;

  insert into public.leads (
    clinica_id, etapa, nome_paciente, procedimento,
    indicado_por_tecnico_id, observacoes, criado_por
  ) values (
    'gio', 'indicacao_recebida', new.nome_paciente, new.procedimento,
    new.tecnico_id, new.observacao, new.tecnico_id
  ) returning id into v_lead_id;

  select id into v_gerente_id from public.profiles
  where role = 'gerente' and clinica_id = 'gio' limit 1;

  if v_gerente_id is not null then
    insert into public.tasks (
      titulo, descricao, clinica_id, responsavel_id, status, prazo, criado_por, categoria
    ) values (
      'Ligar pra ' || new.nome_paciente || ' (indicação do time técnico)',
      'Indicado(a) por ' || coalesce(v_tecnico_nome, 'time técnico') || ' para ' || new.procedimento || '.'
        || case when coalesce(new.observacao, '') <> '' then ' Observação: ' || new.observacao else '' end,
      'gio', v_gerente_id, 'pendente', current_date, new.tecnico_id, 'atendimento'
    );
  end if;

  new.lead_id = v_lead_id;
  return new;
end;
$$;

drop trigger if exists indicacao_before_insert on public.indicacoes;
create trigger indicacao_before_insert
before insert on public.indicacoes
for each row execute function public.indicacao_processar();

-- Código de paciente não pode se repetir dentro da mesma clínica (a GIO não
-- usa esse campo, então fica de fora sozinha por ser sempre null). Ignora
-- também string vazia, senão duas oportunidades sem código preenchido
-- (comum ao criar manualmente) colidiriam entre si.
create unique index if not exists leads_codigo_paciente_uniq
  on public.leads (clinica_id, codigo_paciente)
  where codigo_paciente is not null and codigo_paciente <> '';

-- Valor orçado/pago e quantidade de estoque nunca podem ser negativos. A
-- tela já trava isso (input com min="0"), isso aqui é o backstop no banco.
alter table public.leads drop constraint if exists leads_valor_orcado_check;
alter table public.leads add constraint leads_valor_orcado_check check (valor_orcado is null or valor_orcado >= 0);
alter table public.leads drop constraint if exists leads_valor_pago_check;
alter table public.leads add constraint leads_valor_pago_check check (valor_pago is null or valor_pago >= 0);
alter table public.estoque_itens drop constraint if exists estoque_itens_quantidade_ideal_check;
alter table public.estoque_itens add constraint estoque_itens_quantidade_ideal_check check (quantidade_ideal >= 0);
alter table public.estoque_itens drop constraint if exists estoque_itens_quantidade_atual_check;
alter table public.estoque_itens add constraint estoque_itens_quantidade_atual_check check (quantidade_atual >= 0);

-- Índices nas colunas mais consultadas (clínica+etapa dos leads, responsável
-- das tarefas, técnico das indicações) — sem efeito no uso de hoje, mas
-- evita que as telas fiquem lentas conforme o histórico crescer.
create index if not exists idx_leads_clinica_etapa on public.leads (clinica_id, etapa);
create index if not exists idx_tasks_responsavel on public.tasks (responsavel_id);
create index if not exists idx_indicacoes_tecnico on public.indicacoes (tecnico_id);

-- Desligamento de funcionária: quando o perfil dela é apagado (ex: painel do
-- Supabase, Authentication > Users > Delete — o que cascade-apaga o perfil
-- em public.profiles também), redistribui tudo que estava em aberto pro
-- supervisor acima dela (gerente da clínica dela; se ela já era gerente, ou
-- se a clínica não tem gerente cadastrada, cai pro dono) — em vez de apagar
-- as tarefas dela em cascata sem avisar, ou travar com erro por causa de
-- leads/comentários/indicações que ela deixou. Registros que são só
-- histórico de autoria (quem comentou, quem criou) ficam "sem autor": o
-- registro em si continua existindo, só perde o vínculo com quem já não faz
-- mais parte da equipe.
create or replace function public.reassign_before_profile_delete()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_supervisor uuid;
begin
  if old.role = 'owner' then
    return old; -- não existe supervisor acima do dono
  end if;

  select id into v_supervisor from public.profiles
  where role = 'gerente' and clinica_id = old.clinica_id and old.role in ('base', 'tecnico')
  limit 1;

  if v_supervisor is null then
    select id into v_supervisor from public.profiles where role = 'owner' limit 1;
  end if;

  if v_supervisor is not null then
    update public.tasks set responsavel_id = v_supervisor where responsavel_id = old.id;
    update public.leads set responsavel_comercial = v_supervisor where responsavel_comercial = old.id;
    update public.indicacoes set tecnico_id = v_supervisor where tecnico_id = old.id;
  end if;

  update public.tasks set criado_por = null where criado_por = old.id;
  update public.leads set indicado_por_tecnico_id = null where indicado_por_tecnico_id = old.id;
  update public.leads set criado_por = null where criado_por = old.id;
  update public.estoque_itens set criado_por = null where criado_por = old.id;
  update public.task_attachments set uploaded_by = null where uploaded_by = old.id;
  update public.task_comments set autor_id = null where autor_id = old.id;
  update public.task_activity set autor_id = null where autor_id = old.id;

  return old;
end;
$$;

drop trigger if exists reassign_before_profile_delete on public.profiles;
create trigger reassign_before_profile_delete
before delete on public.profiles
for each row execute function public.reassign_before_profile_delete();

-- ================================================================
-- Cobranças (GIO): controle de vencimento de boleto/recorrente,
-- cadastro de cliente independente do funil Comercial. Gera tarefas
-- automaticamente (1 dia útil antes do vencimento pra boleto, no dia
-- do vencimento pra recorrente) — ver computeCobrancaTask no App.jsx.
-- ================================================================
create table if not exists public.cobrancas (
  id uuid primary key default gen_random_uuid(),
  clinica_id text not null default 'gio' check (clinica_id = 'gio'),
  nome_cliente text not null,
  whatsapp text,
  forma_pagamento text not null check (forma_pagamento in ('recorrente','boleto')),
  dia_vencimento smallint not null check (dia_vencimento between 1 and 31),
  valor_parcela numeric,
  numero_parcelas int not null default 1 check (numero_parcelas > 0),
  parcelas_pagas int not null default 0 check (parcelas_pagas >= 0 and parcelas_pagas <= numero_parcelas),
  observacoes text,
  ativo boolean not null default true,
  criado_por uuid references public.profiles(id),
  criado_em timestamptz not null default now()
);

alter table public.cobrancas drop constraint if exists cobrancas_valor_parcela_check;
alter table public.cobrancas add constraint cobrancas_valor_parcela_check check (valor_parcela is null or valor_parcela >= 0);

alter table public.cobrancas enable row level security;

-- Mesmo padrão de acesso do resto da GIO: técnico nunca vê (não tem relação
-- com o funil comercial), gestor sempre vê, gerente/base da GIO veem tudo.
drop policy if exists "cobrancas_select" on public.cobrancas;
create policy "cobrancas_select" on public.cobrancas for select to authenticated
using (
  public.my_role() = 'owner'
  or (public.my_role() <> 'tecnico' and public.my_clinica() = 'gio')
);

drop policy if exists "cobrancas_insert" on public.cobrancas;
create policy "cobrancas_insert" on public.cobrancas for insert to authenticated
with check (
  public.my_role() = 'owner'
  or (public.my_role() <> 'tecnico' and public.my_clinica() = 'gio')
);

drop policy if exists "cobrancas_update" on public.cobrancas;
create policy "cobrancas_update" on public.cobrancas for update to authenticated
using (
  public.my_role() = 'owner'
  or (public.my_role() <> 'tecnico' and public.my_clinica() = 'gio')
)
with check (
  public.my_role() = 'owner'
  or (public.my_role() <> 'tecnico' and public.my_clinica() = 'gio')
);

drop policy if exists "cobrancas_delete" on public.cobrancas;
create policy "cobrancas_delete" on public.cobrancas for delete to authenticated
using (
  public.my_role() = 'owner'
  or (public.my_role() = 'gerente' and public.my_clinica() = 'gio')
);

create index if not exists idx_cobrancas_ativo on public.cobrancas (clinica_id, ativo);

-- Liga a tarefa gerada automaticamente à cobrança que a originou (some
-- junto se a cobrança for excluída, mas a tarefa em si fica).
alter table public.tasks add column if not exists cobranca_id uuid references public.cobrancas(id) on delete set null;

-- Trava no banco contra tarefa duplicada pro mesmo ciclo de cobrança —
-- backstop pro "verificação ao abrir o app" (sem pg_cron, dá pra duas
-- pessoas abrirem o app quase ao mesmo tempo e tentarem gerar a mesma
-- tarefa; essa constraint garante que só uma sobrevive).
create unique index if not exists idx_tasks_cobranca_prazo_uniq on public.tasks (cobranca_id, prazo) where cobranca_id is not null;

-- O app não tem nenhuma tela/ação anônima (sempre exige login), então essas
-- funções auxiliares nunca deveriam ser chamáveis por quem não está
-- logado — por padrão o Postgres concede EXECUTE pra PUBLIC (que "anon" e
-- "authenticated" herdam), então é preciso revogar de PUBLIC e devolver só
-- pra "authenticated" (que é quem as políticas de RLS realmente precisam).
revoke execute on function public.my_role() from public;
revoke execute on function public.my_clinica() from public;
revoke execute on function public.can_access_task(uuid) from public;
revoke execute on function public.estoque_check_update() from public;
revoke execute on function public.indicacao_processar() from public;
revoke execute on function public.reassign_before_profile_delete() from public;

grant execute on function public.my_role() to authenticated;
grant execute on function public.my_clinica() to authenticated;
grant execute on function public.can_access_task(uuid) to authenticated;
grant execute on function public.estoque_check_update() to authenticated;
grant execute on function public.indicacao_processar() to authenticated;
grant execute on function public.reassign_before_profile_delete() to authenticated;

-- Realtime: pra uma tarefa criada numa tela aparecer nas outras na hora.
-- Confere se a tabela já está inscrita antes de inscrever de novo (igual ao
-- resto do arquivo) — sem isso, colar o schema.sql inteiro uma segunda vez
-- dava erro aqui ("relation ... is already member of publication").
do $$
declare
  t text;
begin
  foreach t in array array[
    'tasks','profiles','task_attachments','task_comments',
    'task_checklist_items','task_activity','leads','estoque_itens','indicacoes',
    'cobrancas'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
