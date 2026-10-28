// Carteira: as operações ficam só neste aparelho (localStorage). Nada vai para servidor nenhum.
// Calcula preço médio, resultado, proventos recebidos e a comparação com o Ibovespa.
const CHAVE_CARTEIRA = "radar-carteira-v1";

function lerCarteira() {
  try { return JSON.parse(localStorage.getItem(CHAVE_CARTEIRA)) || { lancamentos: [] }; } catch { return { lancamentos: [] }; }
}
function salvarCarteira(c) {
  try { localStorage.setItem(CHAVE_CARTEIRA, JSON.stringify(c)); return true; } catch { return false; }
}
const hojeISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dataBR = (iso) => iso.split("-").reverse().join("/");

// Preço médio ponderado: compras somam ao custo; vendas tiram quantidade ao preço médio e geram lucro realizado.
function calcularCarteira(lancamentos) {
  const pos = {}, ordem = [...lancamentos].sort((a, b) => a.data.localeCompare(b.data) || a.criado - b.criado);
  let realizado = 0, aportes = 0, recebido = 0;
  const vendasMes = {};
  for (const l of ordem) {
    const p = (pos[l.papel] ||= { papel: l.papel, qtd: 0, custo: 0, realizado: 0, eventos: [] });
    if (l.tipo === "compra") {
      p.custo += l.qtd * l.preco + (l.taxas || 0);
      aportes += l.qtd * l.preco + (l.taxas || 0);
      p.qtd += l.qtd;
    } else {
      const pm = p.qtd ? p.custo / p.qtd : 0, q = Math.min(l.qtd, p.qtd);
      const lucro = (l.preco - pm) * q - (l.taxas || 0);
      p.realizado += lucro; realizado += lucro;
      recebido += q * l.preco - (l.taxas || 0);
      p.custo -= pm * q; p.qtd -= q;
      const mes = l.data.slice(0, 7);
      vendasMes[mes] = (vendasMes[mes] || 0) + l.qtd * l.preco;
    }
    p.eventos.push({ data: l.data, qtd: p.qtd });
  }
  // Proventos: quantidade que a pessoa tinha antes da data ex × valor por ação (valores brutos)
  for (const p of Object.values(pos)) {
    p.proventos = 0;
    for (const [dataEx, valor] of estado.universo[p.papel]?.proventos || []) {
      const antes = p.eventos.filter((e) => e.data < dataEx).at(-1);
      if (antes?.qtd > 0) p.proventos += antes.qtd * valor;
    }
    p.preco = precoDe(p.papel);
    p.valor = p.preco != null ? p.qtd * p.preco : p.custo;
    p.pm = p.qtd ? p.custo / p.qtd : null;
    p.resultado = p.valor - p.custo;
  }
  const abertas = Object.values(pos).filter((p) => p.qtd > 0);
  const investido = abertas.reduce((s, p) => s + p.custo, 0), valor = abertas.reduce((s, p) => s + p.valor, 0);
  const proventos = Object.values(pos).reduce((s, p) => s + p.proventos, 0);
  return { pos, abertas, investido, valor, proventos, realizado, aportes, recebido, vendasMes, primeira: ordem[0]?.data };
}

// Quanto o Ibovespa andou desde a primeira compra (só dá para medir dentro do último ano de dados)
function ibovDesde(data) {
  const s = estado.resultado.mercado?.ibovespa?.serie;
  if (!s?.length || !data) return null;
  const ini = s.find(([d]) => d >= data);
  return ini ? { v: dif(s.at(-1)[1], ini[1]), desde: ini[0] } : null;
}

