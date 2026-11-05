-- Pasta do funcionário: documentos enviados (PDF/imagem) com validade e análise da IA.
CREATE TABLE docs_func (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  empresa_id     uuid NOT NULL,
  funcionario_id uuid NOT NULL,
  tipo           text NOT NULL,
  titulo         text,
  nome_arquivo   text NOT NULL,
  mime           text NOT NULL CHECK (mime IN ('application/pdf','image/jpeg','image/png','image/webp')),
  tamanho        integer NOT NULL,
  dados          bytea NOT NULL,
  data_emissao   date,
  data_validade  date,
  analise        jsonb,
  analisado_em   timestamptz,
  status         text NOT NULL DEFAULT 'ENVIADO' CHECK (status IN ('ENVIADO','CONFERIDO','REJEITADO')),
  obs            text,
  criado_por     uuid,
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_docs_func ON docs_func (tenant_id, funcionario_id, tipo);
CREATE INDEX ix_docs_func_emp ON docs_func (tenant_id, empresa_id);
ALTER TABLE docs_func ENABLE ROW LEVEL SECURITY; ALTER TABLE docs_func FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON docs_func USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

-- Contato do colaborador por WhatsApp (número com DDD; pode ser diferente do telefone).
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS whatsapp text;
