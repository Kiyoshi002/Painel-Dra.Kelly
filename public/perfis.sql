-- perfis.sql — rode no Supabase: SQL Editor → New query → cole → Run
-- Guarda quem pode usar o painel e se é administrador ou usuário comum.
-- Quem entra no Supabase Auth mas não está nesta tabela NÃO acessa nenhum dado.

create table if not exists perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  perfil text not null default 'usuario' check (perfil in ('admin', 'usuario')),
  ativo boolean not null default true,
  criado_em timestamptz default now()
);
alter table perfis enable row level security;

-- Depois de criar o seu usuário em Authentication → Users, rode (troque o e-mail e o nome):
--
-- insert into perfis (id, nome, perfil)
-- select id, 'Kiyoshi', 'admin' from auth.users where email = 'SEU@EMAIL.COM';
--
-- Para liberar outra pessoa como usuário comum:
--
-- insert into perfis (id, nome, perfil)
-- select id, 'Recepção', 'usuario' from auth.users where email = 'OUTRA@EMAIL.COM';
--
-- Para bloquear alguém sem apagar:  update perfis set ativo = false where nome = 'Recepção';
