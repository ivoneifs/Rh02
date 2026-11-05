-- BALANCETE DINÂMICO COM DRILL-DOWN
-- Parâmetros: $1 empresa_id | $2 data_ini | $3 data_fim | $4 data_ini_exercicio
-- Uma passada em partidas (índice ix_partidas_razao é "covering"), agregada por conta analítica (CTE mov);
-- as sintéticas somam a subárvore via ltree (f.caminho <@ c.caminho) — sem CTE recursiva e sem N+1.
-- Contas de RESULTADO (cod_natureza '04') não carregam saldo de exercícios anteriores.
WITH mov AS (
  SELECT p.conta_id,
    SUM(CASE WHEN p.data < $2 AND (c.cod_natureza <> '04' OR p.data >= $4)
             THEN CASE p.dc WHEN 'D' THEN p.valor ELSE -p.valor END ELSE 0 END)         AS saldo_anterior,
    SUM(CASE WHEN p.data BETWEEN $2 AND $3 AND p.dc = 'D' THEN p.valor ELSE 0 END)      AS total_debito,
    SUM(CASE WHEN p.data BETWEEN $2 AND $3 AND p.dc = 'C' THEN p.valor ELSE 0 END)      AS total_credito
  FROM partidas p JOIN plano_contas c ON c.id = p.conta_id
  WHERE p.empresa_id = $1 AND p.data <= $3
  GROUP BY p.conta_id
)
SELECT c.id, c.codigo, c.codigo_reduzido AS cr, c.descricao AS titulo, c.tipo, c.nivel,
       COALESCE(SUM(m.saldo_anterior),0)                                         AS saldo_anterior,
       COALESCE(SUM(m.total_debito),0)                                           AS total_debito,
       COALESCE(SUM(m.total_credito),0)                                          AS total_credito,
       COALESCE(SUM(m.saldo_anterior + m.total_debito - m.total_credito),0)      AS saldo_final,   -- + devedor / − credor
       bool_or(m.conta_id IS NOT NULL) AS tem_movimento,
       c.tipo = 'A' AS permite_razao                      -- habilita o ícone "visualizar razão" (só analíticas)
FROM plano_contas c
JOIN plano_contas f ON f.empresa_id = c.empresa_id AND f.caminho <@ c.caminho
LEFT JOIN mov m ON m.conta_id = f.id
WHERE c.empresa_id = $1 AND c.ativa
GROUP BY c.id
ORDER BY c.caminho;

-- ---------------------------------------------------------------------------------------------
-- RAZÃO ANALÍTICO (modal aberto ao clicar na conta): saldo corrido por window function.
-- $1 empresa_id | $2 conta_id | $3 data_ini | $4 data_fim.   Cada linha traz lancamento_id → editar o original.
SELECT p.data, l.numero, l.documento, l.id AS lancamento_id,
       COALESCE(p.historico, l.complemento) AS historico,
       contra.codigo AS conta_contrapartida,
       CASE WHEN p.dc = 'D' THEN p.valor END AS debito,
       CASE WHEN p.dc = 'C' THEN p.valor END AS credito,
       ant.saldo + SUM(CASE p.dc WHEN 'D' THEN p.valor ELSE -p.valor END)
         OVER (ORDER BY p.data, l.numero, p.id) AS saldo_acumulado
FROM partidas p
JOIN lancamentos_contabeis l ON l.id = p.lancamento_id
LEFT JOIN LATERAL (                                  -- contrapartida (ou "VÁRIAS" se N:N)
  SELECT CASE WHEN COUNT(*) = 1 THEN MIN(pc.codigo) ELSE 'VÁRIAS' END AS codigo
  FROM partidas q JOIN plano_contas pc ON pc.id = q.conta_id
  WHERE q.lancamento_id = p.lancamento_id AND q.dc <> p.dc) contra ON true
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(CASE dc WHEN 'D' THEN valor ELSE -valor END),0) AS saldo
  FROM partidas WHERE empresa_id = $1 AND conta_id = $2 AND data < $3) ant
WHERE p.empresa_id = $1 AND p.conta_id = $2 AND p.data BETWEEN $3 AND $4
ORDER BY p.data, l.numero, p.id;
