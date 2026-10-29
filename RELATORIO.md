# Relatório do Radar B3 — para quem for retomar o projeto

Leia isto antes de mexer em qualquer coisa. Aqui está o que o Radar faz, como ele funciona por dentro,
o que já foi feito (e por quê), as regras que o dono do projeto pediu para seguir, as referências
visuais e o que ainda falta.

- **App no ar:** https://jvcarvalho07.github.io/radar-b3/
- **Repositório:** https://github.com/JvCarvalho07/radar-b3
- **Pasta local:** `C:\Users\Gaming\Documents\radar-b3`
- **Dono:** GitHub `JvCarvalho07`. Escreve em português do Brasil e prefere respostas curtas e diretas.

---

## 1. O que é

Um app gratuito de **triagem de ações da B3**. Ele baixa os indicadores de todas as ações, aplica as
regras das estratégias (no `config.yaml`) e mostra quem passou, explicando o motivo. Também tem análise
de cada ação, carteira pessoal, watchlist, alertas por notificação, globo com bolsas do mundo e mapa do
mercado. Funciona no navegador e pode ser **instalado no celular** como app (PWA), sem loja.

> **Não é recomendação de investimento.** O Radar só mostra quem cumpre as regras e por quê. Ele **não
> compra nem vende nada** e nunca deve passar a fazer isso (veja as regras na seção 6).

---

## 2. Como funciona (visão geral)

```
GitHub Actions (a cada ~5 min no pregão, 10:00–18:05 de Brasília, seg–sex)
  └─ scan.py
       ├─ radar/fontes.py     baixa os dados (com cache diário em cache/)
       ├─ radar/screener.py   aplica as estratégias do config.yaml e explica os motivos
       ├─ radar/alertas.py    compara com a rodada anterior e manda push só do que mudou
       └─ radar/publicar.py   monta publico/ = app (site/) + dados em JSON
  ├─ estado e histórico de alertas → branch "dados" do repositório
  └─ publico/ → GitHub Pages (o site no ar)
```

- **Tudo é de graça:** Actions é ilimitado em repositório público; o Pages hospeda o app.
- **Rodadas encadeadas:** o agendamento do GitHub atrasa e pula execuções. Por isso, no fim de cada
  rodada durante o pregão, o próprio workflow espera 150 s e dispara a próxima (`gh workflow run`).
  O `concurrency: radar` garante uma rodada por vez; o cron fica de reserva para religar a cadeia.
- **Cache:** fundamentos, histórico de 1 ano, eventos (proventos e desdobramentos) e perfis são
  baixados uma vez por dia e reaproveitados. A chave do cache inclui o `run_id`, então ele é salvo em
  toda rodada.
- **O app se atualiza sozinho:** o `publicar.py` carimba no `sw.js` um resumo (hash) dos arquivos de
  `site/`. Mudou o código → muda o `sw.js` → o service worker novo assume e a página recarrega sozinha
  (espera se a pessoa estiver digitando ou com o formulário da carteira aberto). Só dados novos não
  mudam o carimbo. Ninguém precisa reinstalar o app nem apertar F5.

### Fontes de dados (todas gratuitas e não oficiais)

| Fonte | Para quê | Onde no código |
|---|---|---|
| Fundamentus (`resultado.php`) | indicadores de todas as ações (P/L, P/VP, DY, ROE…) | `fontes.baixar_fundamentus` |
| Yahoo Finance (`yfinance`) | preços, histórico, proventos, desdobramentos, perfis, Ibovespa, BOVA11, bolsas do mundo | `fontes.baixar_historico`, `baixar_eventos`, `resumo_mercado`, `serie_bova11`, `baixar_mundo` |
| AwesomeAPI | dólar ao vivo | `fontes.URL_DOLAR` |
| Banco Central (PTAX) | dólar e moedas quando a AwesomeAPI recusa | `fontes._dolar_ptax`, `_ptax_moeda` |

Os preços têm ~15 min de atraso (dado em tempo real da B3 é pago).

### Pegadinhas dos dados (já tratadas — não desfaça)

