// Glossário dos termos técnicos do sistema (contábil, fiscal, DP/RH, SST, eSocial e termos da própria plataforma).
// Explicações de apoio: valores, prazos e alíquotas variam e devem ser conferidos na legislação vigente.
export interface Termo { termo: string; area: 'Contábil' | 'Fiscal' | 'DP e RH' | 'SST' | 'eSocial' | 'Sistema'; explicacao: string }
const AREAS = ['Contábil', 'Fiscal', 'DP e RH', 'SST', 'eSocial', 'Sistema'];
// formato: Termo|Área|Explicação
const TXT = `
Balancete|Contábil|Demonstrativo que lista todas as contas contábeis com seus saldos (débito, crédito e saldo) em uma data. Serve para conferir se os lançamentos estão equilibrados (débitos = créditos) antes de gerar o balanço e a DRE.
Balanço patrimonial|Contábil|Demonstração que mostra a posição financeira da empresa em uma data: o que ela possui (Ativo), o que deve (Passivo) e o que é dos sócios (Patrimônio Líquido). Vale a equação Ativo = Passivo + Patrimônio Líquido.
DRE|Contábil|Demonstração do Resultado do Exercício. Resume receitas, custos e despesas de um período e termina no lucro ou prejuízo. Mostra o desempenho, diferente do balanço, que mostra a posição em uma data.
Ativo|Contábil|Bens e direitos da empresa que geram benefício econômico futuro, como caixa, bancos, estoques, clientes a receber e imobilizado.
Passivo|Contábil|Obrigações da empresa com terceiros, como fornecedores, empréstimos, salários e impostos a pagar.
Patrimônio líquido|Contábil|Parte do ativo que pertence aos sócios: capital social, reservas e lucros acumulados, descontados os prejuízos. É o ativo menos o passivo.
Plano de contas|Contábil|Lista organizada e codificada de todas as contas usadas na contabilidade (ativo, passivo, receitas, despesas). Cada lançamento precisa usar uma conta do plano.
Plano referencial|Contábil|Tabela da Receita Federal que relaciona as contas da empresa às contas oficiais usadas na ECF. O sistema mantém a tabela por tipo de empresa (lucro real, presumido etc.).
Lançamento contábil|Contábil|Registro de um fato econômico (venda, pagamento, compra) em partidas dobradas: o valor debitado em uma conta é creditado em outra.
Partidas dobradas|Contábil|Método em que todo fato contábil afeta ao menos duas contas, com débito e crédito de mesmo valor. É a base do balancete equilibrado.
Débito e crédito|Contábil|Lados de um lançamento. Débito aumenta ativos e despesas e diminui passivos e receitas; crédito faz o inverso.
Conciliação bancária|Contábil|Conferência entre o extrato do banco e os lançamentos contábeis para achar diferenças (cheques não compensados, tarifas, depósitos em trânsito).
Regime de competência|Contábil|Receitas e despesas são reconhecidas no período em que ocorrem, independentemente de quando o dinheiro entra ou sai. É o regime exigido pela contabilidade.
Regime de caixa|Contábil|Receitas e despesas são reconhecidas quando o dinheiro efetivamente entra ou sai. Algumas empresas pequenas podem usá-lo para fins fiscais, conforme a lei.
Depreciação|Contábil|Perda de valor de bens do imobilizado pelo uso, tempo ou obsolescência, apropriada como despesa ao longo da vida útil. As taxas fiscais devem ser conferidas na norma vigente.
Provisão|Contábil|Reserva contábil de despesa certa ou provável com valor estimado, como férias, 13º salário e contingências, reconhecida antes do pagamento.
Imobilizado|Contábil|Bens de uso duradouro da empresa (máquinas, veículos, imóveis, móveis) que não se destinam à venda.
Fluxo de caixa|Contábil|Demonstração das entradas e saídas de dinheiro em um período, separadas em atividades operacionais, de investimento e de financiamento.
Notas explicativas|Contábil|Textos que acompanham as demonstrações contábeis e detalham práticas adotadas, composição de contas e fatos relevantes.
Escrituração contábil|Contábil|Registro ordenado e cronológico de todos os fatos contábeis nos livros (Diário e Razão), hoje enviado digitalmente pela ECD.
Livro Diário|Contábil|Livro obrigatório que registra os lançamentos contábeis em ordem cronológica.
Livro Razão|Contábil|Livro que agrupa os lançamentos por conta contábil, mostrando a movimentação e o saldo de cada uma.
ECD|Contábil|Escrituração Contábil Digital. Obrigação acessória que transmite à Receita (SPED) os livros contábeis em meio digital.
ECF|Contábil|Escrituração Contábil Fiscal. Declaração anual do IRPJ e da CSLL que usa o plano referencial e as informações da contabilidade.
Capital social|Contábil|Valor que os sócios investem na empresa conforme o contrato social, formando a base do patrimônio líquido.
Lucro líquido|Contábil|Resultado final da DRE depois de custos, despesas e tributos sobre o lucro.
Margem|Contábil|Percentual do lucro (bruto, operacional ou líquido) sobre a receita. Indica quanto sobra de cada real vendido.
Markup|Contábil|Percentual aplicado sobre o custo para formar o preço de venda. Difere da margem, que é calculada sobre o preço.
Ponto de equilíbrio|Contábil|Volume de vendas em que a receita cobre exatamente os custos e despesas, sem lucro nem prejuízo.
VPL|Contábil|Valor Presente Líquido. Soma dos fluxos de caixa futuros trazidos a valor de hoje por uma taxa de desconto, menos o investimento inicial. VPL positivo indica projeto atrativo.
Payback|Contábil|Tempo necessário para recuperar o investimento inicial com os fluxos de caixa do projeto.
Tabela Price|Contábil|Sistema de amortização com prestações iguais, em que os juros diminuem e a amortização aumenta a cada parcela.
Juros compostos|Contábil|Juros calculados sobre o capital mais os juros acumulados dos períodos anteriores ("juros sobre juros").
CNPJ|Fiscal|Cadastro Nacional da Pessoa Jurídica. Número de 14 dígitos que identifica a empresa; os dois últimos são dígitos verificadores calculados.
CPF|Fiscal|Cadastro de Pessoas Físicas. Número de 11 dígitos que identifica a pessoa; os dois últimos são verificadores. O sistema valida o CPF e o protege como dado pessoal.
Regime tributário|Fiscal|Forma de apuração dos tributos da empresa: Simples Nacional, Lucro Presumido ou Lucro Real (ou MEI para microempreendedores). Define alíquotas e obrigações.
Simples Nacional|Fiscal|Regime simplificado que reúne vários tributos em uma guia única (DAS), com alíquotas progressivas conforme a receita bruta e o anexo da atividade. Limites e tabelas devem ser conferidos.
DAS|Fiscal|Documento de Arrecadação do Simples Nacional. Guia mensal única do regime simplificado.
RBT12|Fiscal|Receita bruta total dos últimos 12 meses. Base para achar a faixa e a alíquota efetiva do Simples Nacional.
Fator R|Fiscal|Relação entre a folha de pagamento (incluindo pró-labore) e a receita bruta dos últimos 12 meses. Em certas atividades, define se a empresa é tributada pelo Anexo III ou pelo V do Simples.
MEI|Fiscal|Microempreendedor Individual. Regime para pequenos empresários com guia fixa mensal (DAS-MEI) e limite de receita anual, conforme a lei vigente.
Lucro Presumido|Fiscal|Regime em que o lucro é presumido por percentuais sobre a receita, conforme a atividade, e sobre ele incidem IRPJ e CSLL, apurados por trimestre.
Lucro Real|Fiscal|Regime em que IRPJ e CSLL incidem sobre o lucro efetivo apurado na contabilidade, com ajustes (adições e exclusões) do LALUR.
IRPJ|Fiscal|Imposto de Renda da Pessoa Jurídica, tributo federal sobre o lucro das empresas.
CSLL|Fiscal|Contribuição Social sobre o Lucro Líquido, tributo federal que financia a seguridade social.
PIS e COFINS|Fiscal|Contribuições federais sobre a receita ou o faturamento. Podem ser cumulativas ou não cumulativas (com crédito), conforme o regime.
ICMS|Fiscal|Imposto estadual sobre circulação de mercadorias e alguns serviços (transporte e comunicação). Não cumulativo: compensa-se o imposto pago nas entradas.
ISS|Fiscal|Imposto Sobre Serviços, municipal. A alíquota varia por município e serviço, dentro dos limites da lei complementar.
IPI|Fiscal|Imposto sobre Produtos Industrializados, federal, cobrado de indústrias e importadores.
IRRF|Fiscal|Imposto de Renda Retido na Fonte. Valor descontado do pagamento (salário, serviço, aluguel) e recolhido pela fonte pagadora.
Retenções federais|Fiscal|Descontos de IRRF, CSLL, PIS e COFINS feitos por tomadores de serviços sobre o pagamento a prestadores, recolhidos em DARF.
DARF|Fiscal|Documento de Arrecadação de Receitas Federais, guia para pagar tributos federais.
Multa e juros de mora|Fiscal|Acréscimos legais sobre tributo pago em atraso: multa diária limitada e juros pela taxa Selic. A calculadora do sistema ajuda a estimar; confira a regra vigente.
Nota fiscal eletrônica|Fiscal|Documento digital que comprova operação de venda ou serviço (NF-e, NFS-e, NFC-e), validado pela administração tributária.
SPED|Fiscal|Sistema Público de Escrituração Digital. Conjunto de obrigações digitais (ECD, ECF, EFD) enviadas à Receita e aos fiscos.
EFD|Fiscal|Escrituração Fiscal Digital (ICMS/IPI e Contribuições) com os registros fiscais da empresa.
Obrigação acessória|Fiscal|Dever de prestar informações ao fisco (declarações, escriturações), diferente da obrigação principal, que é pagar o tributo.
Obrigação principal|Fiscal|Dever de pagar o tributo ou a penalidade pecuniária.
Substituição tributária|Fiscal|Regime em que um contribuinte (geralmente o fabricante ou importador) recolhe antecipadamente o imposto devido pelos demais elos da cadeia.
CND|Fiscal|Certidão Negativa de Débitos. Prova que não há débitos pendentes junto ao órgão emissor (federal, estadual, municipal, FGTS, trabalhista).
Alvará|Fiscal|Licença do município para o funcionamento do estabelecimento.
Contrato social|Fiscal|Documento que constitui a sociedade e define sócios, capital, objeto e regras de administração; registrado na Junta Comercial.
Admissão|DP e RH|Contratação formal do empregado: registro, exame admissional, contrato e envio ao eSocial antes do início do trabalho.
Contrato de experiência|DP e RH|Contrato por prazo determinado para avaliar o empregado. Tem prazo máximo e permite prorrogação, conforme a CLT. O sistema alerta sobre o vencimento.
Contrato por prazo indeterminado|DP e RH|Contrato sem data para terminar, padrão da CLT.
Contrato intermitente|DP e RH|Contrato em que o trabalho não é contínuo, com períodos de atividade e inatividade, mediante convocação e pagamento proporcional.
Jovem aprendiz|DP e RH|Contrato especial para jovens, com formação técnico-profissional e jornada reduzida. Existe cota de aprendizes para empresas, a conferir na lei.
Estágio|DP e RH|Atividade educativa supervisionada, sem vínculo empregatício, regida por termo de compromisso, bolsa e seguro, conforme a Lei do Estágio.
CTPS|DP e RH|Carteira de Trabalho e Previdência Social, hoje digital, que registra o histórico do vínculo do trabalhador.
CBO|DP e RH|Classificação Brasileira de Ocupações. Código que identifica cada profissão e é usado no eSocial.
Matrícula|DP e RH|Código interno que identifica o empregado na empresa.
Salário|DP e RH|Remuneração base paga ao empregado pelo trabalho, com valor mínimo definido em lei ou norma coletiva.
Remuneração|DP e RH|Soma do salário com adicionais, comissões e outras parcelas habituais.
Folha de pagamento|DP e RH|Cálculo mensal de proventos, descontos e encargos de cada empregado, que resulta no líquido a pagar e nos recolhimentos.
Proventos e descontos|DP e RH|Proventos são valores devidos ao empregado (salário, horas extras); descontos são valores retirados (INSS, IRRF, faltas, vale-transporte).
Salário líquido|DP e RH|Valor que o empregado recebe após os descontos legais e autorizados.
INSS|DP e RH|Contribuição previdenciária descontada do empregado em faixas progressivas; o empregador também recolhe sua parte. Tabelas mudam: confira a vigente.
FGTS|DP e RH|Fundo de Garantia do Tempo de Serviço. Depósito mensal do empregador, em conta do empregado, com percentual definido em lei.
Encargos sociais|DP e RH|Contribuições e recolhimentos que o empregador faz sobre a folha (INSS patronal, FGTS, RAT, terceiros).
RAT / FAP|DP e RH|Contribuição para riscos ambientais do trabalho, com alíquota por atividade e ajustada pelo FAP (fator que depende do histórico de acidentes da empresa).
13º salário|DP e RH|Gratificação anual obrigatória, paga em parcelas, proporcional aos meses trabalhados.
Férias|DP e RH|Descanso anual remunerado após cada período aquisitivo de 12 meses, com adicional de um terço. Devem ser concedidas no período concessivo para evitar pagamento em dobro.
Período aquisitivo|DP e RH|Período de 12 meses de trabalho que dá direito às férias.
Período concessivo|DP e RH|Os 12 meses seguintes ao período aquisitivo, dentro dos quais a empresa deve conceder as férias.
Abono pecuniário|DP e RH|Conversão de parte das férias em dinheiro, a pedido do empregado, nos limites da CLT.
Horas extras|DP e RH|Horas além da jornada contratada, pagas com adicional mínimo legal ou da norma coletiva.
Banco de horas|DP e RH|Sistema de compensação de horas extras por folgas, em prazo e condições definidos em acordo ou norma coletiva.
Adicional noturno|DP e RH|Acréscimo sobre o trabalho em horário noturno, com hora reduzida, conforme a lei.
Insalubridade|DP e RH|Adicional pago a quem trabalha exposto a agentes nocivos acima dos limites, caracterizado por laudo técnico conforme a NR-15.
Periculosidade|DP e RH|Adicional pago a quem trabalha em atividades perigosas (inflamáveis, eletricidade, vigilância etc.), conforme a NR-16.
Vale-transporte|DP e RH|Benefício para deslocamento residência-trabalho, com desconto limitado do salário do empregado.
Salário-família|DP e RH|Benefício previdenciário pago por filho dentro das regras e do limite de remuneração vigentes.
Aviso prévio|DP e RH|Comunicação antecipada do fim do contrato, trabalhada ou indenizada, com prazo proporcional ao tempo de serviço.
Rescisão|DP e RH|Encerramento do contrato de trabalho, com pagamento de verbas que variam conforme o motivo (dispensa, pedido de demissão, justa causa, acordo).
Justa causa|DP e RH|Dispensa por falta grave do empregado, enquadrada nas hipóteses da CLT, com verbas reduzidas.
Acordo na rescisão|DP e RH|Extinção do contrato por acordo entre as partes, com verbas e saque do FGTS em condições próprias previstas na CLT.
TRCT|DP e RH|Termo de Rescisão do Contrato de Trabalho, documento que discrimina as verbas pagas na rescisão.
Estabilidade|DP e RH|Proteção temporária contra dispensa (gestante, acidentado, cipeiro), conforme a lei. O sistema controla prazos de estabilidade em ferramentas próprias.
Advertência e suspensão|DP e RH|Medidas disciplinares graduais: advertência (verbal ou escrita) e suspensão, aplicadas conforme a falta e a proporcionalidade.
Absenteísmo|DP e RH|Índice de ausências (faltas, atrasos, atestados) em relação ao total de horas previstas.
Turnover|DP e RH|Rotatividade: relação entre admissões e desligamentos em um período sobre o quadro de pessoal.
Headcount|DP e RH|Quadro de pessoal: número de colaboradores ativos em uma data.
Onboarding|DP e RH|Processo de integração do novo funcionário: documentos, apresentação da empresa, treinamentos e metas iniciais.
Processo seletivo|DP e RH|Etapas de recrutamento: vaga, triagem de candidatos, entrevistas e decisão. A IA do sistema analisa só critérios ligados ao trabalho, sem usar dados pessoais.
PCD|DP e RH|Pessoa com deficiência. Empresas acima de certo porte devem cumprir cota de contratação, conforme a lei.
PDI|DP e RH|Plano de Desenvolvimento Individual, que define metas e ações de crescimento do colaborador.
Semáforo DP/RH|DP e RH|Indicador do sistema (verde, amarelo, vermelho) que sinaliza pendências do departamento pessoal, como cadastro incompleto, experiência vencendo e férias vencendo ou vencidas.
LGPD|DP e RH|Lei Geral de Proteção de Dados. Regula o tratamento de dados pessoais; dados de saúde são sensíveis e exigem base legal e proteção reforçada.
SST|SST|Saúde e Segurança do Trabalho. Conjunto de normas e práticas para prevenir acidentes e doenças ocupacionais.
NR|SST|Norma Regulamentadora. Normas do Ministério do Trabalho sobre SST (NR-1 a NR-38). Cada uma trata de um tema, como EPI, CIPA, eletricidade ou altura.
NR-1 / GRO|SST|Norma geral que trata das disposições gerais e do Gerenciamento de Riscos Ocupacionais (GRO), incluindo o PGR e a ordem de serviço de segurança.
PGR|SST|Programa de Gerenciamento de Riscos. Documento que identifica perigos, avalia riscos e define plano de ação, com inventário de riscos, conforme a NR-1.
Inventário de riscos|SST|Parte do PGR que lista perigos, fontes, exposições, medidas existentes e classificação do risco por ambiente ou função.
PCMSO|SST|Programa de Controle Médico de Saúde Ocupacional (NR-7). Define os exames médicos por função e periodicidade, com base nos riscos do PGR.
ASO|SST|Atestado de Saúde Ocupacional. Documento do médico que declara o trabalhador apto ou inapto para a função, emitido nos exames admissional, periódico, de retorno, de mudança de risco e demissional.
Exame admissional|SST|Exame médico feito antes do início das atividades para verificar se o candidato está apto à função.
Exame periódico|SST|Exame de rotina feito em intervalos definidos pelo PCMSO, conforme riscos e idade.
Exame de retorno ao trabalho|SST|Exame feito no primeiro dia de volta após afastamento de determinada duração, conforme a NR-7.
Exame de mudança de risco|SST|Exame feito antes da mudança de função ou ambiente que altera a exposição a riscos.
Exame demissional|SST|Exame feito na rescisão, dentro dos prazos da NR-7, conforme a regra vigente.
Exame complementar|SST|Exames adicionais pedidos pelo risco da função, como audiometria (ruído), espirometria (poeiras) e exames laboratoriais.
Audiometria|SST|Exame que avalia a audição; usado no monitoramento de trabalhadores expostos a ruído.
Espirometria|SST|Exame de função pulmonar, indicado em exposição a poeiras, fumos e agentes químicos respiratórios.
Toxicológico|SST|Exame para detectar uso de substâncias, exigido de motoristas profissionais conforme a lei.
LTCAT|SST|Laudo Técnico das Condições Ambientais do Trabalho. Documenta agentes nocivos e subsidia benefícios previdenciários, como aposentadoria especial.
PPP|SST|Perfil Profissiográfico Previdenciário. Documento individual com histórico laboral e exposição a agentes nocivos, usado pelo INSS.
AET|SST|Análise Ergonômica do Trabalho (NR-17). Avalia a adaptação do trabalho às características do trabalhador.
APR|SST|Análise Preliminar de Risco. Estudo feito antes de atividades não rotineiras para identificar perigos e definir controles.
PT|SST|Permissão de Trabalho. Autorização formal e temporária para atividades de risco, como trabalho a quente, em altura ou em espaço confinado.
CIPA|SST|Comissão Interna de Prevenção de Acidentes (NR-5). Reúne representantes do empregador e dos empregados para prevenir acidentes; seus membros têm estabilidade.
SIPAT|SST|Semana Interna de Prevenção de Acidentes do Trabalho, evento anual promovido pela CIPA.
SESMT|SST|Serviço Especializado em Engenharia de Segurança e em Medicina do Trabalho (NR-4), dimensionado por grau de risco e número de empregados.
EPI|SST|Equipamento de Proteção Individual (NR-6), de uso pessoal, como capacete, luvas, protetor auricular e botas. Deve ter CA válido e ser entregue com registro.
EPC|SST|Equipamento de Proteção Coletiva, que protege várias pessoas, como guarda-corpo, exaustor, enclausuramento e sinalização.
CA|SST|Certificado de Aprovação do EPI, emitido pelo órgão competente. O EPI só pode ser fornecido com CA dentro da validade; o sistema controla número e validade do CA.
Vida útil do EPI|SST|Prazo estimado de uso do EPI antes da troca, definido pelo fabricante e pela condição de uso. Gera a data de troca prevista.
Ficha de EPI|SST|Registro de entrega, troca e devolução de EPI ao trabalhador, com assinatura ou controle equivalente.
Treinamento|SST|Capacitação exigida pelas NRs ou pelo PGR, com carga horária, conteúdo e reciclagem em prazos definidos em cada norma.
Reciclagem|SST|Repetição periódica do treinamento para manter a capacitação em dia. O prazo varia por norma e deve ser conferido.
Integração|SST|Treinamento e orientações de segurança dadas ao novo empregado antes de iniciar o trabalho, conforme a função e os riscos.
NR-10|SST|Segurança em instalações e serviços em eletricidade. Exige capacitação específica; o complemento SEP é exigido para quem atua em sistema elétrico de potência.
SEP|SST|Sistema Elétrico de Potência: geração, transmissão e distribuição de energia, incluindo subestações. Quem atua nele precisa do curso complementar da NR-10.
NR-11|SST|Transporte, movimentação, armazenagem e manuseio de materiais, incluindo operação de empilhadeiras e guindastes.
NR-12|SST|Segurança no trabalho em máquinas e equipamentos: proteções, dispositivos de parada, manutenção e capacitação.
NR-17|SST|Ergonomia: adaptação do trabalho ao trabalhador, mobiliário, postura, pausas e organização do trabalho.
NR-18|SST|Condições de segurança na indústria da construção.
NR-20|SST|Segurança com inflamáveis e combustíveis, com treinamentos por nível de risco.
NR-23|SST|Proteção contra incêndios: saídas, extintores, brigada e treinamentos.
NR-33|SST|Segurança em espaços confinados: ambientes com entrada restrita e ventilação inadequada, que exigem permissão de entrada, vigia e capacitação.
NR-35|SST|Trabalho em altura: atividades acima de 2 metros do nível inferior com risco de queda. Exige capacitação, aptidão médica e análise de risco.
Espaço confinado|SST|Local não projetado para ocupação humana contínua, com meios limitados de entrada e saída e atmosfera que pode ser perigosa.
Trabalho em altura|SST|Atividade executada acima de 2 m do nível inferior, onde há risco de queda, conforme a NR-35.
Trabalho a quente|SST|Atividade com chama, faísca ou calor (solda, corte, esmerilhamento) que exige permissão de trabalho e prevenção de incêndio.
Agentes de risco|SST|Fatores do ambiente que podem causar dano: físicos (ruído, calor), químicos (poeiras, vapores), biológicos (vírus, bactérias), ergonômicos e de acidentes.
Risco físico|SST|Agentes como ruído, vibração, calor, frio, radiações e pressões anormais.
Risco químico|SST|Exposição a substâncias como poeiras, fumos, gases, vapores e névoas, que podem entrar por inalação, pele ou ingestão.
Risco biológico|SST|Exposição a microrganismos (bactérias, vírus, fungos), comum em saúde, saneamento e laboratórios.
Risco ergonômico|SST|Fatores de postura, esforço, repetitividade, ritmo e organização do trabalho que podem causar lesões.
Risco de acidentes|SST|Condições que podem causar lesão imediata: máquinas sem proteção, eletricidade, queda, arranjo físico inadequado.
Limite de tolerância|SST|Concentração ou intensidade de um agente abaixo da qual se considera que não há dano à saúde na jornada. Os limites estão nas NRs e devem ser conferidos.
Nível de ação|SST|Valor de exposição (geralmente metade do limite) a partir do qual devem começar ações de controle e monitoramento.
Dosimetria|SST|Medição da exposição de um trabalhador a um agente (como ruído) durante a jornada, com instrumento portátil.
IBUTG|SST|Índice de Bulbo Úmido Termômetro de Globo. Mede o estresse térmico (calor) para definir regimes de trabalho e descanso.
Mapa de risco|SST|Representação gráfica dos riscos por setor, com círculos coloridos por tipo de agente.
Acidente de trabalho|SST|Acidente que ocorre pelo exercício do trabalho e causa lesão, perda ou redução da capacidade, ou morte. Inclui o de trajeto e a doença ocupacional equiparada.
CAT|SST|Comunicação de Acidente de Trabalho. Deve ser emitida em prazo legal e enviada ao INSS e ao eSocial; o prazo deve ser conferido.
Doença ocupacional|SST|Doença causada ou agravada pelas condições de trabalho, como perda auditiva por ruído.
Taxa de frequência|SST|Indicador: número de acidentes por milhão de horas trabalhadas.
Taxa de gravidade|SST|Indicador: dias perdidos por milhão de horas trabalhadas.
DDS|SST|Diálogo Diário de Segurança: conversa curta antes do turno sobre riscos e cuidados da atividade.
PAE|SST|Plano de Atendimento a Emergências: procedimentos, responsáveis e rotas para situações como incêndio e acidentes graves.
Brigada de incêndio|SST|Grupo treinado para prevenir e combater princípio de incêndio e prestar primeiros socorros.
Semáforo SST|SST|Indicador do sistema (verde, amarelo, vermelho) por colaborador: ASO ausente, vencido ou perto de vencer, treinamentos vencidos e pendências de SST com prazo.
Controle de SST|SST|Painel do colaborador com ASO, exames e EPI (com CA) classificados em dia, vencendo, pendente ou vencido.
Sugestão por IA (SST)|SST|Botão que, a partir da função e das condições de trabalho marcadas, sugere riscos, treinamentos, EPI/EPC e exames. É apoio: a exigência real vem do PGR/PCMSO.
eSocial|eSocial|Sistema do governo para enviar, em um só canal, informações trabalhistas, previdenciárias e de SST dos empregados.
S-2200|eSocial|Evento de admissão e cadastramento inicial do vínculo do trabalhador.
S-2206|eSocial|Evento de alteração de contrato de trabalho, como mudança de função ou salário.
S-2210|eSocial|Evento de Comunicação de Acidente de Trabalho (CAT).
S-2220|eSocial|Monitoramento da saúde do trabalhador: envia o ASO e exames do PCMSO.
S-2240|eSocial|Condições ambientais do trabalho: agentes nocivos a que o trabalhador está exposto.
S-2299|eSocial|Evento de desligamento do trabalhador.
S-1000|eSocial|Informações do empregador: cadastro da empresa no eSocial.
S-1200|eSocial|Remuneração do trabalhador vinculado ao RGPS na folha mensal.
Prazo de envio|eSocial|Limite legal para transmitir cada evento ao eSocial, variável por tipo de evento. O sistema calcula alguns prazos; confira o manual vigente.
Registro|Sistema|Item guardado no banco, como um ASO, treinamento, ficha de EPI ou vaga, ligado a empresa e funcionário, com datas, validade e situação.
Quadro de Registros|Sistema|Aba em formato kanban com colunas Em aberto, Concluído e Cancelado. Mostra o que há para fazer e permite criar, editar, mover e excluir registros.
Kanban|Sistema|Quadro visual em colunas que representam a situação do trabalho; os cartões se movem conforme avançam.
Ferramenta|Sistema|Calculadora ou formulário do sistema (233 no total). Tipo "cálculo" mostra resultado; tipo "registro" guarda o dado no banco.
Simulação com IA|Sistema|Botão em cada ferramenta que preenche um exemplo fictício para você aprender a usar, com explicação de cada campo.
Explicar o cálculo|Sistema|Botão que a IA usa para descrever, passo a passo, como o resultado foi obtido.
Documentos|Sistema|Aba com mais de 200 modelos de laudos, relatórios, contratos, declarações e comunicados, preenchidos com dados da empresa e do colaborador, com impressão em PDF.
Vencimento|Sistema|Data-limite de um registro (validade de exame, treinamento, CA ou prazo). O sistema destaca os vencidos e os que vencem em breve.
Normas e tabelas|Sistema|Parâmetros legais editáveis pelo administrador (tabelas e periodicidades). Cada empresa pode ajustar valores sem mexer no código.
Perfil de acesso|Sistema|Papel do usuário: ADMIN (tudo, inclusive configuração), CONTADOR e AUXILIAR (operam), CLIENTE_LEITURA (apenas consulta).
Tenant|Sistema|Escritório/cliente do sistema. Os dados de cada tenant são isolados dos demais por segurança no banco (RLS).
RLS|Sistema|Row Level Security, recurso do PostgreSQL que restringe cada consulta aos dados do escritório logado.
Agente de IA|Sistema|Assistente que consulta dados do sistema por ferramentas controladas e responde perguntas contábeis, sem inventar números.
Chave da OpenAI|Sistema|Credencial que permite usar a IA. É guardada criptografada e só o administrador pode trocá-la.
Dados de teste|Sistema|Empresas e funcionários fictícios, com prefixo "TESTE - ", que o administrador gera para treinar e remove com um clique.
Indicador da IA|Sistema|Sinal (verde, amarelo, vermelho) que a IA dá na análise do candidato, como apoio; a decisão final é sempre humana.
`;
export const TERMOS: Termo[] = TXT.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [termo, area, ...r] = l.split('|'); return { termo, area: area as Termo['area'], explicacao: r.join('|') }; })
  .sort((a, b) => a.termo.localeCompare(b.termo, 'pt-BR'));
export const AREAS_GLOSSARIO = AREAS;
