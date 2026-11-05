-- =====================================================================
-- SISTEMA GÊNESIS ERP — Schema PostgreSQL 15+
-- Multi-tenant por Row-Level Security (RLS): 1 banco, coluna tenant_id,
-- política aplicada via  SET LOCAL app.tenant_id = '<uuid>'  em cada transação.
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- busca fuzzy de históricos
CREATE EXTENSION IF NOT EXISTS ltree;      -- árvore do plano de contas

-- ---------- Tipos ----------
CREATE TYPE regime_tributario AS ENUM ('SIMPLES_NACIONAL','LUCRO_PRESUMIDO','LUCRO_REAL','LUCRO_ARBITRADO','IMUNE_ISENTA');
CREATE TYPE natureza_saldo    AS ENUM ('D','C');
-- Natureza da conta conforme tabela do registro I050 (COD_NAT) da ECD
CREATE TYPE cod_natureza_ecd  AS ENUM ('01','02','03','04','05','09'); -- Ativo, Passivo, PL, Resultado, Compensação, Outras
CREATE TYPE tipo_conta        AS ENUM ('S','A');                       -- Sintética / Analítica
CREATE TYPE origem_lancamento AS ENUM ('MANUAL','IMPORTACAO','CONCILIACAO','FOLHA','FISCAL','PATRIMONIO','ENCERRAMENTO','RATEIO');
CREATE TYPE status_periodo    AS ENUM ('ABERTO','FECHADO','ENCERRADO');

-- ---------- Função de tenant corrente (usada nas políticas RLS) ----------
CREATE OR REPLACE FUNCTION app_tenant() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- =====================================================================
-- 1. ESTRUTURA ORGANIZACIONAL
-- =====================================================================
CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  plano       text NOT NULL DEFAULT 'pro',
  ativo       boolean NOT NULL DEFAULT true,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE escritorios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  razao_social text NOT NULL,
  cnpj        char(14) NOT NULL,
  crc         text,                              -- registro do contador responsável
  UNIQUE (tenant_id, cnpj)
);

CREATE TABLE usuarios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  escritorio_id uuid REFERENCES escritorios(id),
  email       text NOT NULL,
  nome        text NOT NULL,
  papel       text NOT NULL CHECK (papel IN ('ADMIN','CONTADOR','AUXILIAR','CLIENTE_LEITURA')),
  UNIQUE (tenant_id, email)
);

CREATE TABLE empresas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  escritorio_id       uuid NOT NULL REFERENCES escritorios(id),
  cnpj                char(14) NOT NULL,
  razao_social        text NOT NULL,
  uf                  char(2) NOT NULL,
  cod_municipio_ibge  char(7),
  inscricao_estadual  text,
  inscricao_municipal text,
  nire                text,
  regime_tributario   regime_tributario NOT NULL,
  -- Tabela dinâmica de plano referencial da RFB (ECF): define qual aplicar
  plano_referencial_tipo text NOT NULL DEFAULT 'PJ_LUCRO_REAL'
        CHECK (plano_referencial_tipo IN ('PJ_LUCRO_REAL','PJ_LUCRO_PRESUMIDO','PJ_IMUNE_ISENTA','PJ_SEGURADORA','PJ_INSTIT_FINANC','PJ_PREVIDENCIA','PJ_SCP','PJ_COOPERATIVA')),
  mes_inicio_exercicio smallint NOT NULL DEFAULT 1 CHECK (mes_inicio_exercicio BETWEEN 1 AND 12),
  ativa               boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, cnpj)
);
CREATE INDEX ix_empresas_escritorio ON empresas (tenant_id, escritorio_id);

CREATE TABLE periodos_contabeis (
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  tenant_id   uuid NOT NULL,
  competencia date NOT NULL CHECK (competencia = date_trunc('month', competencia)::date),
  status      status_periodo NOT NULL DEFAULT 'ABERTO',
  PRIMARY KEY (empresa_id, competencia)
);

-- =====================================================================
-- 2. PLANO DE CONTAS
-- =====================================================================
-- Tabela global (sem tenant): plano referencial oficial da RFB, carga via ADE/Receita
CREATE TABLE plano_referencial_rfb (
  tipo          text NOT NULL,                  -- mesmo domínio de empresas.plano_referencial_tipo
  cod_cta_ref   text NOT NULL,                  -- ex.: 1.01.01.01.01
  descricao     text NOT NULL,
  natureza      natureza_saldo NOT NULL,        -- natureza esperada do saldo
  analitica     boolean NOT NULL,               -- só contas analíticas aceitam amarração
  vigente_de    date NOT NULL,
  vigente_ate   date,
  PRIMARY KEY (tipo, cod_cta_ref, vigente_de)
);

