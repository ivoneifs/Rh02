-- Normas e tabelas legais (INSS, IRRF, FGTS, rescisão, salário mínimo, Simples, eSocial/DCTFWeb/FGTS Digital...) por tenant, com vigência.
-- Alterações ficam no histórico (quem, quando, antes/depois). Atualizações automáticas entram como RASCUNHO até um ADMIN aprovar.
CREATE TABLE normas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  categoria      text NOT NULL,
  codigo         text NOT NULL,
  descricao      text NOT NULL,
  valor          jsonb NOT NULL,
  vigencia_ini   date NOT NULL,
  vigencia_fim   date,
  fonte_url      text,
  status         text NOT NULL DEFAULT 'VIGENTE' CHECK (status IN ('VIGENTE','RASCUNHO','ARQUIVADO')),
  verificado     boolean NOT NULL DEFAULT false,
  observacao     text,
  atualizado_por uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, codigo, vigencia_ini, status)
);
CREATE INDEX ix_normas_busca ON normas (tenant_id, categoria, codigo, vigencia_ini DESC);
CREATE TABLE normas_historico (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  norma_id    uuid,
  codigo      text NOT NULL,
  acao        text NOT NULL,
  antes       jsonb, depois jsonb,
  usuario_id  uuid,
  em          timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['normas','normas_historico'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP; END $$;
