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

// Quantidade na escala de hoje. Desdobramento e bonificação multiplicam. No grupamento, a fração que sobra
// vai para o caixa ao preço médio (lucro zero), e a posição fica com ações inteiras, como na corretora.
function aplicarFator(d, fator, data) {
  const bruto = d.qtd * fator, novo = Math.floor(bruto + 1e-9), frac = bruto - novo;
  if (bruto > 0 && frac > 1e-9) {
    const dinheiro = d.custo * (frac / bruto);
    d.custo -= dinheiro; d.recebido += dinheiro;
  }
  d.qtd = novo;
  d.eventos.push({ data, qtd: novo });
}

// Fator dos desdobramentos depois de uma data. O Yahoo ajusta os proventos anteriores a um
// desdobramento (verificado em BBAS3), então a quantidade da época precisa desse fator para bater com o valor.
function fatorApos(papel, data) {
  return (estado.universo[papel]?.desdobramentos || []).reduce((f, [s, fator]) => (s > data ? f * fator : f), 1);
}

// Operações do mesmo papel no mesmo dia formam um bloco. Dentro do bloco, o que foi comprado e vendido no
// mesmo dia é day trade: o lucro fica à parte e não muda o preço médio. Só o que sobra entra na posição
// ou sai dela, ao preço médio anterior. O resultado não depende da ordem em que as operações foram digitadas.
function calcularCarteira(lancamentos) {
  const papeis = [...new Set(lancamentos.map((l) => l.papel))];
  const eventos = papeis.flatMap((papel) => (estado.universo[papel]?.desdobramentos || [])
    .map(([data, fator]) => ({ tipo: "desdobramento", papel, data, fator, criado: 0 })));
  const blocos = new Map();
  for (const l of lancamentos) {
    const k = `${l.papel}|${l.data}`;
    if (!blocos.has(k)) blocos.set(k, { tipo: "dia", papel: l.papel, data: l.data, criado: 1, ops: [] });
    blocos.get(k).ops.push(l);
  }
  // No mesmo dia, o desdobramento vem antes das operações (criado 0 contra 1).
  const ordem = [...eventos, ...blocos.values()].sort((a, b) => a.data.localeCompare(b.data) || a.criado - b.criado);
  const pos = {}, vendasMes = {}, dayMes = {}, fluxos = [];
  let realizado = 0, excesso = 0;
  for (const it of ordem) {
    if (it.tipo === "desdobramento") {
      if (pos[it.papel]?.qtd > 0) aplicarFator(pos[it.papel], it.fator, it.data);
      continue;
    }
    const p = (pos[it.papel] ||= { papel: it.papel, qtd: 0, custo: 0, realizado: 0, aportes: 0, recebido: 0, proventos: 0, eventos: [] });
    const compras = it.ops.filter((l) => l.tipo === "compra"), vendas = it.ops.filter((l) => l.tipo === "venda");
    const qC = compras.reduce((s, l) => s + l.qtd, 0), cC = compras.reduce((s, l) => s + l.qtd * l.preco + (l.taxas || 0), 0);
    const qV = vendas.reduce((s, l) => s + l.qtd, 0), rV = vendas.reduce((s, l) => s + l.qtd * l.preco - (l.taxas || 0), 0);
    const bV = vendas.reduce((s, l) => s + l.qtd * l.preco, 0);
    const mes = it.data.slice(0, 7);
    p.aportes += cC; p.recebido += rV;
    for (const l of compras) fluxos.push({ papel: l.papel, data: l.data, tipo: "compra", valor: l.qtd * l.preco + (l.taxas || 0) });
    for (const l of vendas) fluxos.push({ papel: l.papel, data: l.data, tipo: "venda", valor: l.qtd * l.preco - (l.taxas || 0) });
    // Day trade: o que entrou e saiu no mesmo dia, até o menor dos dois volumes
    const dt = Math.min(qC, qV);
    if (dt > 0) {
      const lucro = dt * (rV / qV) - dt * (cC / qC);
      p.realizado += lucro; realizado += lucro;
      dayMes[mes] = (dayMes[mes] || 0) + dt * (bV / qV);
    }
    // Sobra de compra entra na posição ao custo
    if (qC > dt) {
      const sobra = qC - dt;
      p.qtd += sobra; p.custo += cC * (sobra / qC);
    }
    // Sobra de venda sai da posição ao preço médio anterior
    if (qV > dt) {
      const rem = qV - dt, rec = rV * (rem / qV), grossRem = bV * (rem / qV);
      const q = Math.min(rem, p.qtd), pm = p.qtd ? p.custo / p.qtd : 0;
      const lucro = (rec / rem) * q - pm * q;
      p.realizado += lucro; realizado += lucro;
      p.custo -= pm * q; p.qtd -= q;
      if (p.qtd === 0) p.custo = 0;
      excesso += rem - q;
      vendasMes[mes] = (vendasMes[mes] || 0) + grossRem;
    }
    p.eventos.push({ data: it.data, qtd: p.qtd });
  }

  const rent = { aportes: 0, recebido: 0, proventos: 0 };
  for (const p of Object.values(pos)) {
    // Todo o histórico de proventos (proventos_todos; se não houver, o último ano).
    // Quantidade que a pessoa tinha antes da data ex, levada à escala de hoje, × valor por ação.
    const u = estado.universo[p.papel] || {};
    for (const [dataEx, valor] of u.proventos_todos || u.proventos || []) {
      const antes = p.eventos.filter((e) => e.data < dataEx).at(-1);
      if (antes?.qtd > 0) p.proventos += antes.qtd * fatorApos(p.papel, dataEx) * valor;
    }
    p.preco = precoDe(p.papel);
    p.valor = p.preco != null ? p.qtd * p.preco : null;   // sem cotação: fora do patrimônio
    p.resultado = p.valor != null ? p.valor - p.custo : null;
    p.pm = p.qtd ? p.custo / p.qtd : null;
    // Rentabilidade só com posições que têm cotação ou que já foram zeradas
    if (p.qtd === 0 || p.preco != null) { rent.aportes += p.aportes; rent.recebido += p.recebido; rent.proventos += p.proventos; }
  }
  const incluido = (papel) => pos[papel].preco != null || pos[papel].qtd === 0;
  const abertas = Object.values(pos).filter((p) => p.qtd > 0);
  const comPreco = abertas.filter((p) => p.preco != null);
  const semPreco = abertas.filter((p) => p.preco == null).map((p) => p.papel);
  const investido = comPreco.reduce((s, p) => s + p.custo, 0), valor = comPreco.reduce((s, p) => s + p.valor, 0);
  const proventos = Object.values(pos).reduce((s, p) => s + p.proventos, 0);
  const primeira = [...lancamentos].sort((a, b) => a.data.localeCompare(b.data))[0]?.data;
  const semHistorico = papeis.filter((x) => estado.universo[x]?.eventos_incompletos);
  return {
    pos, abertas, comPreco, semPreco, investido, valor, proventos, realizado, rent,
    vendasMes, dayMes, primeira, excesso, semHistorico,
    fluxos: fluxos.filter((f) => incluido(f.papel)),   // mesmas operações da rentabilidade
  };
}

