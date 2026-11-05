# Agente de IA

## Onde colocar a chave da OpenAI
Na tela do ERP, seção **Agente de IA** → campo "Chave da OpenAI" → Salvar. (Também: `PUT /v1/ia/config {"apiKey":"sk-…","modelo":"gpt-4o-mini","limiteTokensMes":200000}`.)
Alternativa global: variável de ambiente `OPENAI_API_KEY` no Coolify (fallback quando o tenant não tem chave própria).
**Não cole a chave em chats, e-mails ou repositórios.**

## Como a chave é protegida
| Risco | Controle (testado) |
|---|---|
| Vazamento por dump do banco | Guardada com **AES-256-GCM**; mestre `IA_MASTER_KEY` fica no ambiente, não no banco. IV aleatório; adulteração detectada |
| Vazamento pela API/navegador | A API **nunca devolve** a chave, só os 4 últimos caracteres. Campo é `password` e é limpo após salvar |
| Vazamento em erros/logs | Erros do provedor têm `sk-…` mascarado; corpos de requisição não são logados |
| Uso entre clientes | Config por tenant sob RLS; outro tenant não vê a chave |
| Custo descontrolado | Limite mensal de tokens por tenant (HTTP 429), no máx. 5 rodadas de ferramentas, resultados truncados |

`IA_MASTER_KEY`: gere com `openssl rand -hex 32`. **Se for perdida ou trocada, as chaves salvas ficam ilegíveis e precisam ser recadastradas.**

## O que o agente faz (e não faz)
Ferramentas **somente leitura**: `consultar_balancete`, `consultar_razao`, `asos_vencendo`, `sugerir_contrapartida` e `validar_lancamento` (valida e devolve **rascunho**, **não grava**).
- A empresa vem da rota, não do modelo: um prompt malicioso não consegue ler outra empresa.
- Texto vindo de extratos/históricos é tratado como dado, não como instrução; como as ferramentas não gravam, o dano possível é limitado.
- Respostas são apoio: decisão técnica, assinatura e responsabilidade legal continuam com o contador/profissional habilitado.

## Pontos a validar
1. Testei com uma **OpenAI simulada** (sem chave real): o formato de chamada (Chat Completions + `tools`) segue a API pública, mas confirme com sua chave real após o deploy.
2. O modelo padrão `gpt-4o-mini` é configurável; ajuste ao modelo que sua conta usa.
3. Dados contábeis e de saúde enviados à OpenAI saem do seu servidor: defina base legal/contrato (LGPD) e, para SST, evite enviar dado clínico identificado sem consentimento.
4. Funções de IA previstas na especificação SST (análise de exames, risco por foto) não foram implementadas.
