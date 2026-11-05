-- Fotos/anexos (imagens) ligados a funcionário, registro ou empresa; guardados no banco (limite por arquivo aplicado pela API).
CREATE TABLE anexos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  alvo_tipo  text NOT NULL CHECK (alvo_tipo IN ('funcionario','registro','empresa')),
  alvo_id    uuid NOT NULL,
  nome       text NOT NULL,
  mime       text NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  tamanho    integer NOT NULL,
  legenda    text,
  dados      bytea NOT NULL,
  criado_por uuid,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_anexos_alvo ON anexos (tenant_id, alvo_tipo, alvo_id, criado_em);
ALTER TABLE anexos ENABLE ROW LEVEL SECURITY; ALTER TABLE anexos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON anexos USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
