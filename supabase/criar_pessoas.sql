-- ================================================================
-- Passo a passo pra cadastrar cada pessoa (rodar depois do schema.sql)
-- ================================================================
--
-- 1) No painel do Supabase, vá em Authentication > Users > Add user.
--    Crie um usuário para cada pessoa com um e-mail interno (não precisa
--    ser um e-mail real, ex: wagner@pulso.app) e uma senha. Marque a opção
--    "Auto Confirm User" se aparecer, pra não precisar confirmar por e-mail.
--
-- 2) Depois de criar cada usuário, copie o "User UID" dele (aparece na
--    lista de Authentication > Users) e cole no lugar de COLE_O_UUID_AQUI
--    abaixo, ajustando nome/papel/clínica/e-mail. Rode uma linha destas
--    pra cada pessoa, no SQL Editor.
--
-- role: 'owner' | 'gerente' | 'base'
-- clinica_id: 'sorridents' | 'gio'  (deixe null só para o owner)

-- Exemplo — Wagner (gestor):
-- insert into public.profiles (id, nome, role, clinica_id, login_email)
-- values ('COLE_O_UUID_AQUI', 'Wagner', 'owner', null, 'wagner@pulso.app');

-- Exemplo — gerente da Sorridents:
-- insert into public.profiles (id, nome, role, clinica_id, login_email)
-- values ('COLE_O_UUID_AQUI', 'Nome da gerente', 'gerente', 'sorridents', 'sorridents.gerente@pulso.app');

-- Exemplo — recepção da Sorridents:
-- insert into public.profiles (id, nome, role, clinica_id, login_email)
-- values ('COLE_O_UUID_AQUI', 'Nome da recepção', 'base', 'sorridents', 'sorridents.recepcao@pulso.app');

-- Exemplo — gerente da GIO:
-- insert into public.profiles (id, nome, role, clinica_id, login_email)
-- values ('COLE_O_UUID_AQUI', 'Nome da gerente', 'gerente', 'gio', 'gio.gerente@pulso.app');

-- Exemplo — comercial da GIO:
-- insert into public.profiles (id, nome, role, clinica_id, login_email)
-- values ('COLE_O_UUID_AQUI', 'Nome do comercial', 'base', 'gio', 'gio.comercial@pulso.app');
