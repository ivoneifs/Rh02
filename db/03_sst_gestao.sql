-- =====================================================================
-- SST — Gestão, Atendimento, Rede credenciada, Financeiro, Documentos (GED), Auditoria, IA
-- Requer 01 e 02. Aqui o "tenant" é a PRESTADORA de SST (ou o escritório) e as "empresas" são os clientes atendidos.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- EXCLUDE por intervalo de tempo

-- ---------- Rede credenciada (SGGNet) ----------
CREATE TABLE credenciados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  cnpj char(14) NOT NULL, nome text NOT NULL, uf char(2) NOT NULL, cidade text NOT NULL,
  servicos text[] NOT NULL DEFAULT '{}', ativo boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, cnpj)
);

-- ---------- Atendimento digital: solicitação e agendamento ----------
CREATE TABLE solicitacoes_exame (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id), colaborador_id uuid NOT NULL REFERENCES colaboradores(id),
  tipo_aso text NOT NULL CHECK (tipo_aso IN ('ADMISSIONAL','PERIODICO','RETORNO_AO_TRABALHO','MUDANCA_DE_RISCO','DEMISSIONAL')),
  exames uuid[] NOT NULL,                       -- derivados de pcmso_exames_cargo
  credenciado_id uuid REFERENCES credenciados(id),
  origem text NOT NULL DEFAULT 'PAINEL' CHECK (origem IN ('PAINEL','LOTE','AUTOMATICA_VENCIMENTO','PORTAL_CLIENTE')),
  status text NOT NULL DEFAULT 'SOLICITADA' CHECK (status IN ('SOLICITADA','AGENDADA','REALIZADA','CANCELADA','FALTOU')),
  solicitado_em timestamptz NOT NULL DEFAULT now(), aso_id uuid REFERENCES asos(id)
);
CREATE TABLE agenda_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  credenciado_id uuid REFERENCES credenciados(id), profissional text,
  inicio timestamptz NOT NULL, fim timestamptz NOT NULL CHECK (fim > inicio),
  solicitacao_id uuid UNIQUE REFERENCES solicitacoes_exame(id),    -- 1 solicitação por slot
  EXCLUDE USING gist (profissional WITH =, tstzrange(inicio, fim) WITH &&) WHERE (profissional IS NOT NULL)  -- sem conflito de agenda
);

-- ---------- Financeiro ----------
CREATE TABLE tabela_precos (                    -- valor por cliente, convênio ou credenciado
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  escopo text NOT NULL CHECK (escopo IN ('CLIENTE','CONVENIO','CREDENCIADO','PADRAO')),
  empresa_id uuid REFERENCES empresas(id), credenciado_id uuid REFERENCES credenciados(id),
  servico text NOT NULL,                        -- 'ASO_ADMISSIONAL', 'AUDIOMETRIA', 'LTCAT', 'PGR'...
  valor numeric(18,2) NOT NULL CHECK (valor >= 0), vigente_de date NOT NULL, vigente_ate date
);
CREATE INDEX ix_preco ON tabela_precos (tenant_id, servico, escopo, vigente_de);
CREATE TABLE faturas_sst (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id), competencia date NOT NULL,
  total numeric(18,2) NOT NULL DEFAULT 0, vencimento date NOT NULL,
  status text NOT NULL DEFAULT 'ABERTA' CHECK (status IN ('ABERTA','EMITIDA','PAGA','CANCELADA')),
  nfse_numero text, boleto_nosso_numero text, pago_em date,
  UNIQUE (empresa_id, competencia)
);
CREATE TABLE faturas_sst_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  fatura_id uuid NOT NULL REFERENCES faturas_sst(id) ON DELETE CASCADE,
  servico text NOT NULL, descricao text, valor numeric(18,2) NOT NULL,
  origem_tabela text, origem_id uuid,           -- aso/solicitação/documento que gerou o item (faturamento por serviço REALIZADO)
  UNIQUE (origem_tabela, origem_id)             -- impede cobrar o mesmo serviço duas vezes
);
CREATE TABLE repasses_credenciado (             -- a pagar: valida fatura do credenciado × serviços efetivamente prestados
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  credenciado_id uuid NOT NULL REFERENCES credenciados(id), competencia date NOT NULL,
  valor_apurado numeric(18,2) NOT NULL, valor_faturado_pelo_credenciado numeric(18,2),
  divergencia numeric(18,2) GENERATED ALWAYS AS (COALESCE(valor_faturado_pelo_credenciado, valor_apurado) - valor_apurado) STORED,
  status text NOT NULL DEFAULT 'APURADO' CHECK (status IN ('APURADO','EM_CONFERENCIA','APROVADO','PAGO')),
  UNIQUE (credenciado_id, competencia)
);

