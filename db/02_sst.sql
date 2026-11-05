-- =====================================================================
-- MÓDULO SST (Saúde e Segurança do Trabalho) — requer 01_schema.sql
-- Mesmo modelo multi-tenant (RLS). Dados de saúde são DADOS SENSÍVEIS (LGPD art. 5º, II):
-- tabelas de prontuário/ASO têm política adicional por papel (ver seção 9).
-- =====================================================================

-- ---------- 0. Cadastro-base de pessoal (compartilhado com Folha/RH) ----------
CREATE TABLE cargos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  codigo text NOT NULL, nome text NOT NULL, cbo char(6),
  UNIQUE (empresa_id, codigo)
);
CREATE TABLE ambientes_trabalho (            -- base do S-1060 / local de exposição do S-2240
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  nome text NOT NULL, tipo text NOT NULL DEFAULT 'ESTABELECIMENTO_PROPRIO'
     CHECK (tipo IN ('ESTABELECIMENTO_PROPRIO','TERCEIROS','OBRA','RURAL','OUTRO')),
  descricao text, croqui_uri text,
  ativo boolean NOT NULL DEFAULT true
);
CREATE TABLE colaboradores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  cpf char(11) NOT NULL, nome text NOT NULL, data_nascimento date, sexo char(1),
  matricula text NOT NULL, data_admissao date NOT NULL, data_demissao date,
  cargo_id uuid REFERENCES cargos(id),
  ambiente_id uuid REFERENCES ambientes_trabalho(id),
  UNIQUE (empresa_id, matricula), UNIQUE (empresa_id, cpf)
);
CREATE INDEX ix_colab_emp ON colaboradores (empresa_id, data_demissao);

-- ---------- 1. PGR / GRO ----------
CREATE TABLE ghe (                            -- Grupo Homogêneo de Exposição / grupo similar
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  codigo text NOT NULL, nome text NOT NULL, descricao_atividades text,
  UNIQUE (empresa_id, codigo)
);
CREATE TABLE ghe_cargos (ghe_id uuid REFERENCES ghe(id) ON DELETE CASCADE, cargo_id uuid REFERENCES cargos(id), ambiente_id uuid REFERENCES ambientes_trabalho(id),
  PRIMARY KEY (ghe_id, cargo_id));

-- Catálogo de agentes/fatores de risco. Global (sem tenant): inclui a Tabela 24 do eSocial.
CREATE TABLE agentes_risco (
  codigo_esocial text PRIMARY KEY,            -- ex.: '01.01.001' (Tabela 24) — carga versionada oficial
  categoria text NOT NULL CHECK (categoria IN ('FISICO','QUIMICO','BIOLOGICO','ERGONOMICO','ACIDENTE','PSICOSSOCIAL','AUSENCIA_RISCO')),
  descricao text NOT NULL, tipo_avaliacao text CHECK (tipo_avaliacao IN ('QUALITATIVA','QUANTITATIVA')),
  unidade text, limite_tolerancia numeric, aposentadoria_especial_anos smallint CHECK (aposentadoria_especial_anos IN (15,20,25))
);

-- Matriz configurável: dimensões (≥2) com níveis e pesos + faixas de classificação (ver src/sst/matriz-risco.ts)
CREATE TABLE matrizes_risco (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid REFERENCES empresas(id),    -- NULL = modelo do tenant
  nome text NOT NULL, config jsonb NOT NULL,  -- {dimensoes:[{id,niveis:[{valor,rotulo}]}], metodo, faixas:[{ate,rotulo,cor}]}
  padrao boolean NOT NULL DEFAULT false
);

CREATE TABLE pgr_documentos (                 -- PGR / PGRTR / PAE, versionados
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  tipo text NOT NULL CHECK (tipo IN ('PGR','PGRTR','PAE')),
  versao integer NOT NULL, vigencia_ini date NOT NULL, vigencia_fim date,
  status text NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN ('RASCUNHO','EM_REVISAO','APROVADO','ASSINADO','OBSOLETO')),
  responsavel_tecnico text, arquivo_uri text, hash_sha256 char(64),
  UNIQUE (empresa_id, tipo, versao)
);