CREATE TABLE plano_contas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  empresa_id      uuid NOT NULL REFERENCES empresas(id),
  codigo          text NOT NULL,                -- máscara 1.1.1.01.0001
  codigo_reduzido integer NOT NULL,             -- "C.R." exibido no balancete
  descricao       text NOT NULL,
  pai_id          uuid REFERENCES plano_contas(id),
  caminho         ltree NOT NULL,               -- materialized path p/ somar subárvore sem CTE recursiva
  nivel           smallint NOT NULL,
  tipo            tipo_conta NOT NULL,
  cod_natureza    cod_natureza_ecd NOT NULL,
  natureza_saldo  natureza_saldo NOT NULL,      -- D (ativo/despesa) ou C (passivo/receita)
  aceita_cc       boolean NOT NULL DEFAULT false,
  redutora        boolean NOT NULL DEFAULT false,   -- (-) depreciação acumulada, PECLD...: saldo oposto é esperado
  ativa           boolean NOT NULL DEFAULT true,
  -- Amarração com o referencial (registro I051 da ECD)
  referencial_tipo text,
  cod_cta_ref     text,
  UNIQUE (empresa_id, codigo),
  UNIQUE (empresa_id, codigo_reduzido)
);
-- Analítica de balanço/resultado exige referencial. NOT VALID: permite importar legado
-- e deixa o linter reportar o que falta; rode VALIDATE CONSTRAINT quando estiver limpo.
ALTER TABLE plano_contas ADD CONSTRAINT ck_pc_referencial
  CHECK (tipo = 'S' OR cod_cta_ref IS NOT NULL OR cod_natureza IN ('05','09')) NOT VALID;
CREATE INDEX ix_pc_caminho_gist ON plano_contas USING gist (caminho);
CREATE INDEX ix_pc_pai          ON plano_contas (pai_id);
CREATE INDEX ix_pc_desc_trgm    ON plano_contas USING gin (descricao gin_trgm_ops);

CREATE TABLE historicos_padrao (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  codigo      integer NOT NULL,
  texto       text NOT NULL,                    -- aceita variáveis: {{documento}} {{participante}}
  UNIQUE (empresa_id, codigo)
);

-- =====================================================================
-- 3. CENTROS DE CUSTO E RATEIO
-- =====================================================================
CREATE TABLE centros_custo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  codigo      text NOT NULL,
  nome        text NOT NULL,
  pai_id      uuid REFERENCES centros_custo(id),
  ativo       boolean NOT NULL DEFAULT true,
  UNIQUE (empresa_id, codigo)
);

CREATE TABLE regras_rateio (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  empresa_id       uuid NOT NULL REFERENCES empresas(id),
  nome             text NOT NULL,
  conta_origem_id  uuid REFERENCES plano_contas(id),    -- NULL = aplica a qualquer conta de despesa
  centro_origem_id uuid REFERENCES centros_custo(id),
  vigente_de       date NOT NULL,
  vigente_ate      date
);
CREATE TABLE regras_rateio_itens (
  regra_id        uuid NOT NULL REFERENCES regras_rateio(id) ON DELETE CASCADE,
  centro_destino_id uuid NOT NULL REFERENCES centros_custo(id),
  percentual      numeric(9,6) NOT NULL CHECK (percentual > 0 AND percentual <= 100),
  PRIMARY KEY (regra_id, centro_destino_id)
);
-- Soma dos percentuais == 100 é validada na aplicação (e por trigger deferido, omitido por brevidade).

-- =====================================================================
-- 4. LANÇAMENTOS (PARTIDA DOBRADA)
-- =====================================================================
-- Modelo: cabeçalho (lançamento) + N partidas. Cada partida é uma perna D ou C.
-- Isso cobre 1:1, 1:N, N:1 e N:N sem duplicar colunas debito/credito
-- e mapeia 1:1 para os registros I200/I250 da ECD.
CREATE SEQUENCE seq_numero_lancamento;