-- ---------- FAP (dados de apoio; a contestação é feita no FAPWeb, fora do sistema) ----------
CREATE TABLE fap_indices_importados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id), ano_vigencia smallint NOT NULL,
  fap numeric(6,4), freq numeric(8,4), gravidade numeric(8,4), custo numeric(8,4), importado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, ano_vigencia)
);
CREATE TABLE fap_beneficios_cnpj (              -- benefícios atribuídos ao CNPJ (para conferir inconsistências)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id), numero_beneficio text NOT NULL, especie text,
  colaborador_cpf char(11), acidente_id uuid REFERENCES acidentes_trabalho(id),   -- vínculo com CAT = sem CAT correspondente é suspeito
  situacao_conferencia text NOT NULL DEFAULT 'PENDENTE' CHECK (situacao_conferencia IN ('PENDENTE','CONSISTENTE','INCONSISTENTE')),
  UNIQUE (empresa_id, numero_beneficio)
);

-- ---------- Documentos (GED) com modelos, versões e assinatura ----------
CREATE TABLE doc_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  tipo text NOT NULL,                           -- PGR, PCMSO, LTCAT, ASO, FICHA_EPI, OS, CERTIFICADO...
  nome text NOT NULL, conteudo_html text NOT NULL, variaveis text[] NOT NULL DEFAULT '{}', ativo boolean NOT NULL DEFAULT true
);
CREATE TABLE doc_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id), colaborador_id uuid REFERENCES colaboradores(id),
  categoria text NOT NULL, titulo text NOT NULL,
  versao integer NOT NULL DEFAULT 1, doc_pai_id uuid REFERENCES doc_arquivos(id),     -- cadeia de versões
  arquivo_uri text NOT NULL, hash_sha256 char(64) NOT NULL, tamanho_bytes bigint,
  assinatura_tipo text CHECK (assinatura_tipo IN ('A1','A3','BIOMETRIA','NENHUMA')), assinado_em timestamptz,
  compartilhado_portal boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_doc_colab ON doc_arquivos (empresa_id, colaborador_id, categoria);
CREATE TABLE doc_acessos (                      -- quem abriu/baixou: rastreabilidade exigida p/ PPP e dado de saúde
  id bigserial PRIMARY KEY, tenant_id uuid NOT NULL, doc_id uuid NOT NULL REFERENCES doc_arquivos(id),
  usuario_id uuid, acao text NOT NULL CHECK (acao IN ('VISUALIZAR','BAIXAR','COMPARTILHAR','ASSINAR')), em timestamptz NOT NULL DEFAULT now()
);

-- ---------- Auditoria (log de operações) e uso de IA ----------
CREATE TABLE auditoria_log (
  id bigserial PRIMARY KEY, tenant_id uuid NOT NULL, usuario_id uuid, em timestamptz NOT NULL DEFAULT now(),
  entidade text NOT NULL, entidade_id text, acao text NOT NULL CHECK (acao IN ('CRIAR','ALTERAR','EXCLUIR','LER_SENSIVEL','ASSINAR','ENVIAR_ESOCIAL')),
  antes jsonb, depois jsonb, ip inet
);
CREATE INDEX ix_audit ON auditoria_log (tenant_id, em DESC, entidade);
CREATE TABLE ia_uso (
  id bigserial PRIMARY KEY, tenant_id uuid NOT NULL, usuario_id uuid, em timestamptz NOT NULL DEFAULT now(),
  funcao text NOT NULL CHECK (funcao IN ('ANALISE_EXAME','RISCO_POR_FOTO','RESUMO_CLINICO','RELATORIO_PCMSO','ASSISTENTE','TEXTO')),
  tokens integer NOT NULL CHECK (tokens >= 0),
  revisado_por_profissional boolean NOT NULL DEFAULT false      -- IA é rascunho; decisão e assinatura são humanas
);

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['credenciados','solicitacoes_exame','agenda_slots','tabela_precos','faturas_sst','faturas_sst_itens','repasses_credenciado',
        'fap_indices_importados','fap_beneficios_cnpj','doc_modelos','doc_arquivos','doc_acessos','auditoria_log','ia_uso'])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())$p$, t);
  END LOOP;
END $$;
-- Auditoria é append-only: a role da aplicação não pode alterar nem apagar.
CREATE RULE auditoria_sem_update AS ON UPDATE TO auditoria_log DO INSTEAD NOTHING;
CREATE RULE auditoria_sem_delete AS ON DELETE TO auditoria_log DO INSTEAD NOTHING;