CREATE TABLE inventario_riscos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  pgr_id uuid NOT NULL REFERENCES pgr_documentos(id),
  ghe_id uuid NOT NULL REFERENCES ghe(id),
  ambiente_id uuid REFERENCES ambientes_trabalho(id),
  agente_codigo text NOT NULL REFERENCES agentes_risco(codigo_esocial),
  fonte_geradora text, perigo text, possiveis_danos text,
  -- avaliação quantitativa (ex.: ruído 87 dB(A)); NULL se qualitativa
  intensidade numeric, unidade text, tecnica_utilizada text,
  exposicao_habitual_permanente boolean NOT NULL DEFAULT true,
  -- classificação via matriz
  matriz_id uuid REFERENCES matrizes_risco(id),
  valores_matriz jsonb,                        -- {severidade:3, probabilidade:2}
  nivel_risco text, pontuacao numeric,
  epc_eficaz boolean, epi_eficaz boolean,      -- alimentam S-2240 (campos de eficácia)
  medidas_prevencao text,
  avaliado_em date NOT NULL
);
CREATE INDEX ix_inv_ghe ON inventario_riscos (empresa_id, ghe_id);

CREATE TABLE plano_acao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  origem text NOT NULL CHECK (origem IN ('INVENTARIO','PSICOSSOCIAL','AUDITORIA','ACIDENTE','CIPA')),
  inventario_risco_id uuid REFERENCES inventario_riscos(id),
  psicossocial_resultado_id uuid,
  descricao text NOT NULL, prioridade smallint NOT NULL CHECK (prioridade BETWEEN 1 AND 5),
  responsavel text, prazo date NOT NULL,
  status text NOT NULL DEFAULT 'ABERTA' CHECK (status IN ('ABERTA','EM_ANDAMENTO','CONCLUIDA','CANCELADA')),
  concluida_em date, evidencias_uri text[]
);
CREATE INDEX ix_plano_prazo ON plano_acao (empresa_id, status, prazo);

-- ---------- 2. EPI / EPC (NR-6) ----------
CREATE TABLE epi_catalogo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  nome text NOT NULL, numero_ca text NOT NULL, validade_ca date NOT NULL,
  vida_util_dias integer, estoque_minimo numeric NOT NULL DEFAULT 0, unidade text NOT NULL DEFAULT 'UN',
  UNIQUE (empresa_id, numero_ca, nome)
);
CREATE TABLE epi_lotes (                      -- entrada via NF-e (XML) e rastreabilidade por lote
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  epi_id uuid NOT NULL REFERENCES epi_catalogo(id),
  lote text NOT NULL, chave_nfe char(44), data_entrada date NOT NULL, validade_lote date,
  qtd_entrada numeric NOT NULL CHECK (qtd_entrada > 0), qtd_saldo numeric NOT NULL CHECK (qtd_saldo >= 0),
  custo_unitario numeric(18,4) NOT NULL DEFAULT 0,
  UNIQUE (epi_id, lote)
);
CREATE TABLE epi_entregas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  colaborador_id uuid NOT NULL REFERENCES colaboradores(id),
  epi_id uuid NOT NULL REFERENCES epi_catalogo(id),
  lote_id uuid NOT NULL REFERENCES epi_lotes(id),
  ca_no_ato text NOT NULL,                    -- congela o CA vigente na entrega (prova)
  qtd numeric NOT NULL CHECK (qtd > 0), entregue_em timestamptz NOT NULL DEFAULT now(),
  validade_uso date,                          -- entregue_em + vida útil
  tipo_assinatura text NOT NULL CHECK (tipo_assinatura IN ('BIOMETRIA_FACIAL','BIOMETRIA_DIGITAL','ASSINATURA_ELETRONICA','FISICA_DIGITALIZADA')),
  evidencia_uri text, hash_evidencia char(64), -- guardar prova/hash, não o template biométrico bruto
  devolvido_em timestamptz, motivo_devolucao text
);
CREATE INDEX ix_epi_ent_colab ON epi_entregas (colaborador_id, entregue_em);
CREATE INDEX ix_epi_ent_validade ON epi_entregas (empresa_id, validade_uso) WHERE devolvido_em IS NULL;

CREATE TABLE epc_equipamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id), ambiente_id uuid REFERENCES ambientes_trabalho(id),
  nome text NOT NULL, periodicidade_manutencao_dias integer, periodicidade_calibracao_dias integer
);
CREATE TABLE epc_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  epc_id uuid NOT NULL REFERENCES epc_equipamentos(id),
  tipo text NOT NULL CHECK (tipo IN ('CALIBRACAO','MANUTENCAO','INSPECAO','AVALIACAO_EFICACIA')),
  realizado_em date NOT NULL, proximo_em date, eficaz boolean, laudo_uri text
);

