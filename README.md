# 📡 Radar B3

App de triagem de ações da B3 com notificações. A cada ~5 minutos de pregão ele baixa os
indicadores de ~1000 papéis, aplica as **suas** regras (no `config.yaml`) e manda uma
notificação no celular só quando algo muda: quando um papel entra ou sai de uma estratégia,
ou cruza um preço da sua watchlist. Também tem análise de cada ação, carteira pessoal (fica só
no seu navegador), globo com as bolsas do mundo e mapa do mercado.

📘 **Vai mexer no projeto?** Leia antes o [RELATORIO.md](RELATORIO.md): como tudo funciona,
pegadinhas dos dados, referências visuais, histórico e pendências.

**App:** https://jvcarvalho07.github.io/radar-b3/

> ⚠️ Não é recomendação de investimento. O Radar só mostra quem cumpre os critérios que
> você definiu e por quê. Ele **não** compra nem vende nada.

## Como funciona

```
GitHub Actions (a cada ~5 min no pregão, 10h–18h de Brasília)
  └─ scan.py ─ baixa dados ─ aplica estratégias ─ compara com a última vez
       ├─ mudou algo? → notificação push nos seus aparelhos
       ├─ estado e histórico → branch "dados"
       └─ app + JSON → GitHub Pages
```

Tudo roda de graça: GitHub Actions é ilimitado em repositório público, e o GitHub Pages hospeda o app.
Quando sai versão nova do código, o app (inclusive o instalado no celular) se atualiza sozinho.

## Instalar no celular

1. Abra o link do app no navegador do celular.
2. **Android (Chrome):** toque em **Instalar** no aviso que aparece (ou menu ⋮ → *Instalar app*).
   **iPhone (Safari):** botão Compartilhar → *Adicionar à Tela de Início*. No iPhone, as
   notificações só funcionam abrindo o app pelo ícone (iOS 16.4 ou mais novo).
   Não precisa reinstalar quando o app muda: ele se atualiza sozinho.
3. Abra pelo ícone, vá em **Alertas → Ativar notificações** e permita.
4. O app mostra um código. Copie, abra as *Secrets* do repositório (o app tem o link) e crie
   o secret **`PUSH_SUBSCRIPTIONS`** com esse código. Vários aparelhos: um código por linha.
   Guarde uma cópia, porque o GitHub não deixa ver o secret depois.

A chave privada das notificações fica no secret `VAPID_PRIVATE_KEY` (configurada uma vez
com o comando `gh secret set VAPID_PRIVATE_KEY < vapid_private.pem`). Nunca publique o
arquivo `vapid_private.pem`.

Se um aparelho for desinscrito (reinstalou o app, limpou os dados), o app avisa
"notificações desativadas". Ative de novo e troque o código no secret.

## Ajustando as regras

Tudo fica no [`config.yaml`](config.yaml). Dá para editar direto pelo site do GitHub
(ícone de lápis), e a próxima execução já usa as regras novas:

- `liquidez_minima`: ignora ações com pouca negociação (padrão: R$ 2 milhões/dia).
- `estrategias`: três prontas (Valor e dividendos, Caiu demais, Qualidade). Mude os
  `min`/`max`, apague ou crie novas copiando o formato.
- `criterios_financeiras`: regras próprias para bancos e seguradoras, que não têm dívida
  líquida, margens nem ROIC no sentido usual. Se uma estratégia não tiver essa lista, as
  financeiras ficam de fora dela.
- `watchlist`: seus papéis, com `abaixo_de` e `acima_de` opcionais para alerta de preço.

Para rodar na hora, sem esperar: aba **Actions** → *Radar B3* → **Run workflow**.

## Rodar no seu computador (opcional)

Precisa do Python 3.11 ou mais novo. Dentro desta pasta:

```bash
py -m venv .venv
```

```bash
.venv/Scripts/python -m pip install -r requirements.txt
```

```bash
.venv/Scripts/python scan.py
```

```bash
.venv/Scripts/python -m http.server 8000 -d publico
```

Depois abra http://localhost:8000. Localmente, o estado fica em `dados/` e o cache em `cache/`.

## Limitações

- **Atraso de ~15 min nos preços:** dados da B3 em tempo real são licenciados e pagos.
  As fontes gratuitas (Yahoo Finance) têm esse atraso.
- **Horários do GitHub Actions:** o agendamento é "melhor esforço" e às vezes atrasa alguns
  minutos ou pula uma execução em horário de pico.
- **60 dias sem atividade:** em repositório público, o GitHub pode desativar agendamentos
  depois de 60 dias sem atividade no repositório. Ele avisa por e-mail; é só entrar em
  *Actions* e clicar em *Enable workflow*.
- **Fontes não oficiais:** Fundamentus, Yahoo Finance e AwesomeAPI são gratuitas e podem
  mudar de formato ou bloquear acessos. Se o Fundamentus mudar a tabela, a execução falha com
  uma mensagem clara, em vez de mandar alertas errados.

## Estrutura

```
config.yaml               suas regras e watchlist
scan.py                   triagem + notificações + gera o site
radar/fontes.py           coleta (Fundamentus, Yahoo Finance, AwesomeAPI, PTAX do Banco Central) com cache diário
radar/screener.py         aplica as estratégias e explica os motivos
radar/analise.py          preço justo, faixas de preço, sinais a favor e de atenção
radar/alertas.py          compara com a execução anterior e envia o push
radar/publicar.py         monta a pasta publico/ (app + JSON) e carimba a versão do app
site/                     o app (HTML, CSS, JS, service worker, ícones)
.github/workflows/        radar.yml (coleta e publicação) e testes.yml (testes automáticos)
testes/                   testes do Python e das contas da carteira
RELATORIO.md              tudo sobre o projeto, para quem for continuar
```

## Testes

```bash
.venv/Scripts/python -m unittest discover -s testes -v
```

```bash
node testes/carteira.test.js
```

Os dois rodam sozinhos no GitHub a cada push (workflow *Testes*), separados da coleta.
