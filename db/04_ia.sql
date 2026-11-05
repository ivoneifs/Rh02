-- Configuração do agente de IA por tenant. A chave da OpenAI é guardada CRIPTOGRAFADA (AES-256-GCM, mestre em IA_MASTER_KEY,
-- fora do banco): um dump do banco sozinho não revela a chave. A API nunca devolve a chave; só os 4 últimos caracteres.
CREATE TABLE tenant_ia_config (
  tenant_id        uuid PRIMARY KEY REFERENCES tenants(id),
  provedor         text NOT NULL DEFAULT 'openai' CHECK (provedor IN ('openai')),
  api_key_enc      bytea,                       -- iv(12) | tag(16) | ciphertext
  key_ultimos4     text,
  modelo           text NOT NULL DEFAULT 'gpt-4o-mini',
  limite_tokens_mes integer NOT NULL DEFAULT 200000 CHECK (limite_tokens_mes >= 0),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant_ia_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_ia_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_ia_config USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

ALTER TABLE ia_uso DROP CONSTRAINT ia_uso_funcao_check;
ALTER TABLE ia_uso ADD CONSTRAINT ia_uso_funcao_check
  CHECK (funcao IN ('ANALISE_EXAME','RISCO_POR_FOTO','RESUMO_CLINICO','RELATORIO_PCMSO','ASSISTENTE','TEXTO','AGENTE'));
CREATE INDEX ix_ia_uso_mes ON ia_uso (tenant_id, em);