-- ---------- 3. RISCOS PSICOSSOCIAIS (NR-1) ----------
-- ANONIMATO POR DESENHO: respostas NÃO referenciam colaborador. O "token" de participação fica em outra
-- tabela, sem ligação com o conteúdo das respostas; relatórios só exibem grupos com n >= k_minimo.
CREATE TABLE psicossocial_campanhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  instrumento text NOT NULL,                  -- 'COPSOQ_II_CURTO','COPSOQ_II_MEDIO','HSE_IT','CUSTOM'
  definicao jsonb NOT NULL,                   -- dimensões, itens, escala, itens invertidos, faixas
  abre_em date NOT NULL, fecha_em date NOT NULL,
  k_minimo smallint NOT NULL DEFAULT 5 CHECK (k_minimo >= 3),
  canal_envio text[] NOT NULL DEFAULT '{EMAIL}',
  status text NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN ('RASCUNHO','ABERTA','ENCERRADA','ANALISADA'))
);
CREATE TABLE psicossocial_convites (          -- quem foi convidado/respondeu (SEM resposta associada)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  campanha_id uuid NOT NULL REFERENCES psicossocial_campanhas(id) ON DELETE CASCADE,
  colaborador_id uuid NOT NULL REFERENCES colaboradores(id),
  token_hash char(64) NOT NULL UNIQUE,        -- hash do link único; o link em si não é guardado
  respondido boolean NOT NULL DEFAULT false,
  UNIQUE (campanha_id, colaborador_id)
);
CREATE TABLE psicossocial_respostas (
  id bigserial PRIMARY KEY, tenant_id uuid NOT NULL,
  campanha_id uuid NOT NULL REFERENCES psicossocial_campanhas(id) ON DELETE CASCADE,
  grupo_id uuid,                              -- ghe/setor do respondente (agregação), nunca o colaborador
  respostas jsonb NOT NULL,                   -- {item_id: valor}
  enviada_em date NOT NULL DEFAULT current_date  -- só a data: sem timestamp que permita correlacionar com o convite
);
CREATE TABLE psicossocial_resultados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  campanha_id uuid NOT NULL REFERENCES psicossocial_campanhas(id) ON DELETE CASCADE,
  grupo_id uuid, dimensao text NOT NULL, n_respondentes integer NOT NULL,
  media numeric(6,2), classificacao text CHECK (classificacao IN ('BAIXO','MODERADO','ALTO','CRITICO')),
  suprimido boolean NOT NULL DEFAULT false    -- true quando n < k_minimo
);
ALTER TABLE plano_acao ADD FOREIGN KEY (psicossocial_resultado_id) REFERENCES psicossocial_resultados(id);

-- ---------- 4. MEDICINA DO TRABALHO: PCMSO / ASO ----------
CREATE TABLE exames_catalogo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  nome text NOT NULL, codigo_esocial text,    -- Tabela 27 (procedimentos diagnósticos)
  tipo text NOT NULL DEFAULT 'COMPLEMENTAR' CHECK (tipo IN ('CLINICO','COMPLEMENTAR'))
);
CREATE TABLE pcmso_programas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  versao integer NOT NULL, vigencia_ini date NOT NULL, vigencia_fim date,
  medico_coordenador text NOT NULL, crm text NOT NULL, crm_uf char(2) NOT NULL,
  status text NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN ('RASCUNHO','ASSINADO','OBSOLETO')),
  arquivo_uri text, UNIQUE (empresa_id, versao)
);
CREATE TABLE pcmso_exames_cargo (             -- exame × cargo × tipo de ASO × periodicidade
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  pcmso_id uuid NOT NULL REFERENCES pcmso_programas(id) ON DELETE CASCADE,
  cargo_id uuid NOT NULL REFERENCES cargos(id), exame_id uuid NOT NULL REFERENCES exames_catalogo(id),
  periodicidade_meses smallint CHECK (periodicidade_meses > 0),   -- NULL = só admissional/demissional
  motivo_risco_agente text REFERENCES agentes_risco(codigo_esocial),  -- liga exame ao risco do PGR
  UNIQUE (pcmso_id, cargo_id, exame_id)
);
CREATE TABLE asos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  colaborador_id uuid NOT NULL REFERENCES colaboradores(id),
  tipo text NOT NULL CHECK (tipo IN ('ADMISSIONAL','PERIODICO','RETORNO_AO_TRABALHO','MUDANCA_DE_RISCO','DEMISSIONAL')),
  data_exame date NOT NULL, resultado text NOT NULL CHECK (resultado IN ('APTO','INAPTO','APTO_COM_RESTRICAO')),
  medico_nome text NOT NULL, medico_crm text NOT NULL, medico_crm_uf char(2) NOT NULL,
  proximo_exame date, restricoes text,
  assinatura text CHECK (assinatura IN ('ICP_BRASIL','BIOMETRICA','FISICA_DIGITALIZADA')),
  pdf_uri text, hash_sha256 char(64), criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_aso_colab ON asos (colaborador_id, data_exame DESC);
