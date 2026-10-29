# Radar B3

Antes de qualquer coisa, leia o [RELATORIO.md](RELATORIO.md): como o app funciona, fontes de dados,
pegadinhas já tratadas, visual e referências, histórico e pendências.

Regras combinadas com o dono (sempre):

1. Nunca criar compra, venda ou ordens no app.
2. Nunca publicar, imprimir ou commitar a chave privada VAPID (`vapid_private.pem`).
3. Commits com o e-mail noreply do repositório (já configurado no git local), mensagem em português
   terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; use `git commit -F arquivo`.
4. A carteira fica só no navegador (localStorage); nunca enviar para servidor.
5. Sem recomendação personalizada de investimento; mostrar dados com aviso.
6. O dono se preocupa com custo: poucos agentes, modelos baratos para tarefas em massa.
7. Responder em português do Brasil, com acentos, curto e sem jargão.

Não mude os limites das estratégias nem a watchlist no `config.yaml` por conta própria: são as regras
de investimento do dono. Só corrija bugs.

Depois de mudar algo, atualize a seção de histórico do RELATORIO.md.