- **Bancos e seguradoras:** o Fundamentus manda **0** em margens, ROIC, dívida, liquidez corrente,
  P/receita e EV/EBITDA, porque esses campos não existem para eles. É assim que o código detecta uma
  "financeira" (`liq_corr == 0 e div_liq_patrim == 0`) e, logo depois, troca esses zeros por "sem dado"
  (`fontes._sem_zeros_de_banco`). Nas regras de bancos (`criterios_financeiras`) use só `pl`, `pvp`,
  `dy`, `roe`, `cresc_rec_5a` e campos de preço. Fórmula de Graham também não vale para bancos.
- **Velas ruins do Yahoo:** abertura/máxima/mínima zeradas são preenchidas com o fechamento, e barras
  20× fora da mediana de 21 dias são descartadas (`analise.velas_validas`). Se a série tiver um salto de
  escala (ex.: grupamento mal ajustado), `escala_quebrada` tira mínima/máxima de 52 semanas; saltos de 2×
  marcam `dados_suspeitos`.
- **Yahoo falha calado:** `Ticker.actions` devolve vazio quando falha. Por isso os eventos vêm de
  `history(period="max", actions=True)`: vazio ali = falha (tenta de novo em 30 min), não "sem eventos".
  Se faltar, a ação fica marcada `eventos_incompletos` e usa os proventos do último ano.
- **Desdobramentos na carteira:** o Yahoo já entrega preços e dividendos ajustados. A carteira converte
  a quantidade comprada para a escala de hoje com `fatorApos` (`site/carteira.js`).
- **Ibovespa "com dividendos" na carteira:** a comparação usa o BOVA11 ajustado (`serie_total`), não o
  índice de pontos, para não favorecer a carteira injustamente.

---

## 3. Mapa dos arquivos

```
config.yaml               regras das estratégias, liquidez mínima e watchlist (o dono edita aqui)
scan.py                   ponto de entrada: triagem + alertas + gera publico/
radar/fontes.py           coleta e cache de todas as fontes
radar/screener.py         aplica as estratégias, métricas de preço, motivos de entrada/saída
radar/analise.py          preço justo (Graham, Bazin…), faixas, sinais a favor/atenção, limpeza de velas
radar/alertas.py          compara com a rodada anterior, histórico, envio de push (pywebpush)
radar/publicar.py         monta publico/: copia site/, carimba versão, grava os JSON
site/index.html           casca do app (menu, cartão de instalar, busca)
site/app.js               telas: Visão geral, Estratégias, Ações, Watchlist, Alertas, busca, push, PWA
site/carteira.js          Carteira: cálculo (PM, splits, day trade, proventos), gráficos, regras de saída
site/rede.js              "Rede do Radar": roda radial ligando ações às estratégias (estilo neural link)
site/globo.js             globo 3D (d3 + topojson) com bolsas do mundo e moedas contra o real
site/mapa.js              mapa do mercado (blocos coloridos pela variação)
site/estilo.css           todo o visual
site/sw.js                service worker: offline, atualização automática e notificações push
site/manifest.webmanifest app instalável (ícones, atalhos)
site/icones/              ícones (gerados por ferramentas/icones.py)
site/config.js            chave pública VAPID e nome do repositório (nada secreto)
.github/workflows/radar.yml  agendamento, cache, estado, deploy e encadeamento das rodadas
testes/                   testes automáticos (veja a seção 7)
ferramentas/icones.py     gera os ícones do app com Pillow
referencias/              imagens de referência visual do dono (não vão para o GitHub)
```

Pastas geradas (ignoradas pelo git): `publico/`, `cache/`, `dados/`, `.venv/`.
Pastas de ferramentas de IA (ignoradas): `.arena/` (torneios de propostas), `.taste-skill/`.

### Dados publicados (o app lê estes JSON)

- `dados/resultado.json` — estratégias e quem passou, watchlist, mercado (Ibovespa, dólar), push.
- `dados/universo.json` — cada ação com liquidez: indicadores, preço, proventos, faixas, sinais…
- `dados/precos/{PAPEL}.json` — velas diárias para os gráficos.
- `dados/historico.json` — últimos alertas. `dados/mundo.json` — bolsas e moedas do globo.