// O Ibovespa recebe as mesmas datas e valores das operações: cada compra vira cotas no nível do índice
// no dia dela; cada venda tira cotas no nível do dia dela; as cotas que sobram valem o índice de hoje.
// Mesma conta da carteira, sobre a série de retorno total (BOVA11 ajustado por proventos). Se uma venda tirar mais cotas do que
// as compras puseram, o saldo fica negativo: a conta continua valendo e indica que a ação rendeu acima do índice.
function ibovEquivalente(fluxos) {
  const m = estado.resultado.mercado?.ibovespa, s = m?.serie_total || m?.serie;
  const total = !!m?.serie_total;   // sem ela (resultado antigo), usa o índice de preço
  if (!s?.length || !fluxos.length) return null;
  const primeira = fluxos.map((f) => f.data).sort()[0];
  if (primeira < s[0][0]) return { antes: s[0][0] };
  const nivel = (d) => (s.find(([x]) => x >= d) || s.at(-1))[1];   // primeiro pregão em ou depois da data
  let cotas = 0, aplicado = 0, resgatado = 0;
  for (const f of fluxos) {
    if (f.tipo === "compra") { cotas += f.valor / nivel(f.data); aplicado += f.valor; }
    else { cotas -= f.valor / nivel(f.data); resgatado += f.valor; }
  }
  if (!aplicado) return null;
  const ganho = cotas * s.at(-1)[1] + resgatado - aplicado;
  return { v: (ganho / aplicado) * 100, desde: primeira, total };
}