CREATE TABLE lancamentos_contabeis (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  empresa_id       uuid NOT NULL REFERENCES empresas(id),
  numero           bigint NOT NULL DEFAULT nextval('seq_numero_lancamento'),   -- NUM_LCTO
  data             date NOT NULL,
  competencia      date GENERATED ALWAYS AS (make_date(extract(year FROM data)::int, extract(month FROM data)::int, 1)) STORED,
  tipo_lcto        char(1) NOT NULL DEFAULT 'N' CHECK (tipo_lcto IN ('N','E','X')), -- Normal / Encerramento / Extemporâneo (I200.IND_LCTO)
  origem           origem_lancamento NOT NULL DEFAULT 'MANUAL',
  documento        text,
  historico_padrao_id uuid REFERENCES historicos_padrao(id),
  complemento      text,
  -- Idempotência de integrações: mesmo evento externo nunca gera 2 lançamentos
  origem_evento_id uuid,
  criado_por       uuid REFERENCES usuarios(id),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero)
);
CREATE UNIQUE INDEX ux_lcto_origem_evento ON lancamentos_contabeis (empresa_id, origem_evento_id) WHERE origem_evento_id IS NOT NULL;
CREATE INDEX ix_lcto_empresa_data ON lancamentos_contabeis (empresa_id, data);
CREATE INDEX ix_lcto_competencia  ON lancamentos_contabeis (empresa_id, competencia);

CREATE TABLE partidas (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  empresa_id     uuid NOT NULL,
  lancamento_id  uuid NOT NULL REFERENCES lancamentos_contabeis(id) ON DELETE CASCADE,
  data           date NOT NULL,                              -- desnormalizado p/ índices do razão
  conta_id       uuid NOT NULL REFERENCES plano_contas(id),
  dc             natureza_saldo NOT NULL,                    -- 'D' = débito, 'C' = crédito
  valor          numeric(18,2) NOT NULL CHECK (valor > 0),
  centro_custo_id uuid REFERENCES centros_custo(id),
  historico      text,                                       -- complemento da perna (I250.HIST)
  cod_participante text
);
CREATE INDEX ix_partidas_lcto        ON partidas (lancamento_id);
CREATE INDEX ix_partidas_razao       ON partidas (empresa_id, conta_id, data) INCLUDE (dc, valor);
CREATE INDEX ix_partidas_cc          ON partidas (empresa_id, centro_custo_id, data) WHERE centro_custo_id IS NOT NULL;

-- Garantia final, no banco, de que ΣD = ΣC — vale mesmo que alguém grave por fora da API.
-- CONSTRAINT TRIGGER deferido: roda no COMMIT, depois de todas as pernas inseridas.
CREATE OR REPLACE FUNCTION fn_valida_partida_dobrada() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_lcto uuid; v_d numeric; v_c numeric; v_n int;
BEGIN
  v_lcto := COALESCE(NEW.lancamento_id, OLD.lancamento_id);
  SELECT COALESCE(SUM(valor) FILTER (WHERE dc='D'),0),
         COALESCE(SUM(valor) FILTER (WHERE dc='C'),0), COUNT(*)
    INTO v_d, v_c, v_n FROM partidas WHERE lancamento_id = v_lcto;
  IF v_n > 0 AND v_d <> v_c THEN
    RAISE EXCEPTION 'Lançamento % desbalanceado: débitos=% créditos=%', v_lcto, v_d, v_c
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_partida_dobrada
  AFTER INSERT OR UPDATE OR DELETE ON partidas
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_valida_partida_dobrada();

-- Só contas analíticas e ativas recebem partida; período fechado é imutável.
CREATE OR REPLACE FUNCTION fn_valida_partida_regras() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_tipo tipo_conta; v_ativa boolean; v_status status_periodo;
BEGIN
  SELECT tipo, ativa INTO v_tipo, v_ativa FROM plano_contas WHERE id = NEW.conta_id;
  IF v_tipo <> 'A' THEN RAISE EXCEPTION 'Conta sintética não aceita lançamento (conta_id=%)', NEW.conta_id; END IF;
  IF NOT v_ativa  THEN RAISE EXCEPTION 'Conta inativa (conta_id=%)', NEW.conta_id; END IF;
  SELECT status INTO v_status FROM periodos_contabeis
   WHERE empresa_id = NEW.empresa_id AND competencia = date_trunc('month', NEW.data)::date;
  IF v_status IS NOT NULL AND v_status <> 'ABERTO' THEN
    RAISE EXCEPTION 'Período % está %', to_char(NEW.data,'MM/YYYY'), v_status;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_partida_regras BEFORE INSERT OR UPDATE ON partidas
  FOR EACH ROW EXECUTE FUNCTION fn_valida_partida_regras();

-- Saldos mensais por conta analítica: base do balancete rápido (atualizado por worker/trigger).
CREATE TABLE saldos_mensais (
  empresa_id   uuid NOT NULL,
  tenant_id    uuid NOT NULL,
  conta_id     uuid NOT NULL REFERENCES plano_contas(id),
  centro_custo_id uuid,
  competencia  date NOT NULL,
  total_debito  numeric(18,2) NOT NULL DEFAULT 0,
  total_credito numeric(18,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id, conta_id, competencia) -- variante por CC: tabela separada / índice parcial
);