---

## 4. As telas do app

- **Visão geral:** herói com o Ibovespa e o dólar, ação em destaque, quem está perto de entrar, quem
  pede atenção, potencial segundo estudos, Rede do Radar, globo e mapa do mercado.
- **Estratégias:** as três do `config.yaml` (Valor e dividendos, Caiu demais, Qualidade), quem passou,
  quem quase entra, e as regras para bancos.
- **Ações:** lista de todas; a página de cada ação tem gráfico de velas, régua de preço justo, sinais a
  favor e de atenção, proventos, indicadores ("não se aplica" para bancos) e como cada número é calculado.
- **Watchlist:** ações acompanhadas, com alertas de preço opcionais (`abaixo_de` / `acima_de`).
- **Carteira:** fica **só no navegador da pessoa** (localStorage `radar-carteira-v1`), nunca vai para
  servidor. Patrimônio com gráfico diário e linha do investido (1M/3M/6M/Tudo), rosca da divisão,
  cartões das posições com mini gráfico e linha do preço médio, regras de saída (stop, alvo, peso
  máximo — a de peso só dispara com ações suficientes), histórico, exportar/importar, comparação com o
  Ibovespa com dividendos. Formulário abre como janela (folha que sobe no celular).
- **Alertas:** histórico do que entrou/saiu e ativação das notificações.

---

## 5. Visual e referências do dono

O dono quer: **vidro laranja quente sobre fundo marrom-grafite escuro com textura** (nada chapado),
**menu lateral flutuante** descolado da borda que abre como na ref. 2, **tudo num herói forte**, toques
futuristas como a roda "neural link" (ref. 5). E, acima de tudo: **não pode parecer feito por IA nem
genérico** — sem fileiras de retângulos iguais, sem poluição, intuitivo.

Imagens em `referencias/`:

- `ref1.webp` — painel de vidro laranja com gráfico de saldo em área, cartões e botões (base da Carteira).
- `ref2.webp` — painel verde com o menu aberto (base do menu lateral).
- `ref3.webp` — cartões de vidro sobre imagem.
- `ref4.webp` — painel escuro esverdeado ("Control AI"): uma esfera central ligada a pílulas de
  categoria, que se abrem em um leque de linhas curvas até uma lista de itens; painel de detalhes de
  vidro à direita. Inspira a Rede do Radar (centro → estratégias → ações em leque).
- `ref5.png` — roda radial "neural" (base da Rede do Radar).

Tokens principais (topo do `site/estilo.css`): fundo `#130c09`/`#140d0a`, laranja `--laranja-2`
`#ffa24a`, degradê `--fogo` (âmbar → laranja → brasa), vidro `--vidro`, positivo `--pos`, negativo
`--neg`. Fonte Plus Jakarta Sans, ícones Tabler. Gráficos: Lightweight Charts 4.2.0; globo: d3 7.9.0.

No celular (≤760 px) o menu vira uma barra flutuante embaixo. O rótulo do menu recolhido só aparece com
mouse (no toque ele ficava preso e cobria os botões).

---

## 6. Regras combinadas com o dono (siga sempre)

1. **Nunca** criar compra/venda/ordens no app. O dono disse que seria arriscado demais (alguém poderia
   achar uma vulnerabilidade).
2. **Nunca** publicar, imprimir ou commitar a chave privada VAPID (`vapid_private.pem`, já no
   `.gitignore`). O dono configura o secret ele mesmo:
   `gh secret set VAPID_PRIVATE_KEY -R JvCarvalho07/radar-b3 < vapid_private.pem`
3. **Commits** com o e-mail noreply do repositório (`201407601+JvCarvalho07@users.noreply.github.com`,
   já configurado no git local), nunca o Gmail pessoal. Mensagens em português, terminando com
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; use `git commit -F arquivo`.
4. **A carteira** fica só no navegador; nunca enviar para servidor.
5. **Sem recomendação personalizada de investimento:** mostrar dados e estudos, sempre com aviso.
6. **Custo:** o dono se preocupa com gasto ("se gastar muito não vale a pena"). Para tarefas com muitos
   agentes (arena), use modelos baratos.