function telaCarteira() {
  const cart = lerCarteira(), c = calcularCarteira(cart.lancamentos);
  // Rentabilidade simples: (valor de hoje + o que voltou em vendas + proventos − tudo que foi investido) ÷ investido
  const rent = c.rent.aportes ? ((c.valor + c.rent.recebido + c.rent.proventos - c.rent.aportes) / c.rent.aportes) * 100 : null;
  const ibov = ibovEquivalente(c.fluxos);
  const dife = ibov?.v != null && rent != null ? rent - ibov.v : null;   // em pontos percentuais
  const suspeitas = c.abertas.map((p) => p.papel).filter((x) => estado.universo[x]?.dados_suspeitos);
  const escala = c.abertas.map((p) => p.papel).filter((x) => estado.universo[x]?.escala_quebrada);
  const mes = hojeISO().slice(0, 7), vendidoMes = c.vendasMes[mes] || 0, dayMes = c.dayMes[mes] || 0;
  const papeis = Object.keys(estado.universo).sort();
  const pre = estado.carteiraPapel || "";
  estado.carteiraPapel = null;

  tela.innerHTML = `${cabecalho("Carteira", "Registre suas compras e vendas para acompanhar preço médio, resultado e proventos. <b>Os dados ficam só neste aparelho</b>; use Exportar para guardar uma cópia.")}
    ${cart.lancamentos.length ? `
    <section class="painel carteira-resumo">
      <div><span>Patrimônio hoje</span><b>${reais(c.valor)}</b><em class="faint">${c.abertas.length} ${c.abertas.length === 1 ? "ação" : "ações"}</em></div>
      <div><span>Investido (custo)</span><b>${reais(c.investido)}</b><em class="faint">preço médio × quantidade</em></div>
      <div><span>Resultado em aberto</span><b class="${cls(c.valor - c.investido)}">${reais(c.valor - c.investido)}</b><em class="${cls(c.valor - c.investido)}">${sinal(dif(c.valor, c.investido))}</em></div>
      <div><span>Proventos recebidos</span><b class="pos">${reais(c.proventos)}</b><em class="faint">desde a primeira compra, valores brutos</em></div>
      <div><span>Lucro com vendas</span><b class="${cls(c.realizado)}">${reais(c.realizado)}</b><em class="faint">já realizado, day trade incluído</em></div>
      <div><span>Você × Ibovespa</span><b class="${cls(dife)}">${sinal(dife, 1)}</b><em class="faint">${ibov?.v != null ? `diferença em pontos; você ${sinal(rent, 1)}, Ibovespa ${sinal(ibov.v, 1)} nas mesmas datas das operações${ibov.total ? ", com dividendos (BOVA11)" : ", só preço: a diferença fica a favor da carteira, que recebe proventos"}` : ibov?.antes ? `compra anterior a ${dataBR(ibov.antes)}, início da série do Ibovespa; sem comparação` : "sem dados do período"}</em></div>
    </section>` : ""}
    ${c.abertas.length ? secaoSaidas() : ""}

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
        ${[...c.abertas].sort((a, b) => (b.valor ?? -1) - (a.valor ?? -1)).map((p) => {
          const peso = p.valor != null && c.valor ? (p.valor / c.valor) * 100 : 0;
          return `<tr data-href="#acao/${esc(p.papel)}"><td><div style="display:flex;align-items:center;gap:8px">${ativoCel(p.papel)}<span class="marca-saida" data-saida-marca="${esc(p.papel)}" hidden title="Uma regra de saída disparou"><i class="ti ti-bell-ringing"></i></span></div></td><td class="n">${num(p.qtd, 0)}</td>
          <td class="n esconde-celular">${reais(p.pm)}</td><td class="n">${reais(p.preco)}</td>
          <td class="n"><span class="${cls(p.resultado)}">${reais(p.resultado)}</span><br><span class="faint ${cls(p.resultado)}">${sinal(dif(p.valor, p.custo))}</span></td>
          <td class="n esconde-celular"><div class="barra-fina" style="width:90px"><span style="width:${peso}%"></span></div>${num(peso, 0)}%</td></tr>`;
        }).join("")}
      </tbody></table></div>
      ${c.semPreco.length ? `<p class="faint" style="margin-top:10px">Sem cotação, fora do patrimônio e da rentabilidade: ${c.semPreco.map(esc).join(", ")}.</p>` : ""}
      ${escala.length ? `<p class="faint" style="margin-top:10px">Escala de preço quebrada em ${escala.map(esc).join(", ")}: mínima, máxima e alerta de topo ficam desligados até a fonte corrigir a série.</p>` : ""}
      ${suspeitas.length ? `<p class="faint" style="margin-top:10px">Cotação com salto de preço sem evento registrado em ${suspeitas.map(esc).join(", ")}: confira o preço na corretora e, se houve desdobramento ou grupamento, a quantidade. Os alertas continuam ativos, com esse aviso.</p>` : ""}
      ${c.semHistorico.length ? `<p class="faint" style="margin-top:10px">Sem o histórico completo de desdobramentos e proventos de ${c.semHistorico.map(esc).join(", ")}: os números dessas ações podem estar errados até a próxima atualização.</p>` : ""}` : `<div class="vazio">Nenhuma posição ainda. Registre sua primeira compra ao lado. Dica: na tela de qualquer ação há o botão "Pôr na carteira".</div>`}
      ${vendidoMes || dayMes ? `<p class="aviso-estudo" style="margin-top:14px"><i class="ti ti-receipt-tax"></i>${vendidoMes ? `Neste mês você vendeu ${reais(vendidoMes)} em ações, fora o day trade. ${vendidoMes > 20000 ? "Acima de R$ 20 mil em vendas no mês, o lucro com ações costuma pagar 15% de imposto de renda (DARF até o último dia útil do mês seguinte)." : "Até R$ 20 mil em vendas no mês, o lucro com ações costuma ser isento de imposto de renda."} ` : ""}${dayMes ? `Day trade (comprou e vendeu no mesmo dia) neste mês: ${reais(dayMes)} de volume. Esse lucro não entra na isenção de R$ 20 mil e costuma ser tributado a 20%.` : ""} Regras de imposto mudam; confirme com sua corretora ou um contador.</p>` : ""}
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
  const sugerirPreco = () => { const p = precoDe(campoPapel.value.trim().toUpperCase().replace(/F$/, "")); if (p && !campoPreco.value) campoPreco.value = p.toFixed(2); };
  campoPapel.addEventListener("change", sugerirPreco);
  if (pre) sugerirPreco();
  $$("#form-op input").forEach((i) => i.addEventListener("input", () => { $("#erro-op").textContent = ""; }));

  $("#form-op").onsubmit = (ev) => {
    ev.preventDefault();
    const papel = campoPapel.value.trim().toUpperCase(), data = $("#op-data").value;
    const base = papel.replace(/F$/, "");   // PETR4F é a mesma posição de PETR4
    const qtd = Number($("#op-qtd").value), preco = Number(campoPreco.value), taxas = Number($("#op-taxas").value || 0);
    let erro = !/^[A-Z][A-Z0-9]{3}\d{1,2}F?$/.test(papel) ? "Digite o código da ação, por exemplo PETR4."
      : !data || data > hojeISO() ? "Escolha a data da operação (não pode ser no futuro)."
      : !(qtd > 0) || !Number.isInteger(qtd) ? "A quantidade precisa ser um número inteiro maior que zero."
      : !(preco > 0) ? "Informe o preço pago por ação."
      : taxas < 0 ? "As taxas não podem ser negativas." : "";
    if (!erro) {
      // Recusa só a operação que aumenta a venda sem saldo na linha do tempo inteira
      // (dados antigos já inconsistentes não bloqueiam tudo)
      const novo = { id: "novo", criado: Date.now(), tipo, papel: base, data, qtd, preco, taxas };
      const antes = calcularCarteira(cart.lancamentos).excesso;
      if (calcularCarteira([...cart.lancamentos, novo]).excesso > antes)
        erro = tipo === "venda"
          ? `Não há ${num(qtd, 0)} ações de ${base} para vender nessa data (ou numa venda posterior). Registre a compra antes e confira as datas.`
          : `Esta compra deixaria uma venda posterior de ${base} sem ações. Confira datas e quantidades.`;
    }
    if (erro) { $("#erro-op").textContent = erro; return; }
    const estrategias = tipo === "compra" ? Object.entries(estado.resultado.estrategias).filter(([, e]) => e.papeis.some((x) => x.papel === base)).map(([k]) => k) : [];
    cart.lancamentos.push({ id: crypto.randomUUID?.() || String(Date.now()), criado: Date.now(), tipo, papel: base, data, qtd, preco, taxas, estrategias });
    estado.saidasCache = null;
    if (!salvarCarteira(cart)) { $("#erro-op").textContent = "Este navegador não deixou salvar (modo anônimo?). Exporte para não perder."; return; }
    telaCarteira();
  };
  $$(".apagar-op").forEach((b) => b.onclick = () => {
    const restantes = cart.lancamentos.filter((l) => l.id !== b.dataset.id);
    const antes = c.excesso;
    if (calcularCarteira(restantes).excesso > antes) { alert("Não dá para apagar: uma venda depois dela ficaria sem ações. Apague ou corrija a venda primeiro."); return; }
    if (!confirm("Apagar esta operação da carteira?")) return;
    cart.lancamentos = restantes;
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
      if (!Array.isArray(dado.lancamentos)) throw new Error("formato");
      const sem = calcularCarteira(dado.lancamentos).excesso;   // vendas sem compra correspondente (dados antigos ou compra apagada)
      const aviso = sem ? `Atenção: ${num(sem, 0)} ações vendidas não têm compra correspondente no arquivo. O lucro dessas vendas fica de fora. ` : "";
      if (!confirm(`${aviso}Substituir a carteira atual pelas ${dado.lancamentos.length} operações do arquivo?`)) return;
      salvarCarteira(dado); telaCarteira();
    } catch { alert("Arquivo inválido: use um arquivo exportado pelo Radar B3."); }
  };
  ligarLinhas();
  if (c.abertas.length) montarSaidas(cart);
}