CREATE INDEX ix_aso_venc  ON asos (empresa_id, proximo_exame);
CREATE TABLE aso_exames (
  aso_id uuid REFERENCES asos(id) ON DELETE CASCADE, exame_id uuid REFERENCES exames_catalogo(id),
  data_exame date NOT NULL, ordem_exame text,       -- ordem do exame (S-2220: 1ª ocorrência / sequencial)
  resultado_json jsonb,                              -- audiometria, laboratoriais...
  PRIMARY KEY (aso_id, exame_id, data_exame)
);

-- ---------- 5. LTCAT / LTIP / PPP / FAP ----------
CREATE TABLE ltcat_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  tipo text NOT NULL CHECK (tipo IN ('LTCAT','LTCAT_INDIVIDUAL','LTIP','LIP','EXTERNO')),
  colaborador_id uuid REFERENCES colaboradores(id),   -- LTCAT individual
  pgr_id uuid REFERENCES pgr_documentos(id),          -- reaproveita a base de exposição do PGR
  versao integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'RASCUNHO' CHECK (status IN ('RASCUNHO','EM_AVALIACAO','LIBERADO','RECUSADO','ASSINADO','VENCIDO')),
  responsavel_tecnico text, motivo_recusa text,
  codigo_autenticidade text UNIQUE,                   -- validação pública do documento
  vigencia_ini date, vencimento date, arquivo_uri text, hash_sha256 char(64)
);
CREATE TABLE ppp_emissoes (                           -- PPP é DERIVADO (S-2240 + S-2220 + vínculo); aqui só o histórico de emissão
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  colaborador_id uuid NOT NULL REFERENCES colaboradores(id),
  emitido_em timestamptz NOT NULL DEFAULT now(), motivo text, arquivo_uri text, hash_sha256 char(64)
);
CREATE TABLE fap_simulacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  ano_vigencia smallint NOT NULL, fap_publicado numeric(6,4), rat_ajustado numeric(6,4),
  qtd_cat integer, observacao text,
  UNIQUE (empresa_id, ano_vigencia)
);

-- ---------- 6. ACIDENTES / CAT, CIPA, TREINAMENTOS ----------
CREATE TABLE acidentes_trabalho (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  colaborador_id uuid NOT NULL REFERENCES colaboradores(id),
  tipo text NOT NULL CHECK (tipo IN ('TIPICO','TRAJETO','DOENCA_OCUPACIONAL')),
  ocorrido_em timestamptz NOT NULL, local text, descricao text, parte_corpo text, agente_causador text, cid10 text,
  houve_afastamento boolean NOT NULL DEFAULT false, houve_obito boolean NOT NULL DEFAULT false,
  cat_tipo text CHECK (cat_tipo IN ('INICIAL','REABERTURA','COMUNICACAO_OBITO')),
  investigacao_uri text,
  plano_acao_gerado boolean NOT NULL DEFAULT false
);
CREATE TABLE cipa_mandatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  inicio date NOT NULL, fim date NOT NULL, status text NOT NULL DEFAULT 'EM_ELEICAO'
    CHECK (status IN ('EM_ELEICAO','VIGENTE','ENCERRADO'))
);
CREATE TABLE cipa_membros (
  mandato_id uuid REFERENCES cipa_mandatos(id) ON DELETE CASCADE, colaborador_id uuid REFERENCES colaboradores(id),
  tenant_id uuid NOT NULL, representacao text NOT NULL CHECK (representacao IN ('EMPREGADOR','EMPREGADOS')),
  cargo text NOT NULL CHECK (cargo IN ('PRESIDENTE','VICE_PRESIDENTE','SECRETARIO','TITULAR','SUPLENTE')),
  votos integer, PRIMARY KEY (mandato_id, colaborador_id)
);
CREATE TABLE treinamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  nome text NOT NULL, norma text, carga_horaria numeric(5,1), validade_meses smallint
);
CREATE TABLE treinamento_participacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  treinamento_id uuid NOT NULL REFERENCES treinamentos(id), colaborador_id uuid NOT NULL REFERENCES colaboradores(id),
  realizado_em date NOT NULL, validade date, certificado_uri text, assinatura text
);
CREATE INDEX ix_trein_validade ON treinamento_participacoes (colaborador_id, validade);

