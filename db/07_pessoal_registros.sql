-- Cadastro completo de funcionários (estende "colaboradores") e registros genéricos de ferramentas (SST, folha etc.) com validade e vínculo ao funcionário.
-- Dados pessoais/saúde: LGPD (art. 5º, II e 11). Acesso restrito por tenant (RLS) e por papel (somente leitura para CLIENTE_LEITURA — aplicado na API).
ALTER TABLE cargos ADD COLUMN IF NOT EXISTS descricao text, ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
ALTER TABLE colaboradores
  ADD COLUMN IF NOT EXISTS nome_social text, ADD COLUMN IF NOT EXISTS rg text, ADD COLUMN IF NOT EXISTS pis_nis char(11), ADD COLUMN IF NOT EXISTS ctps text,
  ADD COLUMN IF NOT EXISTS estado_civil text, ADD COLUMN IF NOT EXISTS escolaridade text, ADD COLUMN IF NOT EXISTS telefone text, ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS cep text, ADD COLUMN IF NOT EXISTS logradouro text, ADD COLUMN IF NOT EXISTS numero text, ADD COLUMN IF NOT EXISTS complemento text,
  ADD COLUMN IF NOT EXISTS bairro text, ADD COLUMN IF NOT EXISTS cidade text, ADD COLUMN IF NOT EXISTS uf char(2),
  ADD COLUMN IF NOT EXISTS funcao text, ADD COLUMN IF NOT EXISTS setor text, ADD COLUMN IF NOT EXISTS cbo char(6),
  ADD COLUMN IF NOT EXISTS salario numeric(14,2), ADD COLUMN IF NOT EXISTS jornada_semanal numeric(5,2), ADD COLUMN IF NOT EXISTS tipo_contrato text,
  ADD COLUMN IF NOT EXISTS categoria_esocial text, ADD COLUMN IF NOT EXISTS dependentes smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pcd boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS aprendiz boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contato_emergencia text, ADD COLUMN IF NOT EXISTS observacoes text,
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true, ADD COLUMN IF NOT EXISTS atualizado_em timestamptz NOT NULL DEFAULT now();
CREATE TABLE registros (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  empresa_id     uuid REFERENCES empresas(id),
  funcionario_id uuid REFERENCES colaboradores(id) ON DELETE CASCADE,
  ferramenta     text NOT NULL,
  titulo         text,
  data_evento    date,
  data_validade  date,
  status         text NOT NULL DEFAULT 'ABERTO' CHECK (status IN ('ABERTO','CONCLUIDO','CANCELADO')),
  dados          jsonb NOT NULL DEFAULT '{}',
  criado_por     uuid, criado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_registros_busca ON registros (tenant_id, ferramenta, data_validade);
CREATE INDEX ix_registros_func ON registros (funcionario_id, criado_em DESC);
ALTER TABLE registros ENABLE ROW LEVEL SECURITY; ALTER TABLE registros FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON registros USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