// ---------- Regras de saída ----------
// A pessoa define as regras uma vez; o app confere cada posição sempre que é aberto.
// Elas não mandam vender: avisam que chegou a hora de reavaliar, com o motivo na tela.
const SAIDA_PADRAO = { estrategia: true, alvo: true, graham: true, quedaTopo: 15, quedaPM: 20, pesoMax: 25 };
const configSaida = (cart) => ({ ...SAIDA_PADRAO, ...(cart.saida || {}) });

// Maior fechamento desde a compra, nos dados do app (último ano). Se a compra é anterior aos dados,
// o topo é do período disponível (`parcial`): o alerta diz isso. Um topo parcial é menor ou igual ao real,
// então pode deixar de avisar, mas não avisa por engano.
async function topoDesde(papel, data) {
  try {
    const velas = await carregarJSON(`dados/precos/${papel}.json`);
    if (!velas.length) return null;
    const parcial = data < velas[0][0];
    const desde = velas.filter((v) => v[0] >= data);
    return desde.length ? { topo: Math.max(...desde.map((v) => v[4])), desde: parcial ? velas[0][0] : data, parcial } : null;
  } catch { return null; }
}

// Lista os alertas de cada posição aberta. Sem `comTopo`, pula a regra que precisa baixar o histórico.
// A regra de topo fica desligada só com escala de preço quebrada (a série não é confiável); com salto
// de 2× sem escala quebrada, ela continua ativa e o alerta traz um aviso para conferir a cotação.
async function avaliarSaidas(cart, comTopo = true) {
  const cfg = configSaida(cart), c = calcularCarteira(cart.lancamentos), alertas = [];
  for (const p of c.abertas) {
    const u = estado.universo[p.papel] || {}, preco = p.preco;
    if (preco == null) continue;
    const add = (regra, t, d) => alertas.push({ papel: p.papel, regra, t, d, chave: `${p.papel}:${regra}` });
    const compras = cart.lancamentos.filter((l) => l.papel === p.papel && l.tipo === "compra");
    const ests = [...new Set(compras.flatMap((l) => l.estrategias || []))];
    if (cfg.estrategia && ests.length) {
      const ainda = ests.filter((k) => estado.resultado.estrategias[k]?.papeis.some((x) => x.papel === p.papel));
      if (!ainda.length) add("estrategia", "Saiu da estratégia em que você comprou",
        `Quando você comprou, ${p.papel} estava em ${ests.map((k) => estado.resultado.estrategias[k]?.nome || k).join(", ")}. Hoje não cumpre mais os critérios. Vale rever se o motivo da compra ainda vale.`);
    }
    if (cfg.alvo && u.alvo_medio && (u.analistas || 0) >= 3 && preco >= u.alvo_medio)
      add("alvo", "Chegou ao alvo dos analistas", `O preço (${reais(preco)}) alcançou o alvo médio de ${u.analistas} analistas (${reais(u.alvo_medio)}). O espaço de alta que eles enxergavam acabou.`);
    if (cfg.graham && u.graham && !u.financeira && preco >= u.graham)
      add("graham", "Passou do preço justo de Graham", `O preço (${reais(preco)}) está acima do preço justo pela fórmula de Graham (${reais(u.graham)}).`);
    if (cfg.quedaPM && p.pm && preco <= p.pm * (1 - cfg.quedaPM / 100))
      add("quedaPM", `Caiu mais de ${cfg.quedaPM}% do seu preço médio`, `Preço médio ${reais(p.pm)}, hoje ${reais(preco)} (${sinal(dif(preco, p.pm))}). É o limite de perda que você definiu.`);
    // Com poucas ações, todas passam do limite: a regra só vale quando há ações suficientes para isso fazer sentido.
    if (cfg.pesoMax && c.valor && (p.valor / c.valor) * 100 > cfg.pesoMax && c.comPreco.length > 100 / cfg.pesoMax)
      add("peso", `Pesa mais de ${cfg.pesoMax}% da carteira`, `${p.papel} é ${num((p.valor / c.valor) * 100, 0)}% do seu patrimônio. Concentração alta aumenta o risco se algo der errado com essa empresa.`);
    if (comTopo && cfg.quedaTopo && !u.escala_quebrada) {
      const primeira = compras.map((l) => l.data).sort()[0], t = await topoDesde(p.papel, primeira);
      if (t && preco <= t.topo * (1 - cfg.quedaTopo / 100)) {
        const quando = t.parcial
          ? `O maior preço nos dados do app (desde ${dataBR(t.desde)}, início do histórico disponível) foi ${reais(t.topo)}`
          : `O maior preço desde ${dataBR(primeira)} foi ${reais(t.topo)}`;
        const aviso = u.dados_suspeitos ? " Atenção: esta ação tem salto de preço sem evento registrado nos dados; confira a cotação na corretora antes de decidir." : "";
        add("quedaTopo", `Caiu mais de ${cfg.quedaTopo}% do topo desde a compra`, `${quando}; hoje está em ${reais(preco)} (${sinal(dif(preco, t.topo))}).${aviso}`);
      }
    }
  }
  return alertas;
}