7. Responder sempre em português do Brasil, com acentos.

---

## 7. Como testar

```bash
.venv/Scripts/python scan.py --sem-alerta
.venv/Scripts/python -m http.server 8000 -d publico
```

Abra http://localhost:8000. Nesta máquina o Yahoo às vezes dá timeout de DNS; nesse caso, teste em
cima do site no ar ou rode a aba Actions → *Radar B3* → **Run workflow**.

Testes automáticos: veja a seção "Testes" no fim deste relatório (atualizada a cada sessão).

---

## 8. Histórico do que foi feito

| Commit | O que mudou |
|---|---|
| `2873e0c` | Primeira versão: triagem, app PWA e notificações push |
| `28104e2`, `61031d8` | Cache ilegível é descartado; dólar pela PTAX quando a AwesomeAPI recusa |
| `829db58` → `bed7466` | Redesenhos até chegar no vidro quente com menu flutuante e topo completo |
| `84a46ae` | Rede do Radar (roda radial) |
| `58d2823`, `ebb2952` | Globo com bolsas do mundo e moedas; mais ações; topo selecionável |
| `a755311` | Proposta vencedora da arena (Rede v4, faixa do globo) |
| `d140efa`, `047897e` | Página inicial mais direta, mapa do mercado, globo leve, Brasil em destaque, potencial segundo estudos |
| `08a824e`, `c2c662d` | Carteira com proventos; regras de saída |
| `9794490` | 14 correções de contas apontadas por auditoria; robô que reagenda a si mesmo no pregão |
| `4121c42` | Globo abre inteiro; app se recarrega sozinho quando sai versão nova |
| `586a2cf` | Carteira com gráficos (patrimônio, rosca, mini gráficos), app instalável, ajustes no celular |
| `0a55218` | Rótulo do menu não fica preso no toque; versão carimbada automaticamente no `sw.js` |
| `4ab1f3a` | Bancos podem entrar em Qualidade (zeros do Fundamentus viram "sem dado") |

---

## 9. Pendências do lado do dono

- **Notificações push ainda não estão ligadas:** os secrets `VAPID_PRIVATE_KEY` e `PUSH_SUBSCRIPTIONS`
  não existem no repositório. Passos no `README.md` (seção "Instalar no celular").
- Abas antigas abertas antes da atualização automática precisam de um F5 uma única vez.

---

## 10. Sessão noturna (28→29/10/2026)

O dono pediu: "faça tudo o que conseguir para melhorar o radar até as 11h". O que foi feito nesta
sessão está listado abaixo e é atualizado ao longo da noite.

Método: 4 auditorias em paralelo (backend, app, carteira, dados publicados), cada achado conferido no
código antes de corrigir; testes automáticos para o que foi corrigido; teste no navegador (computador e
celular) antes de publicar.

### Feito