-- ---------- 7. eSocial SST: eventos com máquina de estados ----------
CREATE TABLE esocial_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresas(id),
  tipo text NOT NULL CHECK (tipo IN ('S-1060','S-2210','S-2220','S-2221','S-2240')),
  origem_tabela text NOT NULL, origem_id uuid NOT NULL,           -- aso / acidente / inventário...
  referencia text,                                                  -- período de apuração/competência
  prazo_legal date,                                                 -- calculado por src/sst/esocial-prazos.ts
  status text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','VALIDADO','ASSINADO','ENVIADO','PROCESSADO','ADVERTENCIA','REJEITADO','RETIFICADO')),
  xml_uri text, protocolo text, recibo text, tentativas smallint NOT NULL DEFAULT 0,
  retorno_codigo text, retorno_mensagem text, enviado_em timestamptz,
  UNIQUE (origem_tabela, origem_id, tipo, referencia)
);
CREATE INDEX ix_esocial_pend ON esocial_eventos (empresa_id, status, prazo_legal);

-- ---------- 8. Ponte com a contabilidade (barramento já existente) ----------
ALTER TABLE eventos_integracao DROP CONSTRAINT eventos_integracao_modulo_check;
ALTER TABLE eventos_integracao ADD CONSTRAINT eventos_integracao_modulo_check
  CHECK (modulo IN ('FOLHA','FISCAL','PATRIMONIO','SST'));
-- Tipos SST publicados: SST.EPI_CONSUMO (D despesa EPI / C estoque), SST.EXAMES_OCUPACIONAIS (D despesa / C fornecedores)

-- ---------- 9. RLS + proteção extra de dado de saúde ----------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
            WHERE table_schema='public' AND column_name='tenant_id'
              AND table_name IN ('cargos','ambientes_trabalho','colaboradores','ghe','matrizes_risco','pgr_documentos','inventario_riscos','plano_acao',
                'epi_catalogo','epi_lotes','epi_entregas','epc_equipamentos','epc_eventos','psicossocial_campanhas','psicossocial_convites',
                'psicossocial_respostas','psicossocial_resultados','exames_catalogo','pcmso_programas','pcmso_exames_cargo','asos',
                'ltcat_documentos','ppp_emissoes','fap_simulacoes','acidentes_trabalho','cipa_mandatos','cipa_membros','treinamentos',
                'treinamento_participacoes','esocial_eventos')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())$p$, t);
  END LOOP;
END $$;
-- ghe_cargos e aso_exames não têm tenant_id próprio: herdam acesso pelo pai (FK + RLS no pai). Para
-- proibir leitura direta, revogue SELECT dessas tabelas da role da aplicação e acesse só via JOIN/views.

-- Dado de saúde (ASO/exames/acidentes): além do tenant, exige papel clínico ou RH autorizado.
-- A aplicação define  SET LOCAL app.papel = 'MEDICO'|'SST'|'RH'|'CLIENTE_LEITURA'.
CREATE POLICY saude_por_papel ON asos AS RESTRICTIVE
  USING (current_setting('app.papel', true) IN ('MEDICO','SST','RH','ADMIN'));
CREATE POLICY saude_por_papel ON acidentes_trabalho AS RESTRICTIVE
  USING (current_setting('app.papel', true) IN ('MEDICO','SST','RH','ADMIN'));
-- Anonimato psicossocial: respostas só são legíveis pelo worker de apuração, nunca por usuários finais.
CREATE POLICY so_worker ON psicossocial_respostas AS RESTRICTIVE
  USING (current_setting('app.papel', true) = 'WORKER_PSICOSSOCIAL');