// Notificação do navegador só para alertas que a pessoa ainda não viu
async function notificarNovos(alertas) {
  let vistos = [];
  try { vistos = JSON.parse(localStorage.getItem("radar-saidas-vistas") || "[]"); } catch {}
  const novos = alertas.filter((a) => !vistos.includes(a.chave));
  try { localStorage.setItem("radar-saidas-vistas", JSON.stringify(alertas.map((a) => a.chave))); } catch {}
  if (!novos.length || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker?.ready;
    const titulo = novos.length === 1 ? `${novos[0].papel}: ${novos[0].t}` : `${novos.length} alertas de saída na sua carteira`;
    reg?.showNotification(titulo, { body: novos.map((a) => `${a.papel}: ${a.t}`).join("\n"), icon: "icones/icone-192.png", data: { url: "./#carteira" } });
  } catch {}
}

async function montarSaidas(cart) {
  const caixa = $("#saidas");
  if (!caixa) return;
  const cfg = configSaida(cart);
  for (const k of ["estrategia", "alvo", "graham"]) $(`#s-${k}`).checked = cfg[k];
  $("#s-topo").value = cfg.quedaTopo; $("#s-pm").value = cfg.quedaPM; $("#s-peso").value = cfg.pesoMax;
  $("#form-saida").onchange = () => {
    cart.saida = {
      estrategia: $("#s-estrategia").checked, alvo: $("#s-alvo").checked, graham: $("#s-graham").checked,
      quedaTopo: Math.max(0, Number($("#s-topo").value) || 0), quedaPM: Math.max(0, Number($("#s-pm").value) || 0), pesoMax: Math.max(0, Number($("#s-peso").value) || 0),
    };
    salvarCarteira(cart);
    estado.saidasCache = null;
    montarSaidas(cart);
  };
  const alertas = await avaliarSaidas(cart);
  if (!document.body.contains(caixa)) return;
  estado.saidasCache = alertas.filter((a) => a.regra !== "quedaTopo").concat(alertas.filter((a) => a.regra === "quedaTopo"));
  notificarNovos(alertas);
  $("#lista-saidas").innerHTML = alertas.length ? alertas.map((a) => `<a class="alerta-saida" href="#acao/${esc(a.papel)}">${logo(a.papel)}
      <div><b>${esc(a.papel)} · ${esc(a.t)}</b><p>${esc(a.d)}</p></div><i class="ti ti-chevron-right"></i></a>`).join("")
    : `<div class="vazio">Nenhuma regra disparou. Suas posições estão dentro do que você definiu.</div>`;
  $$("[data-saida-marca]").forEach((el) => { el.hidden = !alertas.some((a) => a.papel === el.dataset.saidaMarca); });
}