| Commit | O que mudou |
|---|---|
| `67d9118`, `a7a788d` | Este relatório, `CLAUDE.md` (a próxima sessão do Claude lê sozinha), imagens de referência copiadas para `referencias/` |
| `57e52b7` | Testes automáticos: `testes/test_radar.py` (Python) e `testes/carteira.test.js`, rodando no workflow separado `testes.yml` (um teste quebrado nunca para a coleta) |
| `4558ba9` | README atualizado (rodadas de 5 min, instalação, testes) |
| `15b9948` | Carteira: arquivo importado e dados salvos são conferidos linha a linha (bloqueia código injetado e `__proto__`); salvar/apagar/importar só mudam a tela se o navegador salvou; gráfico do patrimônio usa a mesma conta dos cartões (day trade e grupamento); ação sem arquivo de preços não apaga o gráfico; alertas de topo e de estratégia contam só a posição atual |
| `69cc47f` | App: voltar ao app não recarrega tudo (não perde formulário aberto); trava de rolagem da folha não sobra; falha de rede não apaga a tela; gráficos não desenham a ação antiga por cima da nova; botão Alvo/Preço justo volta a funcionar; globo e mapa mais robustos no celular; offline com fontes e ícones; busca acessível por teclado |
| `8946c97` | Robô: ação sem preço numa rodada não gera "saiu" + "entrou" falsos; alerta de preço não se repete; estado e cache salvos mesmo se um passo posterior falhar (evita notificação repetida); secret de push estragado não derruba a rodada; logs públicos sem endereço dos aparelhos; chave temporária apagada; perfil que falhou é tentado de novo em 30 min; cache pela data de Brasília |
| `f1f5639` | Ação com escala quebrada (AZUL3) publica o gráfico só a partir do último salto; tabelas ordenáveis pelo teclado; título da aba por tela; filtro da lista mais leve |
| `38a31c2` | Aviso "Dividendo alto fora do normal" (12 meses ≥ 2× a média dos 3 anos anteriores, DY > 12%; com menos de 4 anos de histórico, um pagamento único ≥ 15% do preço), e Bazin deixa de contar a favor nesses casos; rodada falha se o Fundamentus vier cortado (< 500 ações) |
| `8b6c409` | Feriados da B3 (`feriados_b3.txt`, calendário oficial de 2026): robô não encadeia rodadas em feriado (o agendamento de reserva continua rodando, sem efeito); app usa a hora de Brasília e mostra "Feriado na B3" em vez de "atrasado". **Em janeiro, acrescente os feriados de 2027** (a B3 publica no começo do ano) |
| `37eb45a`, `43efba9` | Globo: busca do país sob o mouse uma vez por quadro; Brasil aparece como base das cotações; nomes dos países em português do Brasil |
| `e68ecbf` | Textos do app falavam em rodadas de 15 min; agora 5 |
| `8fb3b34` | Prévia com nome e ícone ao compartilhar o link (WhatsApp etc.) |
| `70c6787` | Ajustes da revisão final: ação sem preço segura no estado por no máximo 24 h; pequenos erros de foco e de console |

Também conferido:

- Todas as telas cabem em 375 px de largura (celular) sem rolagem lateral; o app baixa ~190 KB
  comprimidos para abrir.
- Depois de cada mudança no Python, os dados publicados foram comparados com uma cópia de antes
  (quantidade de ações em cada estratégia e campos vazios). Nenhuma estratégia mudou sem querer.
- Uma revisão independente de todas as mudanças da noite não achou perda de dados: tudo o que o
  formulário antigo da carteira já salvou passa na nova conferência.

### Testes

```bash
.venv/Scripts/python -m unittest discover -s testes -v
```

```bash
node testes/carteira.test.js
```

28 testes no Python e 21 na carteira. Rodam sozinhos no GitHub a cada push (workflow *Testes*).

### Achados que dependem do dono (não mexi: são regras de investimento)

- **Holdings e seguradoras fora da detecção de "financeira":** BRAP4, CXSE3, ITSA3/4, PSSA3, BRBI11
  e BBSE3 passam pelas regras de empresa comum, mas números como margem líquida e dívida líquida não
  fazem sentido para elas (ex.: ITSA4 com margem de 215%). Reclassificar muda quem entra em Valor e
  dividendos (hoje ITSA4, PSSA3 e BRBI11 entram). Opção: lista explícita no `config.yaml`.
- **Exigir P/VP > 0 nas regras de empresas comuns:** hoje é o `pl ≥ 0,5` que barra empresas com
  patrimônio negativo (ROE sem sentido, ex.: RAIZ4 241%, BHIA3 160%). AZUL3 escapa do P/L e só não
  entra porque falta a queda de 52 semanas.
- **Histerese nas regras de preço:** uma ação perto do limite (ex.: queda de 29,8% ↔ 30,1% em Caiu
  demais) entra e sai a cada rodada, gerando notificações repetidas. Opção: entrar com 30% e só sair
  abaixo de 28%.

### Ideias para depois (não urgentes)

- Tirar o histórico de 10 anos de proventos (`proventos_todos`) do `universo.json` para um arquivo
  separado, carregado só pela carteira: o arquivo principal cairia de ~97 KB para ~69 KB comprimidos.
  Mexe nas contas da carteira, então pede cuidado e testes.
- Fazer o agendamento de reserva também pular os feriados (hoje só o encadeamento pula).