function telaCarteira() {
  const cart = lerCarteira(), c = calcularCarteira(cart.lancamentos);
  // Rentabilidade simples: (valor de hoje + o que voltou em vendas + proventos − tudo que foi investido) ÷ investido
  const rent = c.aportes ? ((c.valor + c.recebido + c.proventos - c.aportes) / c.aportes) * 100 : null;
  const ibov = ibovDesde(c.primeira);
  const mes = hojeISO().slice(0, 7), vendidoMes = c.vendasMes[mes] || 0;
  const papeis = Object.keys(estado.universo).sort();
  const pre = estado.carteiraPapel || "";
  estado.carteiraPapel = null;

  tela.innerHTML = `${cabecalho("Carteira", "Registre suas compras e vendas para acompanhar preço médio, resultado e proventos. <b>Os dados ficam só neste aparelho</b>; use Exportar para guardar uma cópia.")}
    ${cart.lancamentos.length ? `
    <section class="painel carteira-resumo">
      <div><span>Patrimônio hoje</span><b>${reais(c.valor)}</b><em class="faint">${c.abertas.length} ${c.abertas.length === 1 ? "ação" : "ações"}</em></div>
      <div><span>Investido (custo)</span><b>${reais(c.investido)}</b><em class="faint">preço médio × quantidade</em></div>
      <div><span>Resultado em aberto</span><b class="${cls(c.valor - c.investido)}">${reais(c.valor - c.investido)}</b><em class="${cls(c.valor - c.investido)}">${sinal(dif(c.valor, c.investido))}</em></div>
      <div><span>Proventos recebidos</span><b class="pos">${reais(c.proventos)}</b><em class="faint">no último ano, valores brutos</em></div>
      <div><span>Lucro com vendas</span><b class="${cls(c.realizado)}">${reais(c.realizado)}</b><em class="faint">já realizado</em></div>
      <div><span>Você × Ibovespa</span><b class="${cls(rent)}">${sinal(rent, 1)}</b><em class="faint">${ibov ? `Ibovespa ${sinal(ibov.v, 1)} desde ${dataBR(ibov.desde)}` : "sem dados do período"}</em></div>
    </section>` : ""}

    <section class="painel s5" id="form-carteira">
      <div class="painel-cabeca"><h2>Registrar operação</h2></div>
      <div class="pilulas" style="margin-bottom:14px"><button type="button" data-op="compra" class="ativo">Compra</button><button type="button" data-op="venda">Venda</button></div>
      <form class="form-op" id="form-op" novalidate>
        <label>Ação<input id="op-papel" list="lista-papeis" placeholder="Ex.: PETR4" value="${esc(pre)}" autocomplete="off" required></label>
        <datalist id="lista-papeis">${papeis.map((p) => `<option value="${p}">`).join("")}</datalist>
        <div class="form-linha">
          <label>Data<input id="op-data" type="date" value="${hojeISO()}" max="${hojeISO()}" required></label>
          <label>Quantidade<input id="op-qtd" type="number" min="1" step="1" placeholder="100" required></label>
        </div>
        <div class="form-linha">
          <label>Preço por ação (R$)<input id="op-preco" type="number" min="0.01" step="0.01" placeholder="0,00" required></label>
          <label>Taxas (R$, opcional)<input id="op-taxas" type="number" min="0" step="0.01" placeholder="0,00"></label>
        </div>
        <p class="erro-form" id="erro-op" role="alert"></p>
        <button class="botao-fogo" type="submit"><i class="ti ti-plus"></i>Salvar operação</button>
      </form>
      <div class="acoes-carteira">
        <button class="botao contorno" type="button" id="exportar"><i class="ti ti-download"></i>Exportar</button>
        <label class="botao contorno"><i class="ti ti-upload"></i>Importar<input type="file" id="importar" accept="application/json" hidden></label>
      </div>
    </section>

    <section class="painel s7">
      <div class="painel-cabeca"><h2>Suas posições</h2>${c.abertas.length ? `<span class="extra">clique numa ação para ver a análise</span>` : ""}</div>
      ${c.abertas.length ? `<div class="rolagem"><table><thead><tr><th>Ação</th><th class="n">Qtd.</th><th class="n esconde-celular">Preço médio</th><th class="n">Atual</th><th class="n">Resultado</th><th class="n esconde-celular">Peso</th></tr></thead><tbody>
        ${[...c.abertas].sort((a, b) => b.valor - a.valor).map((p) => `<tr data-href="#acao/${esc(p.papel)}"><td>${ativoCel(p.papel)}</td><td class="n">${num(p.qtd, 0)}</td>
          <td class="n esconde-celular">${reais(p.pm)}</td><td class="n">${reais(p.preco)}</td>
          <td class="n"><span class="${cls(p.resultado)}">${reais(p.resultado)}</span><br><span class="faint ${cls(p.resultado)}">${sinal(dif(p.valor, p.custo))}</span></td>
          <td class="n esconde-celular"><div class="barra-fina" style="width:90px"><span style="width:${c.valor ? (p.valor / c.valor) * 100 : 0}%"></span></div>${num(c.valor ? (p.valor / c.valor) * 100 : 0, 0)}%</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="vazio">Nenhuma posição ainda. Registre sua primeira compra ao lado. Dica: na tela de qualquer ação há o botão "Pôr na carteira".</div>`}
      ${vendidoMes ? `<p class="aviso-estudo" style="margin-top:14px"><i class="ti ti-receipt-tax"></i>Neste mês você vendeu ${reais(vendidoMes)} em ações. ${vendidoMes > 20000 ? "Acima de R$ 20 mil em vendas no mês, o lucro com ações costuma pagar 15% de imposto de renda (DARF até o último dia útil do mês seguinte)." : "Até R$ 20 mil em vendas no mês, o lucro com ações costuma ser isento de imposto de renda."} Regras de imposto mudam; confirme com sua corretora ou um contador.</p>` : ""}
    </section>

    ${cart.lancamentos.length ? `<section class="painel">
      <div class="painel-cabeca"><h2>Histórico de operações</h2><span class="extra">${cart.lancamentos.length} operações</span></div>
      <div class="rolagem"><table><thead><tr><th>Data</th><th>Tipo</th><th>Ação</th><th class="n">Qtd.</th><th class="n">Preço</th><th class="n esconde-celular">Total</th><th></th></tr></thead><tbody>
        ${[...cart.lancamentos].sort((a, b) => b.data.localeCompare(a.data) || b.criado - a.criado).map((l) => `<tr class="sem-link"><td>${dataBR(l.data)}</td>
          <td><span class="pilula ${l.tipo === "compra" ? "pos" : "neg"}">${l.tipo}</span></td><td><b>${esc(l.papel)}</b></td><td class="n">${num(l.qtd, 0)}</td>
          <td class="n">${reais(l.preco)}</td><td class="n esconde-celular">${reais(l.qtd * l.preco + (l.tipo === "compra" ? 1 : -1) * (l.taxas || 0))}</td>
          <td class="n"><button type="button" class="apagar-op" data-id="${l.id}" aria-label="Apagar operação"><i class="ti ti-trash"></i></button></td></tr>`).join("")}
      </tbody></table></div></section>` : ""}
    ${rodape()}`;

  let tipo = "compra";
  ligarAbas(tela, "op", (t) => { tipo = t; });
  const campoPapel = $("#op-papel"), campoPreco = $("#op-preco");
  const sugerirPreco = () => { const p = precoDe(campoPapel.value.trim().toUpperCase()); if (p && !campoPreco.value) campoPreco.value = p.toFixed(2); };
  campoPapel.addEventListener("change", sugerirPreco);
  if (pre) sugerirPreco();
  $$("#form-op input").forEach((i) => i.addEventListener("input", () => { $("#erro-op").textContent = ""; }));

  $("#form-op").onsubmit = (ev) => {
    ev.preventDefault();
    const papel = campoPapel.value.trim().toUpperCase(), data = $("#op-data").value;
    const qtd = Number($("#op-qtd").value), preco = Number(campoPreco.value), taxas = Number($("#op-taxas").value || 0);
    const erro = !/^[A-Z]{4}\d{1,2}F?$/.test(papel) ? "Digite o código da ação, por exemplo PETR4."
      : !data || data > hojeISO() ? "Escolha a data da operação (não pode ser no futuro)."
      : !(qtd > 0) || !Number.isInteger(qtd) ? "A quantidade precisa ser um número inteiro maior que zero."
      : !(preco > 0) ? "Informe o preço pago por ação."
      : taxas < 0 ? "As taxas não podem ser negativas." : "";
    if (!erro && tipo === "venda") {
      const tem = calcularCarteira(cart.lancamentos.filter((l) => l.data <= data)).pos[papel.replace(/F$/, "")]?.qtd || 0;
      if (qtd > tem) { $("#erro-op").textContent = `Você tinha ${num(tem, 0)} ações de ${papel} nessa data; não dá para vender ${num(qtd, 0)}.`; return; }
    }
    if (erro) { $("#erro-op").textContent = erro; return; }
    // Fracionário (PETR4F) é a mesma ação da posição PETR4
    cart.lancamentos.push({ id: crypto.randomUUID?.() || String(Date.now()), criado: Date.now(), tipo, papel: papel.replace(/F$/, ""), data, qtd, preco, taxas });
    if (!salvarCarteira(cart)) { $("#erro-op").textContent = "Este navegador não deixou salvar (modo anônimo?). Exporte para não perder."; return; }
    telaCarteira();
  };
  $$(".apagar-op").forEach((b) => b.onclick = () => {
    if (!confirm("Apagar esta operação da carteira?")) return;
    cart.lancamentos = cart.lancamentos.filter((l) => l.id !== b.dataset.id);
    salvarCarteira(cart);
    telaCarteira();
  });
  $("#exportar").onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(cart, null, 1)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `carteira-radar-${hojeISO()}.json` });
    a.click(); URL.revokeObjectURL(url);
  };
  $("#importar").onchange = async (ev) => {
    try {
      const dado = JSON.parse(await ev.target.files[0].text());
      if (!Array.isArray(dado.lancamentos)) throw new Error();
      if (!confirm(`Substituir a carteira atual pelas ${dado.lancamentos.length} operações do arquivo?`)) return;
      salvarCarteira(dado); telaCarteira();
    } catch { alert("Arquivo inválido: use um arquivo exportado pelo Radar B3."); }
  };
  ligarLinhas();
}