function secaoSaidas() {
  return `<section class="painel" id="saidas">
    <div class="painel-cabeca"><h2>Regras de saída</h2><span class="extra">não mandam vender: avisam a hora de reavaliar</span></div>
    <div class="saidas-grade">
      <div id="lista-saidas"><div class="carregando"></div></div>
      <form class="form-saida" id="form-saida">
        <h3>Me avise quando uma ação da carteira…</h3>
        <label class="marcar"><input type="checkbox" id="s-estrategia">sair da estratégia em que eu comprei</label>
        <label class="marcar"><input type="checkbox" id="s-alvo">chegar ao alvo médio dos analistas</label>
        <label class="marcar"><input type="checkbox" id="s-graham">passar do preço justo de Graham</label>
        <label class="numero">cair mais de <input type="number" id="s-topo" min="0" max="90" step="1" aria-label="Percentual de queda desde o topo">% do topo desde a compra</label>
        <label class="numero">cair mais de <input type="number" id="s-pm" min="0" max="90" step="1" aria-label="Percentual abaixo do preço médio">% do meu preço médio</label>
        <label class="numero">passar de <input type="number" id="s-peso" min="0" max="100" step="1" aria-label="Peso máximo na carteira">% do meu patrimônio</label>
        <p class="faint">Use 0 para desligar uma regra numérica. Os alertas aparecem quando você abre o app; as notificações do navegador, se você permitiu.</p>
      </form>
    </div>
  </section>`;
}