-- =====================================================================
-- 5. CONCILIAÇÃO BANCÁRIA
-- =====================================================================
CREATE TABLE contas_bancarias (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  banco_cod     char(3) NOT NULL,
  agencia       text, numero text,
  conta_contabil_id uuid NOT NULL REFERENCES plano_contas(id)   -- 1.1.1.02.xxxx
);

CREATE TABLE extratos_importados (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  conta_bancaria_id uuid NOT NULL REFERENCES contas_bancarias(id),
  formato       text NOT NULL CHECK (formato IN ('OFX','PDF','CSV')),
  hash_arquivo  char(64) NOT NULL,                               -- SHA-256: impede reimportar o mesmo arquivo
  periodo_ini   date, periodo_fim date,
  status        text NOT NULL DEFAULT 'PROCESSANDO' CHECK (status IN ('PROCESSANDO','PARSEADO','CONCILIADO','ERRO')),
  importado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conta_bancaria_id, hash_arquivo)
);

CREATE TABLE extrato_itens (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  extrato_id    uuid NOT NULL REFERENCES extratos_importados(id) ON DELETE CASCADE,
  conta_bancaria_id uuid NOT NULL,
  fitid         text NOT NULL,                                   -- ID único do banco (OFX FITID)
  data          date NOT NULL,
  valor         numeric(18,2) NOT NULL,                          -- sinal: + entrada, − saída
  descricao     text NOT NULL,
  descricao_norm text NOT NULL,                                  -- maiúsculas, sem acento/números de documento
  status        text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','SUGERIDO','CONCILIADO','IGNORADO')),
  lancamento_id uuid REFERENCES lancamentos_contabeis(id),
  UNIQUE (conta_bancaria_id, fitid)                              -- deduplicação entre extratos sobrepostos
);
CREATE INDEX ix_extrato_pend ON extrato_itens (conta_bancaria_id, status, data);
CREATE INDEX ix_extrato_trgm ON extrato_itens USING gin (descricao_norm gin_trgm_ops);

CREATE TABLE conciliacao_bancaria_regras (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  prioridade    integer NOT NULL DEFAULT 100,                    -- menor = avalia primeiro
  tipo_match    text NOT NULL CHECK (tipo_match IN ('CONTEM','COMECA_COM','IGUAL','REGEX')),
  padrao        text NOT NULL,                                   -- palavra-chave ou regex (case-insensitive)
  sinal         text NOT NULL DEFAULT 'AMBOS' CHECK (sinal IN ('ENTRADA','SAIDA','AMBOS')),
  valor_min     numeric(18,2), valor_max numeric(18,2),
  conta_contrapartida_id uuid NOT NULL REFERENCES plano_contas(id),
  historico_padrao_id uuid REFERENCES historicos_padrao(id),
  centro_custo_id uuid REFERENCES centros_custo(id),
  auto_confirmar boolean NOT NULL DEFAULT false,                 -- true: gera lançamento sem revisão humana
  acertos       integer NOT NULL DEFAULT 0,                      -- feedback loop (aceitas)
  rejeicoes     integer NOT NULL DEFAULT 0,
  ativa         boolean NOT NULL DEFAULT true
);
CREATE INDEX ix_regras_emp ON conciliacao_bancaria_regras (empresa_id, ativa, prioridade);

