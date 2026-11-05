-- Autenticação (login/senha) e sessões. Tabelas GLOBAIS (sem RLS) porque o login acontece ANTES de se conhecer o tenant:
-- só guardam hash de senha e hash de token; são acessadas exclusivamente por api/src/auth.ts.
CREATE TABLE auth_contas (
  usuario_id     uuid PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  email          text NOT NULL,
  senha_hash     text NOT NULL,                       -- scrypt$N$r$p$salt$hash
  ativo          boolean NOT NULL DEFAULT true,
  falhas         integer NOT NULL DEFAULT 0,
  bloqueado_ate  timestamptz,
  ultimo_login   timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_auth_contas_email ON auth_contas (lower(email));

CREATE TABLE auth_sessoes (
  token_hash  bytea PRIMARY KEY,                      -- sha256 do token (o token em si só existe no cookie)
  usuario_id  uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  papel       text NOT NULL,
  criada_em   timestamptz NOT NULL DEFAULT now(),
  expira_em   timestamptz NOT NULL
);
CREATE INDEX ix_auth_sessoes_usuario ON auth_sessoes (usuario_id);
CREATE INDEX ix_auth_sessoes_expira ON auth_sessoes (expira_em);