-- Dataset de treino para o classificador ML (aprendizado a partir das confirmações do contador)
CREATE TABLE conciliacao_feedback (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  empresa_id    uuid NOT NULL,
  descricao_norm text NOT NULL,
  sinal         char(1) NOT NULL,
  conta_id      uuid NOT NULL REFERENCES plano_contas(id),
  origem        text NOT NULL CHECK (origem IN ('REGRA','ML','MANUAL')),
  criado_em     timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- 6. BARRAMENTO DE INTEGRAÇÃO (Folha / Fiscal / Patrimônio)
-- =====================================================================
CREATE TABLE eventos_integracao (            -- INBOX idempotente
  id            uuid PRIMARY KEY,            -- id do evento gerado pelo módulo emissor
  tenant_id     uuid NOT NULL,
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  modulo        text NOT NULL CHECK (modulo IN ('FOLHA','FISCAL','PATRIMONIO')),
  tipo          text NOT NULL,               -- FOLHA.PROVISAO_FERIAS, FOLHA.GPS, FISCAL.NF_ENTRADA ...
  competencia   date NOT NULL,
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'RECEBIDO' CHECK (status IN ('RECEBIDO','CONTABILIZADO','ERRO','IGNORADO')),
  erro          text,
  recebido_em   timestamptz NOT NULL DEFAULT now(),
  processado_em timestamptz
);
CREATE INDEX ix_eventos_status ON eventos_integracao (status, recebido_em);

CREATE TABLE mapeamentos_evento_contabil (   -- "de-para" evento → partidas modelo
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  tipo_evento   text NOT NULL,
  rubrica       text NOT NULL,               -- chave do campo no payload (ex.: 'inss_empresa')
  conta_debito_id  uuid REFERENCES plano_contas(id),
  conta_credito_id uuid REFERENCES plano_contas(id),
  historico_padrao_id uuid REFERENCES historicos_padrao(id),
  UNIQUE (empresa_id, tipo_evento, rubrica)
);

-- =====================================================================
-- 7. LALUR / LACS (e-Lalur)
-- =====================================================================
CREATE TABLE lalur_lacs_parte_b (            -- contas de controle de saldos (prejuízo fiscal, diferenças temporárias)
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  tributo       text NOT NULL CHECK (tributo IN ('IRPJ','CSLL')),
  tipo_controle text NOT NULL CHECK (tipo_controle IN ('PREJUIZO_FISCAL','BASE_NEGATIVA_CSLL','DIFERENCA_TEMPORARIA','PROVISAO_INDEDUTIVEL','OUTRO')),
  descricao     text NOT NULL,
  conta_contabil_id uuid REFERENCES plano_contas(id),
  periodo_origem date NOT NULL,
  saldo_inicial numeric(18,2) NOT NULL DEFAULT 0,
  valor_constituido numeric(18,2) NOT NULL DEFAULT 0,
  valor_baixado   numeric(18,2) NOT NULL DEFAULT 0,  -- ex.: compensação limitada a 30% do lucro ajustado
  saldo_final   numeric(18,2) GENERATED ALWAYS AS (saldo_inicial + valor_constituido - valor_baixado) STORED,
  CHECK (saldo_inicial + valor_constituido - valor_baixado >= 0)
);
CREATE TABLE lalur_lacs_parte_a (            -- lançamentos de ajuste do período
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  tributo       text NOT NULL CHECK (tributo IN ('IRPJ','CSLL')),
  periodo_apuracao date NOT NULL,            -- início do trimestre/ano-calendário
  tipo          text NOT NULL CHECK (tipo IN ('ADICAO','EXCLUSAO','COMPENSACAO_PREJUIZO','LUCRO_EXPLORACAO','OUTRO')),
  descricao     text NOT NULL,
  conta_contabil_id uuid REFERENCES plano_contas(id),
  cod_lancamento_rfb text,                   -- tabela dinâmica de lançamentos da parte A (ECF)
  valor         numeric(18,2) NOT NULL CHECK (valor >= 0),
  conta_parte_b_id uuid REFERENCES lalur_lacs_parte_b(id)   -- ajuste temporário → controle na parte B
);

CREATE INDEX ix_lalur_a_emp ON lalur_lacs_parte_a (empresa_id, tributo, periodo_apuracao);
CREATE INDEX ix_lalur_b_emp ON lalur_lacs_parte_b (empresa_id, tributo, tipo_controle);

-- =====================================================================
-- 8. SPED — GERAÇÃO E PRÉ-VALIDAÇÃO
-- =====================================================================
CREATE TABLE sped_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  tipo          text NOT NULL CHECK (tipo IN ('ECD','ECF')),
  periodo_ini   date NOT NULL, periodo_fim date NOT NULL,
  status        text NOT NULL DEFAULT 'FILA' CHECK (status IN ('FILA','LINTING','GERANDO','CONCLUIDO','BLOQUEADO','ERRO')),
  arquivo_uri   text,
  hash_sha256   char(64),
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sped_advertencias (
  id            bigserial PRIMARY KEY,
  job_id        uuid NOT NULL REFERENCES sped_jobs(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL,
  regra         text NOT NULL,
  severidade    text NOT NULL CHECK (severidade IN ('ERRO','AVISO','INFO')),
  mensagem      text NOT NULL,
  conta_id      uuid, lancamento_id uuid
);

-- =====================================================================
-- 9. ROW-LEVEL SECURITY — aplicada a TODAS as tabelas com tenant_id
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
            WHERE table_schema='public' AND column_name='tenant_id'
              AND table_name NOT IN ('tenants')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                      USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())$p$, t);
  END LOOP;
END $$;
-- A aplicação conecta com role sem BYPASSRLS; migrações usam role própria.
