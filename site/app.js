// Radar B3: app estático que lê os JSON gerados pelo scan.py.
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
const tela = $("#conteudo");
const estado = { resultado: null, historico: [], universo: {}, estrategia: null, graficos: [], ordem: { campo: "papel", desc: false } };

const ROTULOS = {
  pl: "P/L", pvp: "P/VP", dy: "Dividend yield", roe: "ROE", roic: "ROIC", mrg_liq: "Margem líquida",
  div_liq_patrim: "Dív. líq./Patrimônio", ev_ebitda: "EV/EBITDA", cresc_rec_5a: "Crescimento da receita (5 anos)",
  liq_corr: "Liquidez corrente", queda_52s: "Abaixo da máx. 52s", var_dia: "Var. dia", var_30d: "Var. 30d", var_1a: "Var. 1 ano",
};
const PCT = new Set(["dy", "roe", "roic", "mrg_liq", "cresc_rec_5a", "queda_52s", "var_dia", "var_30d", "var_1a"]);
const NAO_SE_APLICA_FIN = new Set(["div_liq_patrim", "liq_corr", "roic", "ev_ebitda"]);
const PERIODOS = { "1M": 21, "3M": 63, "6M": 126, "1A": 9999 };
const SETORES = {
  "Energy": "Energia", "Financial Services": "Serviços financeiros", "Basic Materials": "Materiais básicos", "Utilities": "Utilidades públicas",
  "Industrials": "Indústria", "Consumer Cyclical": "Consumo cíclico", "Consumer Defensive": "Consumo não cíclico", "Healthcare": "Saúde",
  "Real Estate": "Imobiliário", "Technology": "Tecnologia", "Communication Services": "Comunicações",
};

// ---------- Formatação ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, c = 2) => (v == null || Number.isNaN(v) ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c }));
const reais = (v, c = 2) => (v == null ? "—" : `R$ ${num(v, c)}`);
const sinal = (v, c = 2) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v), c)}%`);
const cls = (v) => (v == null || v === 0 ? "" : v > 0 ? "pos" : "neg");
const varCel = (v, c = 2) => `<span class="${cls(v)}">${sinal(v, c)}</span>`;
const quando = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const precoDe = (p) => { const u = estado.universo[p] || {}; return u.preco ?? u.cotacao ?? null; };
const dif = (alvo, base) => (alvo == null || !base ? null : (alvo / base - 1) * 100);

function logo(papel, g = "") {
  return `<span class="logo ${g}" aria-hidden="true">${esc(papel.slice(0, 2))}<img src="https://icons.brapi.dev/icons/${esc(papel)}.svg" alt="" loading="lazy" onerror="this.remove()"></span>`;
}
function ativoCel(p) {
  const u = estado.universo[p] || {};
  return `<div class="ativo-cel">${logo(p)}<div><b>${esc(p)}</b><span class="nome">${esc(curto(u.nome) || (u.financeira ? "Banco ou seguradora" : ""))}</span></div></div>`;
}
const curto = (nome) => (nome || "").replace(/\s+(S\.?A\.?|S\/A)\.?$/i, "").replace(/ - .*$/, "");

async function carregarJSON(caminho) {
  const r = await fetch(caminho, { cache: "no-store" });
  if (!r.ok) throw new Error(`${caminho}: ${r.status}`);
  return r.json();
}

// ---------- Carga e rotas ----------
async function carregar() {
  try {
    [estado.resultado, estado.historico, estado.universo] = await Promise.all([
      carregarJSON("dados/resultado.json"), carregarJSON("dados/historico.json"), carregarJSON("dados/universo.json"),
    ]);
  } catch {
    tela.innerHTML = `<header class="titulo"><div><h1>Radar B3</h1><p class="linha2">Não foi possível carregar os dados. A próxima atualização acontece em até 15 minutos durante o pregão.</p></div></header>`;
    return;
  }
  for (const w of estado.resultado.watchlist) estado.universo[w.papel] ??= { preco: w.preco, var_dia: w.var_dia, var_30d: w.var_30d, queda_52s: w.queda_52s };
  estado.estrategia ??= Object.keys(estado.resultado.estrategias)[0];
  marcarIdade();
  rotear();
}

estado.rolagens = {};
estado.mexeuEm = 0;
// Se a pessoa rolar, a restauração automática da posição para de interferir.
for (const ev of ["wheel", "touchstart", "keydown"]) window.addEventListener(ev, () => { estado.mexeuEm = Date.now(); }, { passive: true });
function rotear() {
  if (!estado.resultado) return;
  const rota = location.hash || "#inicio";
  if (estado.rotaAtual) estado.rolagens[estado.rotaAtual] = window.scrollY;
  estado.rotaAtual = rota;
  const [aba, arg] = (location.hash.slice(1) || "inicio").split("/");
  const telas = { inicio: telaInicio, estrategias: telaEstrategias, acao: telaAcao, watchlist: telaWatchlist, carteira: telaCarteira, alertas: telaAlertas };
  const nome = telas[aba] ? aba : "inicio";
  $$("#menu a").forEach((a) => a.classList.toggle("ativa", a.dataset.aba === nome));
  estado.graficos.forEach((g) => g.remove());
  estado.graficos = [];
  estado.pararGlobo?.();
  estado.pararGlobo = null;
  telas[nome](arg && decodeURIComponent(arg));
  ligarLinhas();
  // Volta ao ponto onde estava nesta tela; partes que carregam depois (gráficos, mapa) mudam a altura, então reaplica.
  const destino = estado.rolagens[rota] || 0;
  window.scrollTo({ top: destino, behavior: "instant" });
  const inicio = Date.now();
  if (destino) for (const t of [150, 600, 1400]) setTimeout(() => { if (estado.rotaAtual === rota && estado.mexeuEm < inicio) window.scrollTo({ top: destino, behavior: "instant" }); }, t);
}

function ligarLinhas() {
  $$("tr[data-href]").forEach((tr) => {
    tr.tabIndex = 0;
    tr.onclick = () => { location.hash = tr.dataset.href; };
    tr.onkeydown = (e) => { if (e.key === "Enter") location.hash = tr.dataset.href; };
  });
}

function cabecalho(titulo, linha2, direita = "") {
  const r = estado.resultado;
  return `<header class="titulo">
    <div><h1>${titulo}</h1>${linha2 ? `<p class="linha2">${linha2}</p>` : ""}</div>
    <div class="direita">${direita}
      <button class="busca" type="button" data-busca><i class="ti ti-search"></i>Buscar ação ou empresa<kbd>Ctrl K</kbd></button>
      <span class="carimbo"><span class="ponto"></span>Atualizado ${quando(r.gerado_em)}</span>
      <a class="icone-redondo" href="#alertas" aria-label="Alertas"><i class="ti ti-bell"></i>${estado.historico.length ? '<span class="marcador"></span>' : ""}</a>
    </div></header>`;
}

// ---------- Gráficos ----------
function grafico(el) {
  const g = LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: "rgba(247,240,234,.55)", fontFamily: "Plus Jakarta Sans, system-ui", fontSize: 11 },
    grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,232,214,.06)" } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: .14, bottom: .06 } },
    timeScale: { borderVisible: false },
    crosshair: { mode: 0, vertLine: { color: "rgba(255,255,255,.28)", width: 1, style: 0, labelVisible: false }, horzLine: { visible: false, labelVisible: false } },
    handleScroll: false, handleScale: false,
    localization: { locale: "pt-BR", priceFormatter: (p) => num(p, p >= 1000 ? 0 : 2) },
  });
  estado.graficos.push(g);
  return g;
}
const area = (g) => g.addAreaSeries({ lineColor: "#ffa24a", lineWidth: 2, topColor: "rgba(255,122,31,.55)", bottomColor: "rgba(255,122,31,.02)", priceLineVisible: false,
  crosshairMarkerRadius: 6, crosshairMarkerBorderColor: "#ff7a1f", crosshairMarkerBorderWidth: 3, crosshairMarkerBackgroundColor: "#fff" });

// Cartão branco que acompanha o mouse no gráfico, como na ref. 1.
function dica(g, el, serieDe, formato) {
  const caixa = document.createElement("div");
  caixa.className = "dica";
  el.appendChild(caixa);
  g.subscribeCrosshairMove((p) => {
    const serie = serieDe();
    const d = p.point && p.time && serie ? p.seriesData.get(serie) : null;
    if (!d) { caixa.classList.remove("on"); return; }
    const v = d.value ?? d.close;
    const t = typeof p.time === "string" ? p.time : `${p.time.year}-${String(p.time.month).padStart(2, "0")}-${String(p.time.day).padStart(2, "0")}`;
    const data = new Date(t + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
    caixa.innerHTML = `${data}<b>${formato(v)}</b>`;
    caixa.style.left = `${Math.min(Math.max(p.point.x, 70), el.clientWidth - 70)}px`;
    caixa.style.top = `${serie.priceToCoordinate(v)}px`;
    caixa.classList.add("on");
  });
}
const abasPeriodo = (ativo) => `<div class="pilulas" role="tablist">${Object.keys(PERIODOS).map((p) => `<button type="button" data-periodo="${p}" class="${p === ativo ? "ativo" : ""}">${p}</button>`).join("")}</div>`;
function ligarAbas(raiz, attr, fn) {
  $$(`[data-${attr}]`, raiz).forEach((b) => b.onclick = () => {
    $$(`[data-${attr}]`, raiz).forEach((x) => x.classList.toggle("ativo", x === b));
    fn(b.dataset[attr]);
  });
}

function precoGrande(v, moeda = "R$", casas = 2) {
  if (v == null) return `<div class="preco-grande">—</div>`;
  const [int, dec] = num(v, casas).split(",");
  return `<div class="preco-grande">${moeda ? `<span class="moeda">${moeda}</span>` : ""}<span>${int}</span>${dec ? `<sup>,${dec}</sup>` : ""}</div>`;
}
const parede = (palavras) => `<div class="parede" aria-hidden="true">${esc(palavras.filter(Boolean).join(" "))}</div>`;

// Linha colorida pela tendência (verde subindo, vermelha caindo, contra 5 pregões antes), como na ref. "Discuss and Invest".
function linhaTendencia(g, pontos) {
  const s = g.addLineSeries({ lineWidth: 2, priceLineVisible: false, crosshairMarkerBackgroundColor: "#fff" });
  s.setData(pontos.map(([time, value], i) => ({ time, value, color: value >= pontos[Math.max(0, i - 5)][1] ? "#5fe0a4" : "#ff6b5e" })));
  return s;
}
function volume(g, velas) {
  if (!velas[0] || velas[0].length < 6) return null;
  const s = g.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
  g.priceScale("vol").applyOptions({ scaleMargins: { top: .82, bottom: 0 } });
  s.setData(velas.map((v) => ({ time: v[0], value: v[5], color: v[4] >= v[1] ? "rgba(255,193,92,.5)" : "rgba(255,74,43,.5)" })));
  return s;
}

// ---------- Visão geral ----------
const ICONES_EST = { valor_dividendos: "ti-coins", caiu_demais: "ti-trending-down", qualidade: "ti-diamond" };
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// A ação com mais sinais a favor; empates pela margem até o preço de Graham e depois pela liquidez.
function acaoDestaque() {
  const vistos = new Set(Object.values(estado.resultado.estrategias).flatMap((e) => e.papeis.map((p) => p.papel)));
  return [...vistos].map((p) => [p, estado.universo[p] || {}]).filter(([, u]) => u.pontos != null)
    .sort((a, b) => b[1].pontos - a[1].pontos || (dif(b[1].graham, precoDe(b[0])) ?? -1e9) - (dif(a[1].graham, precoDe(a[0])) ?? -1e9) || (b[1].liq_2meses || 0) - (a[1].liq_2meses || 0))[0]?.[0];
}

function barrasMeses(serie) {
  if (!serie?.length) return '<div class="vazio">Sem a série do Ibovespa nesta atualização.</div>';
  const fim = {};
  for (const [d, v] of serie) fim[d.slice(0, 7)] = v;
  const meses = Object.keys(fim).sort();
  const varr = meses.slice(1).map((m, i) => [m, (fim[m] / fim[meses[i]] - 1) * 100]).slice(-6);
  const max = Math.max(...varr.map(([, v]) => Math.abs(v)), 1);
  return `<div class="barras">${varr.map(([m, v], i) => {
    const h = Math.max(4, (Math.abs(v) / max) * 34);
    const atual = i === varr.length - 1;
    const rot = v >= 0 ? `bottom:calc(50% + ${h}% + 6px)` : `top:calc(50% + ${h}% + 6px)`;
    return `<div class="barra ${atual ? "atual" : ""}" title="${MESES[+m.slice(5) - 1]}/${m.slice(0, 4)}: ${sinal(v, 1)}${atual ? " até agora" : ""}">
      <div class="area"><div class="meio"></div><div class="col ${v >= 0 ? "sobe" : "desce"}" style="height:${h}%"></div><span class="rot-valor" style="${rot}">${sinal(v, 1)}</span></div>
      <span class="mes">${MESES[+m.slice(5) - 1]}</span></div>`;
  }).join("")}</div>`;
}

function montarPilha(frente = 0) {
  const w = estado.resultado.watchlist.slice(0, 5);
  const el = $("#pilha");
  if (!el) return;
  if (!w.length) { el.innerHTML = '<div class="vazio">Sua watchlist está vazia.</div>'; el.style.height = "auto"; return; }
  const ordem = [...w.keys()].filter((i) => i !== frente).concat(frente);
  const passo = 40, alturaFrente = 170;
  el.style.height = `${(ordem.length - 1) * passo + alturaFrente}px`;
  el.innerHTML = ordem.map((i, k) => {
    const p = w[i], u = estado.universo[p.papel] || {}, ehFrente = k === ordem.length - 1;
    const escala = 1 - (ordem.length - 1 - k) * 0.05;
    return `<div class="cartao-acao ${ehFrente ? "frente" : ""}" data-i="${i}" role="button" tabindex="0" aria-label="${esc(p.papel)}"
        style="top:${k * passo}px;transform:scale(${escala});z-index:${k + 1};${ehFrente ? `height:${alturaFrente}px` : ""}">
      <div class="linha-cartao">${logo(p.papel)}<div><b>${esc(p.papel)}</b><div class="faint" style="font-size:12px">${esc(curto(u.nome) || "")}</div></div>
        ${ehFrente ? "" : `<span class="preco-cartao">${reais(p.preco)}</span>`}</div>
      ${ehFrente ? `<div class="corpo"><div><div class="rotulo-cartao">Preço agora</div><div class="grande">${reais(p.preco)}</div></div>
        <span class="pilula ${cls(p.var_dia)}">${sinal(p.var_dia)}</span></div>` : ""}
    </div>`;
  }).join("");
  $$(".cartao-acao", el).forEach((c) => {
    const ir = () => (c.classList.contains("frente") ? (location.hash = `#acao/${w[+c.dataset.i].papel}`) : montarPilha(+c.dataset.i));
    c.onclick = ir;
    c.onkeydown = (e) => { if (e.key === "Enter") ir(); };
  });
  const papel = w[frente].papel;
  $("#pilha-botoes").innerHTML = `<a class="botao-vidro" href="#acao/${esc(papel)}"><i class="ti ti-chart-line"></i>Ver análise</a>
    <a class="botao-fogo" href="#acao/${esc(papel)}" data-comprar><i class="ti ti-shopping-cart"></i>Como comprar</a>`;
}

// O gráfico do topo mostra o Ibovespa (o termômetro da bolsa inteira) por padrão,
// mas dá para trocar pelo dólar ou por qualquer ação da watchlist.
function montarTopo(ib, us) {
  const el = $("#g-ibov");
  el.innerHTML = "";
  const g = grafico(el), s = area(g);
  let atual = null, periodo = "6M";
  const fontes = {
    ibov: async () => ib?.serie && { rotulo: "Ibovespa, o índice das maiores ações da B3", valor: num(ib.valor, 0), unidade: "pontos", hoje: ib.var_dia, serie: ib.serie, fmt: (v) => `${num(v, 0)} pontos` },
    dolar: async () => us?.serie && { rotulo: "Dólar em reais (PTAX do Banco Central)", valor: reais(us.valor, 3), unidade: "", hoje: us.var_dia, serie: us.serie, fmt: (v) => reais(v, 3) },
  };
  const daAcao = async (p) => {
    const velas = await carregarJSON(`dados/precos/${p}.json`).catch(() => null);
    const u = estado.universo[p] || {};
    return velas && { rotulo: `${p} · ${curto(u.nome) || "ação da watchlist"}`, valor: reais(precoDe(p)), unidade: "", hoje: u.var_dia, serie: velas.map((v) => [v[0], v[4]]), fmt: (v) => reais(v), papel: p };
  };
  const pintar = () => {
    if (!atual) return;
    const d = atual.serie.slice(-PERIODOS[periodo]);
    s.setData(d.map(([time, value]) => ({ time, value })));
    s.setMarkers(eventoMaior(d));
    g.timeScale().fitContent();
    const v = dif(d.at(-1)[1], d[0][1]);
    $("#ibov-per").innerHTML = `<span class="${cls(v)}">${sinal(v, 1)}</span> em ${periodo === "1A" ? "12 meses" : periodo === "1M" ? "1 mês" : periodo.replace("M", " meses")}`
      + (atual.papel ? ` · <a href="#acao/${esc(atual.papel)}" style="color:var(--laranja-2);font-weight:600">ver análise</a>` : "");
  };
  const escolher = async (chave) => {
    const dado = await (fontes[chave] ? fontes[chave]() : daAcao(chave));
    if (!dado) { $("#topo-rotulo").textContent = "Sem dados para este gráfico nesta atualização."; return; }
    atual = dado;
    $("#topo-rotulo").textContent = dado.rotulo;
    $("#topo-valor").textContent = dado.valor;
    $("#topo-unidade").textContent = dado.unidade;
    $("#topo-hoje").innerHTML = dado.hoje == null ? "" : `<span class="pilula ${cls(dado.hoje)}">${sinal(dado.hoje)} hoje</span>`;
    pintar();
  };
  dica(g, el, () => s, (v) => atual?.fmt(v) ?? num(v));
  ligarAbas($("#p-ibov"), "periodo", (p) => { periodo = p; pintar(); });
  ligarAbas($("#p-ibov"), "serie", escolher);
  escolher("ibov");
}

// "Perto de entrar": ações a 1 critério de alguma estratégia (regra da Rede v4), as mais líquidas primeiro.
function pertoDeEntrar() {
  const perto = (typeof resumoRede === "function" ? resumoRede() : []).filter((l) => l.faltam === 1)
    .sort((a, b) => (b.u.liq_2meses || 0) - (a.u.liq_2meses || 0)).slice(0, 5);
  const falta = (l) => {
    const i = l.r.itens.find((x) => x.falha || x.semDado);
    if (!i) return "";
    const p = PCT.has(i.c.campo) ? "%" : "", lim = i.c.min != null && i.v < i.c.min ? `mínimo ${num(i.c.min, 1)}${p}` : `máximo ${num(i.c.max, 1)}${p}`;
    return i.semDado ? `${ROTULOS[i.c.campo] || i.c.campo} sem dado` : `${ROTULOS[i.c.campo] || i.c.campo} ${num(i.v, 1)}${p} · ${lim}`;
  };
  return `<section class="painel destaque"><div class="orbe"></div>
    <div class="faint">Perto de entrar nas suas estratégias</div>
    <h2>Falta 1 critério para ${perto.length ? (resumoRede().filter((l) => l.faltam === 1).length) : 0} ações</h2>
    <div class="razoes">${perto.map((l) => `<a href="#acao/${esc(l.papel)}" style="display:flex;gap:10px;align-items:center">${logo(l.papel)}<div style="min-width:0"><b>${esc(l.papel)}</b> · ${esc(estado.resultado.estrategias[l.k].nome)}<div style="opacity:.85">${esc(falta(l))}</div></div></a>`).join("") || "<span>Nenhuma ação está a 1 critério agora.</span>"}</div>
    <a class="botao-branco" href="#inicio" data-rolar="rede">Ver na Rede do Radar</a>
  </section>`;
}

// Linha compacta de ação para as colunas de "O que olhar hoje".
function linhaOlhar(p, extra) {
  const u = estado.universo[p] || {};
  return `<a class="linha-olhar" href="#acao/${esc(p)}">${logo(p)}
    <span class="meio"><b>${esc(p)}</b><span>${extra ?? esc(curto(u.nome) || "")}</span></span>
    <span class="fim"><b>${reais(precoDe(p))}</b><span class="pilula ${cls(u.var_dia)}">${sinal(u.var_dia)}</span></span></a>`;
}

// O que pede atenção: alertas de preço que dispararam, entradas e saídas das estratégias
// e ações da watchlist que se mexeram muito hoje.
function pedeAtencao() {
  const itens = [];
  for (const a of estado.saidasCache || []) itens.push({ p: a.papel, t: a.t, d: "Regra de saída da sua carteira", tipo: "neg" });
  for (const w of estado.resultado.watchlist) {
    if (w.preco == null) continue;
    if (w.abaixo_de && w.preco <= w.abaixo_de) itens.push({ p: w.papel, t: `Abaixo de ${reais(w.abaixo_de)}`, d: "Seu alerta de preço disparou", tipo: "neg" });
    if (w.acima_de && w.preco >= w.acima_de) itens.push({ p: w.papel, t: `Acima de ${reais(w.acima_de)}`, d: "Seu alerta de preço disparou", tipo: "pos" });
    if (Math.abs(w.var_dia ?? 0) >= 3) itens.push({ p: w.papel, t: `${sinal(w.var_dia)} hoje`, d: "Movimento forte numa ação da sua watchlist", tipo: cls(w.var_dia) });
  }
  for (const e of eventos(estado.historico.slice(0, 1)).filter((e) => e.tipo !== "info")) itens.push({ p: e.p, t: e.t, d: e.d, tipo: e.tipo });
  return itens.slice(0, 4);
}

const RECOMENDACAO = { strong_buy: "compra forte", buy: "compra", hold: "neutro", underperform: "abaixo da média", sell: "venda", strong_sell: "venda forte" };
// "Espaço para subir segundo estudos": o que analistas e fórmulas clássicas calculam, deixando claro que não é previsão.
function secaoPotencial() {
  const lista = Object.entries(estado.universo).map(([p, u]) => ({ p, u, preco: precoDe(p) })).filter((x) => x.preco);
  const analistas = lista.filter((x) => (x.u.analistas || 0) >= 5 && x.u.alvo_medio).map((x) => ({ ...x, alta: dif(x.u.alvo_medio, x.preco) }))
    .sort((a, b) => b.alta - a.alta).slice(0, 6);
  const graham = lista.filter((x) => x.u.graham && !x.u.financeira).map((x) => ({ ...x, alta: dif(x.u.graham, x.preco) }))
    .filter((x) => x.alta > 0 && x.alta < 200).sort((a, b) => b.alta - a.alta).slice(0, 6);
  const linha = (x, txt) => linhaOlhar(x.p, txt).replace(`<span class="pilula ${cls(x.u.var_dia)}">${sinal(x.u.var_dia)}</span>`, `<span class="pilula pos">${sinal(x.alta, 0)}</span>`);
  return `<section class="painel potencial" id="potencial">
    <div class="painel-cabeca"><h2>Espaço para subir, segundo estudos</h2>
      <div class="pilulas" style="margin-left:auto"><button type="button" data-pot="analistas" class="ativo">Alvo dos analistas</button><button type="button" data-pot="graham">Preço justo (Graham)</button></div></div>
    <p class="aviso-estudo"><i class="ti ti-info-circle"></i>Ninguém consegue prever o preço de uma ação. Esta lista mostra quanto o preço de hoje está abaixo do que estudos calculam: o <b>alvo médio de pelo menos 5 analistas</b> de bancos e corretoras para os próximos 12 meses, ou o <b>preço justo pela fórmula de Graham</b>. Esses estudos erram e mudam com frequência. Use como ponto de partida para pesquisar, não como garantia.</p>
    <div class="potencial-grade" data-painel-pot="analistas">${analistas.map((x) => linha(x, `alvo ${reais(x.u.alvo_medio)} · ${x.u.analistas} analistas${RECOMENDACAO[x.u.recomendacao] ? ` · consenso: ${RECOMENDACAO[x.u.recomendacao]}` : ""}`)).join("") || '<div class="vazio">Sem alvos de analistas nesta atualização.</div>'}</div>
    <div class="potencial-grade" data-painel-pot="graham" hidden>${graham.map((x) => linha(x, `preço justo ${reais(x.u.graham)} · P/L ${num(x.u.pl, 1)} · P/VP ${num(x.u.pvp, 1)}`)).join("") || '<div class="vazio">Nenhuma ação abaixo do preço justo de Graham.</div>'}</div>
  </section>`;
}

function telaInicio() {
  const r = estado.resultado, ib = r.mercado?.ibovespa, us = r.mercado?.dolar;
  const ests = Object.entries(r.estrategias);
  const movers = Object.entries(estado.universo).filter(([, u]) => u.var_dia != null);
  const quedas = [...movers].sort((a, b) => a[1].var_dia - b[1].var_dia), altas = [...quedas].reverse();
  const caiu = movers.filter(([, u]) => u.var_dia < 0).length, subiu = movers.filter(([, u]) => u.var_dia > 0).length;
  const perto = (typeof resumoRede === "function" ? resumoRede() : []).filter((l) => l.faltam === 1)
    .sort((a, b) => (b.u.liq_2meses || 0) - (a.u.liq_2meses || 0));
  const faltaTxt = (l) => {
    const i = l.r.itens.find((x) => x.falha || x.semDado);
    if (!i) return "";
    const p = PCT.has(i.c.campo) ? "%" : "";
    return i.semDado ? `${ROTULOS[i.c.campo] || i.c.campo}: sem dado` : `${ROTULOS[i.c.campo] || i.c.campo} ${num(i.v, 1)}${p}, limite ${num(i.c.min != null && i.v < i.c.min ? i.c.min : i.c.max, 1)}${p}`;
  };
  const atencao = pedeAtencao();
  tela.innerHTML = `
    ${cabecalho("Visão geral", `${ib ? `Ibovespa <b class="${cls(ib.var_dia)}">${sinal(ib.var_dia)}</b> hoje, em ${num(ib.valor, 0)} pontos.` : ""}
      Das ${movers.length} ações acompanhadas, <b class="neg">${caiu} caíram</b> e <b class="pos">${subiu} subiram</b>.
      ${quedas[0] ? `A maior queda foi <a href="#acao/${esc(quedas[0][0])}"><b>${esc(quedas[0][0])}</b></a> (${sinal(quedas[0][1].var_dia)}).` : ""}`)}
    <div class="heroi">
      <section class="painel h-ibov coluna-flex" id="p-ibov">
        <div class="seletor-topo" role="tablist" aria-label="O que mostrar no gráfico">
          <button type="button" data-serie="ibov" class="ativo">Ibovespa</button><button type="button" data-serie="dolar">Dólar</button>
          ${r.watchlist.map((w) => `<button type="button" data-serie="${esc(w.papel)}">${esc(w.papel)}</button>`).join("")}
        </div>
        <div class="topo">
          <div><div class="muted" id="topo-rotulo"></div>
            <div class="valor"><span class="figura" style="font-size:36px;line-height:42px" id="topo-valor">—</span><span class="faint" id="topo-unidade"></span><span id="topo-hoje"></span></div>
            <div class="faint" id="ibov-per" style="margin-top:2px"></div></div>
          ${abasPeriodo("6M")}
        </div>
        <div class="grafico" id="g-ibov">${ib?.serie ? "" : '<div class="vazio" style="margin:20px 6px">O Yahoo Finance não respondeu nesta atualização. O gráfico volta na próxima, em até 15 minutos.</div>'}</div>
      </section>

      <section class="painel olhar" id="olhar">
        <div class="painel-cabeca"><h2>O que olhar hoje</h2><a class="ver-todos" href="#acao" data-lista="var_dia">Ver as ${movers.length} ações<i class="ti ti-chevron-right"></i></a></div>
        <div class="olhar-grade">
          <div><h3 class="olhar-titulo neg"><i class="ti ti-trending-down"></i>Caíram mais</h3>${quedas.slice(0, 4).map(([p, u]) => linhaOlhar(p, `${sinal(u.var_30d, 1)} em 30 dias`)).join("")}</div>
          <div><h3 class="olhar-titulo pos"><i class="ti ti-trending-up"></i>Subiram mais</h3>${altas.slice(0, 4).map(([p, u]) => linhaOlhar(p, `${sinal(u.var_30d, 1)} em 30 dias`)).join("")}</div>
          <div><h3 class="olhar-titulo"><i class="ti ti-target-arrow"></i>Perto de entrar</h3>${perto.slice(0, 4).map((l) => linhaOlhar(l.papel, esc(faltaTxt(l)))).join("") || '<div class="vazio">Nenhuma ação a 1 critério agora.</div>'}</div>
        </div>
      </section>

      <div class="h-direita">
        <section class="painel">
          <div class="painel-cabeca"><h2>Sua watchlist</h2><a class="ver-todos" href="#watchlist">Ver todas<i class="ti ti-chevron-right"></i></a></div>
          <div class="pilha-cartoes" id="pilha"></div>
          <div class="dois-botoes" id="pilha-botoes"></div>
        </section>
        <section class="painel" style="flex:1">
          <div class="painel-cabeca"><h2>Pede sua atenção</h2><a class="ver-todos" href="#alertas">Alertas<i class="ti ti-chevron-right"></i></a></div>
          ${atencao.map((a) => `<a class="mudanca" href="#acao/${esc(a.p)}">${logo(a.p)}<div style="min-width:0"><b>${esc(a.p)} · ${esc(a.t)}</b><p>${esc(a.d)}</p></div><span class="quando"><span class="${a.tipo}" style="font-weight:800;font-size:16px">${a.tipo === "neg" ? "↓" : a.tipo === "pos" ? "↑" : "•"}</span></span></a>`).join("")
            || '<div class="vazio">Nada pedindo atenção agora: nenhum alerta disparou e nada entrou ou saiu das estratégias.</div>'}
        </section>
      </div>
    </div>

    <div id="slot-mapa" style="display:contents"></div>

    ${secaoPotencial()}

    <section>
      <div class="painel-cabeca" style="margin:8px 4px 14px"><h2>Suas estratégias</h2><a class="ver-todos" href="#estrategias">Abrir estratégias<i class="ti ti-chevron-right"></i></a></div>
      <div class="cartoes-est">${ests.map(([k, e]) => `
        <a class="painel cartao-est" href="#estrategias/${k}">
          <div class="topo-est"><span class="icone-est"><i class="ti ${ICONES_EST[k] || "ti-filter"}"></i></span><span class="conta-grande">${e.papeis.length}</span></div>
          <h3>${esc(e.nome)}</h3><p>${esc(e.descricao)}</p>
          <div class="logos">${e.papeis.slice(0, 7).map((p) => logo(p.papel)).join("")}${e.papeis.length > 7 ? `<span class="faint" style="margin-left:10px;align-self:center">+${e.papeis.length - 7}</span>` : ""}</div>
        </a>`).join("")}</div>
    </section>

    <div id="slot-rede" style="display:contents"></div>
    ${avisoPush()}
    ${rodape()}`;

  montarPilha(0);
  // Regras de saída da carteira (as que não precisam baixar histórico) entram no "Pede sua atenção"
  if (!estado.saidasCache && typeof avaliarSaidas === "function" && lerCarteira().lancamentos.length) {
    avaliarSaidas(lerCarteira(), false).then((al) => {
      estado.saidasCache = al;
      if (al.length && estado.rotaAtual === "#inicio") { const y = window.scrollY; telaInicio(); window.scrollTo({ top: y, behavior: "instant" }); }
    });
  }
  ligarAbas($("#potencial"), "pot", (k) => $$("[data-painel-pot]").forEach((el) => { el.hidden = el.dataset.painelPot !== k; }));
  montarMapa($("#slot-mapa"));
  montarGlobo($("#slot-rede"));
  if (window.LightweightCharts) montarTopo(ib, us);
}

// Anota o maior movimento do período quando ele é bem maior que o normal (regra da skill: explicar o salto).
function eventoMaior(d) {
  const mov = d.slice(1).map((v, i) => [v[0], (v[1] / d[i][1] - 1) * 100]);
  if (mov.length < 10) return [];
  const tipico = mov.reduce((s, m) => s + Math.abs(m[1]), 0) / mov.length;
  const [data, v] = mov.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
  if (Math.abs(v) < tipico * 3) return [];
  const [, mes, dia] = data.split("-");
  return [{ time: data, position: v < 0 ? "aboveBar" : "belowBar", color: v < 0 ? "#e5566f" : "#44a282", shape: v < 0 ? "arrowDown" : "arrowUp", text: `${sinal(v, 1)}` }];
}

// ---------- Estratégias ----------
function textoCriterio(c) {
  const r = ROTULOS[c.campo] || c.campo, f = (v) => num(v, v % 1 ? 1 : 0) + (PCT.has(c.campo) ? "%" : "");
  if (c.min != null && c.max != null) return `${r} entre ${f(c.min)} e ${f(c.max)}`;
  return c.min != null ? `${r} de ${f(c.min)} ou mais` : `${r} até ${f(c.max)}`;
}

const COLUNAS = [
  ["papel", "Ação", ""], ["preco", "Preço", "n"], ["var_dia", "Hoje", "n"], ["pl", "P/L", "n esconde-celular"], ["dy", "DY", "n esconde-celular"],
  ["roe", "ROE", "n esconde-celular"], ["queda_52s", "Abaixo da máx.", "n esconde-celular"], ["graham_dif", "vs. Graham", "n esconde-celular"], ["leitura", "Leitura", "n"],
];

function telaEstrategias(arg) {
  const ests = estado.resultado.estrategias;
  if (arg && ests[arg]) estado.estrategia = arg;
  tela.innerHTML = `${cabecalho("Estratégias", "", "")}
    <div class="abas grandes" id="abas-est">${Object.entries(ests).map(([k, v]) => `<button type="button" data-est="${k}" class="${k === estado.estrategia ? "ativo" : ""}">${esc(v.nome)}<span class="conta">${v.papeis.length}</span></button>`).join("")}</div>
    <section class="painel" id="p-est"></section>
    ${rodape()}`;
  ligarAbas(tela, "est", (k) => { estado.estrategia = k; history.replaceState(null, "", `#estrategias/${k}`); desenharEstrategia(); });
  desenharEstrategia();
}

// Ações a 1 critério desta estratégia, com o critério que falta (a parte útil da antiga Rede do Radar).
function quaseEntram(k) {
  if (typeof resumoRede !== "function") return "";
  const linhas = resumoRede().filter((l) => l.porEst[k] && l.porEst[k].faltam === 1)
    .sort((a, b) => (b.u.liq_2meses || 0) - (a.u.liq_2meses || 0)).slice(0, 12);
  if (!linhas.length) return "";
  const falta = (l) => {
    const i = l.porEst[k].itens.find((x) => x.falha || x.semDado);
    const p = PCT.has(i.c.campo) ? "%" : "";
    return i.semDado ? `${ROTULOS[i.c.campo] || i.c.campo} sem dado` : `${ROTULOS[i.c.campo] || i.c.campo} está em ${num(i.v, 1)}${p}; o critério pede ${textoCriterio(i.c).replace((ROTULOS[i.c.campo] || i.c.campo) + " ", "")}`;
  };
  return `<div class="quase"><h3><i class="ti ti-target-arrow"></i>Quase entram: falta só 1 critério</h3>
    <p class="faint">Boas candidatas para acompanhar: se o critério abaixo mudar (preço, dividendo ou balanço), elas passam a fazer parte desta estratégia.</p>
    <div class="quase-grade">${linhas.map((l) => linhaOlhar(l.papel, esc(falta(l)))).join("")}</div></div>`;
}

function desenharEstrategia() {
  const e = estado.resultado.estrategias[estado.estrategia], o = estado.ordem;
  const linhas = e.papeis.map((p) => {
    const u = estado.universo[p.papel] || {};
    return { ...p, graham_dif: dif(u.graham, p.preco), leitura: (u.a_favor?.length || 0) - (u.atencao?.length || 0), u };
  }).sort((a, b) => {
    const x = a[o.campo], y = b[o.campo];
    const r = typeof x === "string" ? x.localeCompare(y) : (x ?? -1e9) - (y ?? -1e9);
    return o.desc ? -r : r;
  });
  $("#p-est").innerHTML = `
    <div class="painel-cabeca"><h2>${esc(e.descricao)}</h2></div>
    <p class="muted" style="font-size:13px;line-height:20px;margin:-6px 0 6px">Critérios: ${esc(e.criterios.map(textoCriterio).join(" · "))}.</p>
    <p class="faint" style="margin-bottom:16px">Bancos e seguradoras: ${e.criterios_financeiras ? esc(e.criterios_financeiras.map(textoCriterio).join(" · ")) : "ficam de fora desta estratégia"}. Para mudar, edite o config.yaml.</p>
    ${linhas.length ? `<div class="rolagem"><table><thead><tr>${COLUNAS.map(([c, r, k]) => `<th class="ord ${k} ${o.campo === c ? "on" : ""}" data-ord="${c}">${r}${o.campo === c ? (o.desc ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead>
      <tbody>${linhas.map((l) => `<tr data-href="#acao/${esc(l.papel)}">
        <td>${ativoCel(l.papel)}</td><td class="n">${num(l.preco)}</td><td class="n">${varCel(l.var_dia)}</td>
        <td class="n esconde-celular">${num(l.pl, 1)}</td><td class="n esconde-celular">${l.dy == null ? "—" : num(l.dy, 1) + "%"}</td>
        <td class="n esconde-celular">${l.roe == null ? "—" : num(l.roe, 1) + "%"}</td><td class="n esconde-celular">${l.queda_52s == null ? "—" : num(l.queda_52s, 0) + "%"}</td>
        <td class="n esconde-celular">${varCel(l.graham_dif, 0)}</td>
        <td class="n"><span class="pos">${l.u.a_favor?.length ?? 0}</span> a favor · <span class="${l.u.atencao?.length ? "neg" : ""}">${l.u.atencao?.length ?? 0}</span> atenção</td>
      </tr>`).join("")}</tbody></table></div>` : '<div class="vazio">Nenhuma ação cumpre todos os critérios agora.</div>'}
    ${quaseEntram(estado.estrategia)}`;
  $$("[data-ord]").forEach((th) => th.onclick = () => {
    const c = th.dataset.ord;
    estado.ordem = { campo: c, desc: o.campo === c ? !o.desc : c !== "papel" };
    desenharEstrategia();
  });
  ligarLinhas();
}

// ---------- Ação ----------
const COLUNAS_LISTA = [
  ["papel", "Ação", ""], ["setor", "Setor", "esconde-celular"], ["preco", "Preço", "n"], ["var_dia", "Hoje", "n"], ["var_30d", "30 dias", "n esconde-celular"],
  ["pl", "P/L", "n esconde-celular"], ["dy", "DY", "n esconde-celular"], ["roe", "ROE", "n esconde-celular"], ["pontos", "Pontos", "n"],
];
function telaLista() {
  const todos = Object.entries(estado.universo).filter(([, u]) => u.cotacao != null || u.preco != null);
  const setores = [...new Set(todos.map(([, u]) => SETORES[u.setor] || u.setor).filter(Boolean))].sort();
  estado.lista ??= { q: "", setor: "", campo: "pontos", desc: true };
  tela.innerHTML = `${cabecalho("Ações", `As ${todos.length} ações da B3 com pelo menos R$ 2 milhões negociados por dia. Toque numa para ver a régua de preço, a leitura e como comprar.`)}
    <section class="painel">
      <div class="filtros-lista">
        <label class="campo-busca"><i class="ti ti-search"></i><input id="lista-q" placeholder="Filtrar por código ou nome" value="${esc(estado.lista.q)}" aria-label="Filtrar por código ou nome"></label>
        <div class="pilulas" id="lista-setores"><button type="button" data-setor="" class="${estado.lista.setor ? "" : "ativo"}">Todos</button>${setores.map((x) => `<button type="button" data-setor="${esc(x)}" class="${estado.lista.setor === x ? "ativo" : ""}">${esc(x)}</button>`).join("")}</div>
      </div>
      <p class="faint" id="lista-conta" style="margin:12px 4px 0"></p>
      <div class="rolagem"><table><thead><tr id="lista-cab"></tr></thead><tbody id="lista-corpo"></tbody></table></div>
    </section>${rodape()}`;
  const desenhar = () => {
    const o = estado.lista, q = o.q.trim().toUpperCase();
    const linhas = todos.filter(([p, u]) => (!q || p.includes(q) || (u.nome || "").toUpperCase().includes(q)) && (!o.setor || (SETORES[u.setor] || u.setor) === o.setor))
      .map(([p, u]) => ({ ...u, papel: p, setor: SETORES[u.setor] || u.setor || "", preco: precoDe(p) }))
      .sort((a, b) => { const x = a[o.campo], y = b[o.campo]; const r = typeof x === "string" || typeof y === "string" ? String(x ?? "").localeCompare(String(y ?? "")) : (x ?? -1e9) - (y ?? -1e9); return o.desc ? -r : r; });
    $("#lista-conta").textContent = `${linhas.length} ${linhas.length === 1 ? "ação" : "ações"}`;
    $("#lista-cab").innerHTML = COLUNAS_LISTA.map(([c, r, k]) => `<th class="ord ${k} ${o.campo === c ? "on" : ""}" data-ord="${c}">${r}${o.campo === c ? (o.desc ? " ↓" : " ↑") : ""}</th>`).join("");
    $("#lista-corpo").innerHTML = linhas.map((l) => `<tr data-href="#acao/${esc(l.papel)}"><td>${ativoCel(l.papel)}</td><td class="esconde-celular faint">${esc(l.setor)}</td>
      <td class="n">${num(l.preco)}</td><td class="n">${varCel(l.var_dia)}</td><td class="n esconde-celular">${varCel(l.var_30d, 1)}</td>
      <td class="n esconde-celular">${num(l.pl, 1)}</td><td class="n esconde-celular">${l.dy == null ? "—" : num(l.dy, 1) + "%"}</td><td class="n esconde-celular">${l.roe == null ? "—" : num(l.roe, 1) + "%"}</td>
      <td class="n">${l.pontos == null ? "—" : `<span class="pilula ${l.pontos >= 70 ? "pos" : l.pontos < 40 ? "neg" : "neutra"}">${l.pontos}</span>`}</td></tr>`).join("")
      || `<tr><td colspan="9" class="faint">Nenhuma ação com esse filtro.</td></tr>`;
    $$("[data-ord]").forEach((th) => th.onclick = () => { const c = th.dataset.ord; o.desc = o.campo === c ? !o.desc : !["papel", "setor"].includes(c); o.campo = c; desenhar(); });
    ligarLinhas();
  };
  $("#lista-q").oninput = (e) => { estado.lista.q = e.target.value; desenhar(); };
  ligarAbas(tela, "setor", (x) => { estado.lista.setor = x; desenhar(); });
  desenhar();
}

// Proventos do último ano (ideia do Status Invest): datas ex, valor por ação e quanto renderia hoje.
function painelProventos(papel, u, preco) {
  const prov = u.proventos || [];
  if (!prov.length) return `<section class="painel"><div class="painel-cabeca"><h2>Proventos</h2></div><div class="vazio">${esc(papel)} não pagou dividendos nem JCP no último ano, segundo o Yahoo Finance.</div></section>`;
  const total = prov.reduce((s, [, v]) => s + v, 0);
  return `<section class="painel">
    <div class="painel-cabeca"><h2>Proventos do último ano</h2><span class="extra">dividendos e JCP por ação, valores brutos (Yahoo Finance)</span></div>
    <div class="proventos-topo">
      <div><span>Total em 12 meses</span><b>${reais(total, 4)}</b></div>
      <div><span>Rende sobre o preço de hoje</span><b class="pos">${preco ? num((total / preco) * 100, 1) + "%" : "—"}</b></div>
      <div><span>Com 100 ações você receberia</span><b>${reais(total * 100)}</b></div>
    </div>
    <div class="rolagem"><table class="kv"><thead><tr><th>Data ex (precisa ter a ação no dia anterior)</th><th class="n">Valor por ação</th></tr></thead><tbody>
      ${[...prov].reverse().map(([d, v]) => `<tr><td>${dataBR(d)}</td><td class="n">${reais(v, 4)}</td></tr>`).join("")}
    </tbody></table></div>
  </section>`;
}

async function telaAcao(arg) {
  if (!arg) return telaLista();
  const papel = arg.toUpperCase();
  const u = estado.universo[papel];
  if (!u) {
    tela.innerHTML = `${cabecalho(esc(papel), "Este código não está entre as ações com negociação suficiente (mais de R$ 2 milhões por dia) ou não existe.")}`;
    return;
  }
  const preco = precoDe(papel);
  const em = Object.entries(estado.resultado.estrategias).filter(([, e]) => e.papeis.some((p) => p.papel === papel));
  const temAnalistas = (u.analistas || 0) >= 3 && u.alvo_medio;
  const achado = [];
  // "X% abaixo" se mede contra a referência: 52,79 contra 93,31 está 43% abaixo (não 77%).
  const contra = (ref) => `${num(Math.abs(dif(preco, ref)), 0)}% ${preco < ref ? "abaixo" : "acima"}`;
  if (u.graham) achado.push(`${contra(u.graham)} do preço justo de Graham`);
  if (temAnalistas) achado.push(`${contra(u.alvo_medio)} do alvo médio de ${u.analistas} analistas`);
  tela.innerHTML = `
    ${cabecalho(`<span style="display:inline-flex;align-items:center;gap:14px">${logo(papel, "g")}${esc(papel)}</span>`,
      `${esc(curto(u.nome) || "")}${u.setor ? ` · ${esc(SETORES[u.setor] || u.setor)}` : ""}${u.financeira ? " · banco ou seguradora" : ""}`)}
    <section class="painel s8 fogo coluna-flex" id="p-graf">
      ${parede([papel, ...(curto(u.nome) || "").split(/\s+/).slice(0, 3), SETORES[u.setor] || "", papel])}
      <div class="fogo-topo">
        <div>${precoGrande(preco)}
          <div class="delta" style="margin-top:8px">${varCel(u.var_dia)} <span class="faint">hoje</span> · ${varCel(u.var_30d, 1)} <span class="faint">30 dias</span> · ${varCel(u.var_1a, 1)} <span class="faint">12 meses</span></div></div>
        <p class="achado">${achado.length ? `O preço de hoje está <b>${achado.join("</b> e <b>")}</b>.` : "Sem lucro, dividendos ou cobertura de analistas suficientes para estimar um preço justo."}
          ${u.faixa_1m ? ` Pela oscilação recente, em 2 de cada 3 meses o preço termina entre <b class="num">${reais(u.faixa_1m[0])}</b> e <b class="num">${reais(u.faixa_1m[1])}</b>.` : ""}</p>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px">${abasPeriodo("6M")}
        <div class="pilulas"><button type="button" data-tipo="linha" class="ativo">Linha</button><button type="button" data-tipo="velas">Velas</button></div></div>
      <div class="grafico alto" id="g-acao"><div class="carregando"></div></div>
      <div class="acoes-topo" style="margin-top:14px">
        <button class="botao branco" type="button" data-rolar="comprar">Como comprar ${esc(papel)}</button>
        <a class="botao vazado" href="#carteira" data-carteira="${esc(papel)}"><i class="ti ti-wallet" style="margin-right:6px"></i>Pôr na carteira</a>
        <a class="botao vazado" href="https://github.com/${RADAR.repo}/edit/main/config.yaml" target="_blank" rel="noopener">${estado.resultado.watchlist.some((w) => w.papel === papel) ? "Está na watchlist · editar" : "Pôr na watchlist"}</a>
      </div>
    </section>
    <section class="painel s4 leitura">
      <div class="painel-cabeca"><h2>Leitura do Radar</h2></div>
      ${u.pontos != null ? `<div class="pontuacao"><div class="faint">Pontuação dos sinais</div><div class="valor">${u.pontos}<small> de 100</small></div>
        <div class="trilha-pont"><span style="width:${u.pontos}%"></span></div><div class="extremos"><span>Mais pontos de atenção</span><span>Mais sinais a favor</span></div></div>` : ""}
      <div class="placar"><div><b class="pos">${u.a_favor?.length ?? 0}</b>a favor</div><div><b class="${u.atencao?.length ? "neg" : ""}">${u.atencao?.length ?? 0}</b>pedem atenção</div></div>
      ${(u.a_favor || []).map((s) => `<div class="sinal-item"><i class="ti ti-check pos"></i><div><b>${esc(s.t)}</b><p>${esc(s.d)}</p></div></div>`).join("")}
      ${(u.atencao || []).map((s) => `<div class="sinal-item"><i class="ti ti-alert-triangle neg"></i><div><b>${esc(s.t)}</b><p>${esc(s.d)}</p></div></div>`).join("")}
      ${!u.a_favor && !u.atencao ? '<div class="vazio">Sem dados de preço suficientes para a leitura.</div>' : ""}
      <p class="faint" style="margin-top:12px">Sinais calculados com regras fixas, explicadas ao lado. Não dizem o que fazer: ajudam a entender a ação.</p>
    </section>

    <section class="painel">
      <div class="painel-cabeca"><h2>Régua de preço</h2><span class="extra">Do mais barato (âmbar) ao mais caro (vermelho), dentro dos valores calculados para ${esc(papel)}</span></div>
      ${regua(u, preco)}
      ${tabelaRegua(u, preco, temAnalistas)}
    </section>

    <section class="painel s4">
      <div class="painel-cabeca"><h2>Indicadores</h2><span class="extra">Fundamentus, último balanço</span></div>
      <table class="kv"><tbody>${["pl", "pvp", "dy", "roe", "roic", "mrg_liq", "div_liq_patrim", "ev_ebitda", "cresc_rec_5a", "liq_corr"].map((c) => {
        const na = u.financeira && NAO_SE_APLICA_FIN.has(c);
        return `<tr><td>${ROTULOS[c]}</td><td class="n">${na ? '<span class="faint">não se aplica</span>' : u[c] == null ? "—" : num(u[c], PCT.has(c) ? 1 : 2) + (PCT.has(c) ? "%" : "")}</td></tr>`;
      }).join("")}
      <tr><td>Lucro por ação (LPA)</td><td class="n">${u.lpa == null ? "—" : reais(u.lpa)}</td></tr>
      <tr><td>Patrimônio por ação (VPA)</td><td class="n">${u.vpa == null ? "—" : reais(u.vpa)}</td></tr>
      <tr><td>Dividendo por ação, 12 meses</td><td class="n">${u.dpa == null ? "—" : reais(u.dpa)}</td></tr>
      <tr><td>Volume médio por dia</td><td class="n">R$ ${num((u.liq_2meses || 0) / 1e6, 1)} mi</td></tr>
      <tr><td>Estratégias em que passa</td><td class="n">${em.length ? esc(em.map(([, e]) => e.nome).join(", ")) : "nenhuma"}</td></tr></tbody></table></div>
    </section>
    <section class="painel s8">
      <div class="painel-cabeca"><h2>Como os números foram calculados</h2></div>
      ${comoCalculado(u, preco, temAnalistas)}
    </section>

    ${painelProventos(papel, u, preco)}

    <section class="painel" id="comprar">
      <div class="painel-cabeca"><h2>Como comprar ${esc(papel)}</h2></div>
      <div class="passos">
        <div class="passo"><b>1. Abra conta numa corretora</b><p>Qualquer corretora autorizada pela CVM e participante da B3 serve. Muitas não cobram corretagem para ações; compare as taxas antes.</p></div>
        <div class="passo"><b>2. Transfira o dinheiro</b><p>Por Pix ou TED, de uma conta no seu nome. O saldo aparece no app da corretora para investir.</p></div>
        <div class="passo"><b>3. Envie a ordem no home broker</b><p>Lote padrão (100 ações): <span class="num" style="color:var(--text)">${reais(preco * 100)}</span>. No fracionário, a partir de 1 ação: <span class="num" style="color:var(--text)">${reais(preco)}</span>. Prefira a ordem limitada, com o preço máximo que aceita pagar.</p>
          <span class="codigo">${esc(papel)}</span> <span class="faint">lote padrão</span> · <span class="codigo">${esc(papel)}F</span> <span class="faint">fracionário</span></div>
      </div>
      <p class="aviso-legal">A compra é liquidada em 2 dias úteis (D+2). Lucros com ações podem pagar imposto de renda; confira as regras em vigor com a corretora ou um contador.
        O Radar faz triagem pelos critérios que você definiu e cálculos com dados públicos. Não é recomendação de compra ou venda.</p>
    </section>
    ${rodape()}`;

  desenharGraficoAcao(papel);
  if (estado.rolarPara) { const alvo = document.getElementById(estado.rolarPara); estado.rolarPara = null; setTimeout(() => alvo?.scrollIntoView({ behavior: "smooth" }), 60); }
}

function marcosRegua(u, preco, comAnalistas) {
  const m = [];
  if (u.min_52s) m.push({ k: "min", rot: "Mín. 52 sem.", v: u.min_52s, sec: true });
  if (u.max_52s) m.push({ k: "max", rot: "Máx. 52 sem.", v: u.max_52s, sec: true });
  if (u.graham) m.push({ k: "graham", rot: "Graham", v: u.graham });
  if (u.bazin) m.push({ k: "bazin", rot: "Bazin", v: u.bazin });
  if (comAnalistas) m.push({ k: "alvo", rot: "Analistas", v: u.alvo_medio });
  return m;
}

// Rótulos perto das pontas da régua crescem para dentro, para nunca saírem da tela.
const ancora = (x) => x > 82 ? "transform:translateX(-100%);align-items:flex-end;text-align:right"
  : x < 18 ? "transform:none;align-items:flex-start;text-align:left" : "";
function regua(u, preco) {
  const temA = (u.analistas || 0) >= 3 && u.alvo_medio;
  const marcos = marcosRegua(u, preco, temA);
  if (!preco || !marcos.length) return '<div class="vazio" style="margin-top:14px">Sem dados suficientes para a régua.</div>';
  const vals = [preco, ...marcos.map((m) => m.v), ...(u.faixa_1m || [])];
  // Valores muito distantes (ex.: Graham 7× o preço) vão para a ponta, com seta, para não esmagar a régua.
  let lo = Math.max(Math.min(...vals), preco * 0.4), hi = Math.min(Math.max(...vals), preco * 2.5);
  const folga = (hi - lo) * 0.05; lo -= folga; hi += folga;
  const x = (v) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
  const fora = (v) => v < lo ? "← " : v > hi ? " →" : "";
  // Marcos a menos de 7% um do outro viram um rótulo só; os demais descem em pistas,
  // e a haste de uma pista nunca atravessa o rótulo da pista de cima.
  const grupos = [];
  for (const m of marcos.map((m) => ({ ...m, x: x(m.v) })).sort((a, b) => a.x - b.x)) {
    const ult = grupos.at(-1);
    if (ult && m.x - ult.itens[0].x < 7) ult.itens.push(m); else grupos.push({ itens: [m] });
  }
  const faixas = [];
  const posicionados = grupos.map((g) => {
    const gx = g.itens.reduce((s, m) => s + m.x, 0) / g.itens.length;
    let pista = 0;
    while (faixas[pista] != null && gx - faixas[pista] < 13) pista++;
    faixas[pista] = gx;
    return { x: gx, pista, itens: g.itens, sec: g.itens.every((m) => m.sec) };
  });
  const xh = x(preco), pistas = Math.max(...posicionados.map((m) => m.pista + m.itens.length * 0.4)) + 0.3;
  return `<div class="regua" style="padding-bottom:${30 + pistas * 44}px" role="img" aria-label="Régua de preço de ${num(lo)} a ${num(hi)} reais">
    <div class="marco hoje" style="left:${xh}%;top:0;${ancora(xh)}"><div class="rot">Hoje<b>${num(preco)}</b></div><div class="haste" style="height:16px"></div></div>
    <div class="regua-trilha">
      ${u.faixa_1m ? `<div class="regua-faixa" style="left:${x(u.faixa_1m[0])}%;width:${x(u.faixa_1m[1]) - x(u.faixa_1m[0])}%" title="Faixa provável em 1 mês"></div>` : ""}
      ${temA && u.alvo_min && u.alvo_max ? `<div class="regua-alvo" style="left:${x(u.alvo_min)}%;width:${Math.max(0.5, x(u.alvo_max) - x(u.alvo_min))}%" title="Alvos dos analistas, do menor ao maior"></div>` : ""}
    </div>
    ${posicionados.map((g) => `<div class="marco ${g.sec ? "secundario" : ""}" style="left:${g.x}%;top:56px;${ancora(g.x)}"><div class="haste" style="height:${8 + g.pista * 44}px"></div>
      <div class="rot">${g.itens.map((m) => `${m.rot} <b style="display:inline">${fora(m.v).startsWith("←") ? "← " : ""}${num(m.v)}${fora(m.v).endsWith("→") ? " →" : ""}</b>`).join("<br>")}</div></div>`).join("")}
  </div>`;
}

function tabelaRegua(u, preco, temA) {
  const linha = (nome, valor, ref, nota) => `<tr><td>${nome}<div class="faint">${nota}</div></td><td class="n">${valor}</td><td class="n">${ref == null ? "—" : varCel(dif(ref, preco), 0)}</td></tr>`;
  return `<table class="regua-tabela"><thead><tr><th>Referência</th><th class="n">Valor</th><th class="n">Em relação a hoje</th></tr></thead><tbody>
    ${u.faixa_1m ? linha("Faixa provável em 1 mês", `${num(u.faixa_1m[0])} a ${num(u.faixa_1m[1])}`, null, "O retângulo claro na régua") : ""}
    ${u.min_52s ? linha("Mínima e máxima de 52 semanas", `${num(u.min_52s)} a ${num(u.max_52s)}`, null, "O menor e o maior preço do último ano") : ""}
    ${u.graham ? linha("Preço justo de Graham", reais(u.graham), u.graham, "Pelo lucro e pelo patrimônio da empresa") : ""}
    ${u.bazin ? linha("Preço-teto de Bazin", reais(u.bazin), u.bazin, "Até onde o dividendo atual rende 6% ao ano") : ""}
    ${temA ? linha(`Alvo médio de ${u.analistas} analistas`, reais(u.alvo_medio), u.alvo_medio, `Do menor ${reais(u.alvo_min)} ao maior ${reais(u.alvo_max)} (a linha branca na régua)`) : ""}
  </tbody></table></div>`;
}

function comoCalculado(u, preco, temA) {
  const itens = [];
  if (u.graham) itens.push(`<div class="conta-item"><b>Preço justo de Graham</b>
    <p><code>√(22,5 × LPA ${num(u.lpa)} × VPA ${num(u.vpa)}) = ${reais(u.graham)}</code></p>
    <p>LPA é o lucro por ação dos últimos 12 meses e VPA, o patrimônio por ação. O 22,5 vem dos limites de Benjamin Graham: pagar até 15 vezes o lucro e 1,5 vez o patrimônio. Funciona mal para empresas de lucro irregular.</p></div>`);
  if (u.bazin) itens.push(`<div class="conta-item"><b>Preço-teto de Bazin</b>
    <p><code>dividendo por ação ${num(u.dpa)} ÷ 6% = ${reais(u.bazin)}</code></p>
    <p>Usa os dividendos dos últimos 12 meses (yield de ${num(u.dy, 1)}%). Décio Bazin só comprava quando o dividendo rendia pelo menos 6% ao ano. Dividendos passados não garantem os futuros.</p></div>`);
  if (u.faixa_1m) itens.push(`<div class="conta-item"><b>Faixa provável em 1 mês</b>
    <p><code>${num(preco)} × e^(±σ × √21) = ${num(u.faixa_1m[0])} a ${num(u.faixa_1m[1])}</code></p>
    <p>σ é a oscilação diária dos últimos 6 meses (${num(u.vol_anual, 1)}% ao ano). É uma estimativa de quanto o preço costuma variar, não de para onde ele vai: em cerca de 2 de cada 3 meses, o preço termina dentro dela.</p></div>`);
  if (temA) itens.push(`<div class="conta-item"><b>Alvo dos analistas</b>
    <p>Média das projeções de ${u.analistas} analistas de bancos e corretoras para os próximos 12 meses, segundo o Yahoo Finance. Analistas também erram e revisam os alvos com frequência.</p></div>`);
  itens.push(`<div class="conta-item"><b>Leitura do Radar</b><p>Conta sinais com regras fixas: preço abaixo de Graham (10% ou mais) ou de Bazin, ROE acima de 15%, dívida até 0,5× o patrimônio e alvo dos analistas 10% acima contam a favor. Prejuízo, ROE abaixo de 8%, dívida acima de 2×, queda de 15% no mês ou alvo abaixo do preço pedem atenção. A pontuação começa em 50, soma 10 por sinal a favor e tira 10 por sinal de atenção, de 0 a 100.</p></div>`);
  return itens.join("");
}

async function desenharGraficoAcao(papel) {
  let velas;
  try { velas = await carregarJSON(`dados/precos/${papel}.json`); } catch { velas = null; }
  const el = $("#g-acao");
  if (!el) return;
  if (!velas || !window.LightweightCharts) { el.innerHTML = '<div class="vazio">Gráfico disponível para as ações das estratégias e da watchlist.</div>'; el.style.height = "auto"; return; }
  el.innerHTML = "";
  const g = grafico(el);
  g.applyOptions({ layout: { textColor: "rgba(255,255,255,.75)" }, grid: { horzLines: { color: "rgba(255,255,255,.08)" } } });
  let tipo = "linha", periodo = "6M", serie, media, vol;
  const desenhar = () => {
    for (const s of [serie, media, vol]) if (s) g.removeSeries(s);
    const d = velas.slice(-PERIODOS[periodo]), ini = velas.length - d.length;
    vol = volume(g, d);
    if (tipo === "velas") {
      serie = g.addCandlestickSeries({ upColor: "#5fe0a4", downColor: "#ff6b5e", borderVisible: false, wickUpColor: "#5fe0a4", wickDownColor: "#ff6b5e", priceLineVisible: false });
      serie.setData(d.map(([time, open, high, low, close]) => ({ time, open, high, low, close })));
    } else {
      serie = linhaTendencia(g, d.map((v) => [v[0], v[4]]));
    }
    media = g.addLineSeries({ color: "rgba(255,255,255,.6)", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    media.setData(d.map((v, i) => { const j = ini + i; return j < 19 ? null : { time: v[0], value: velas.slice(j - 19, j + 1).reduce((s, x) => s + x[4], 0) / 20 }; }).filter(Boolean));
    g.timeScale().fitContent();
  };
  desenhar();
  dica(g, el, () => serie, (v) => reais(v));
  ligarAbas($("#p-graf"), "periodo", (p) => { periodo = p; desenhar(); });
  ligarAbas($("#p-graf"), "tipo", (t) => { tipo = t; desenhar(); });
}

// ---------- Watchlist ----------
function telaWatchlist() {
  const w = estado.resultado.watchlist;
  const alerta = (p) => {
    const out = [];
    for (const [lado, alvo] of [["abaixo", p.abaixo_de], ["acima", p.acima_de]]) {
      if (!alvo || p.preco == null) continue;
      const falta = lado === "abaixo" ? dif(p.preco, alvo) : dif(alvo, p.preco);
      out.push(falta <= 0 ? `<span class="pilula aviso">Disparou: ${lado} de ${reais(alvo)}</span>`
        : `<div class="faint">${lado === "abaixo" ? "Abaixo" : "Acima"} de ${reais(alvo)} · falta ${num(falta, 1)}%</div><div class="barra-fina"><span style="width:${Math.max(3, 100 - falta * 4)}%"></span></div>`);
    }
    return out.join("") || '<span class="faint">sem alerta</span>';
  };
  tela.innerHTML = `${cabecalho("Watchlist", `${w.length} ações acompanhadas de perto. Alertas de preço avisam quando o preço cruza o nível que você definiu.`,
      `<a class="botao contorno" href="https://github.com/${RADAR.repo}/edit/main/config.yaml" target="_blank" rel="noopener"><i class="ti ti-pencil" style="font-size:16px"></i>Editar lista</a>`)}
    <section class="painel s8">
      <div class="rolagem"><table><thead><tr><th>Ação</th><th class="n">Preço</th><th class="n">Hoje</th><th class="n esconde-celular">30 dias</th><th class="n esconde-celular">Abaixo da máx.</th><th class="n">Alerta de preço</th></tr></thead><tbody>
      ${w.map((p) => `<tr data-href="#acao/${esc(p.papel)}"><td>${ativoCel(p.papel)}</td><td class="n">${num(p.preco)}</td><td class="n">${varCel(p.var_dia)}</td>
        <td class="n esconde-celular">${varCel(p.var_30d, 1)}</td><td class="n esconde-celular">${p.queda_52s == null ? "—" : num(p.queda_52s, 0) + "%"}</td><td class="n" style="padding:8px 0">${alerta(p)}</td></tr>`).join("")}
      </tbody></table></div>
    </section>
    <section class="painel s4">
      <div class="painel-cabeca"><h2>Como mudar a lista</h2></div>
      <p class="muted">A watchlist fica no arquivo <b>config.yaml</b> do repositório. Cada linha é uma ação; os alertas de preço são opcionais.</p>
      <pre class="exemplo"><code>watchlist:
  - { papel: PETR4 }
  - { papel: BBAS3, abaixo_de: 20.00 }
  - { papel: WEGE3, acima_de: 60.00 }</code></pre>
      <p class="muted">Use ponto como separador decimal. Depois de salvar, a próxima atualização (em até 15 minutos no pregão) já usa a lista nova, e o aviso chega quando o preço cruza o nível, uma vez por cruzamento.</p>
    </section>${rodape()}`;
}

// ---------- Alertas ----------
function eventos(regs) {
  const lista = [];
  for (const r of regs) {
    let grupo = "";
    for (const l of r.linhas) {
      const g = l.match(/^\[(.+)\]$/);
      if (g) { grupo = g[1]; continue; }
      let m;
      if ((m = l.match(/^\+ (\S+) \(R\$ ([^)]+)\): (.*)$/))) lista.push({ em: r.em, tipo: "pos", s: "+", t: `${m[1]} entrou em ${grupo}`, d: m[3], p: m[1] });
      else if ((m = l.match(/^- (\S+) saiu: (.*)$/))) lista.push({ em: r.em, tipo: "neg", s: "−", t: `${m[1]} saiu de ${grupo}`, d: m[2], p: m[1] });
      else {
        const p = l.match(/^([A-Z]{4}\d{1,2})\b/)?.[1];
        lista.push({ em: r.em, tipo: "info", s: p ? "!" : "·", t: p ? `Alerta de preço: ${p}` : "Radar", d: l, p });
      }
    }
  }
  return lista;
}
function mudancaHTML(e) {
  const marca = e.p ? logo(e.p) : `<span class="sinal">${e.s}</span>`;
  const cor = e.tipo === "info" ? "color:var(--laranja-2)" : "";
  const corpo = `${marca}<div style="min-width:0"><b>${esc(e.t)}</b><p>${esc(e.d)}</p></div>
    <span class="quando"><span class="${e.tipo === "info" ? "" : e.tipo}" style="display:block;text-align:right;font-weight:800;font-size:16px;${cor}">${e.s}</span>${quando(e.em).split(",")[0]}</span>`;
  return e.p ? `<a class="mudanca" href="#acao/${esc(e.p)}">${corpo}</a>` : `<div class="mudanca">${corpo}</div>`;
}
function avisoPush() {
  const p = estado.resultado.push || {};
  if (p.expiradas > 0) return `<div class="nota"><i class="ti ti-bell-off"></i><div>As notificações pararam em ${p.expiradas} aparelho(s). <a href="#alertas">Reativar</a></div></div>`;
  if (!p.configurado) return `<div class="nota"><i class="ti ti-bell"></i><div>Receba as mudanças como notificação no celular. <a href="#alertas">Ativar notificações</a></div></div>`;
  return "";
}

function telaAlertas() {
  const regs = estado.historico;
  tela.innerHTML = `${cabecalho("Alertas", `${regs.length} atualizações com mudança. O Radar confere as estratégias a cada 15 minutos de pregão e só avisa o que mudou.`)}
    <section class="painel s8" style="align-self:start"><div class="painel-cabeca"><h2>Histórico</h2></div>
      ${regs.map((r) => `<h3 class="faint" style="margin:14px 0 4px;font-weight:500">${quando(r.em)}</h3>${eventos([r]).map(mudancaHTML).join("")}`).join("") || '<div class="vazio">Nenhum alerta ainda.</div>'}
    </section>
    <div class="s4 coluna-pilha"><section class="painel" id="push"></section>
      <section class="painel"><div class="painel-cabeca"><h2>Quando o Radar avisa</h2></div>
        <div class="sinal-item"><span class="pos num">+</span><div><b>Uma ação entrou numa estratégia</b><p>Passou a cumprir todos os critérios daquela estratégia.</p></div></div>
        <div class="sinal-item"><span class="neg num">−</span><div><b>Uma ação saiu</b><p>Deixou de cumprir algum critério; o aviso diz qual.</p></div></div>
        <div class="sinal-item"><span class="num" style="color:var(--ambar)">!</span><div><b>Um alerta de preço disparou</b><p>O preço cruzou o nível da sua watchlist. Avisa uma vez por cruzamento, não a cada atualização.</p></div></div>
      </section></div>${rodape()}`;
  montarPush();
}

const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalado = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
function chaveParaBytes(b64) {
  const s = atob((b64 + "=".repeat((4 - b64.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
async function montarPush() {
  const box = $("#push"), topo = `<div class="painel-cabeca"><h2>Notificações neste aparelho</h2></div>`;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    box.innerHTML = topo + `<p class="muted">${ehIOS && !instalado ? "No iPhone, adicione o app à tela inicial primeiro: Compartilhar → Adicionar à Tela de Início. Depois abra pelo ícone e volte aqui." : "Este navegador não recebe notificações push."}</p>`;
    return;
  }
  const reg = await navigator.serviceWorker.ready, atual = await reg.pushManager.getSubscription();
  box.innerHTML = `${topo}<p class="muted" style="margin-bottom:14px">${atual ? "Este aparelho já gerou uma inscrição." : "Um aviso sempre que uma ação entrar ou sair das suas estratégias, ou cruzar um preço da watchlist."}</p>
    <button class="botao primario" id="ativar" type="button">${atual ? "Mostrar o código de novo" : "Ativar notificações"}</button><div id="codigo"></div>`;
  $("#ativar").onclick = async () => {
    try {
      if ((await Notification.requestPermission()) !== "granted") throw new Error("a permissão foi negada nas configurações do navegador.");
      const insc = atual || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(RADAR.vapidPublica) });
      const json = JSON.stringify(insc);
      $("#codigo").innerHTML = `<textarea class="codigo" readonly aria-label="Código de inscrição">${esc(json)}</textarea>
        <button class="botao contorno" id="copiar" type="button" style="margin-top:10px">Copiar código</button>
        <ol class="lista-passos"><li>Abra <a href="https://github.com/${RADAR.repo}/settings/secrets/actions" target="_blank" rel="noopener">as Secrets do repositório</a>.</li>
          <li>Crie ou edite o secret PUSH_SUBSCRIPTIONS e cole o código.</li><li>Vários aparelhos: um código por linha.</li></ol>`;
      $("#copiar").onclick = async () => { await navigator.clipboard.writeText(json); $("#copiar").textContent = "Copiado"; };
    } catch (erro) {
      $("#codigo").innerHTML = `<div class="nota" style="margin-top:12px"><i class="ti ti-alert-triangle"></i><div>Não foi possível ativar: ${esc(erro.message)}</div></div>`;
    }
  };
}

const rodape = () => `<p class="rodape-legal">Triagem pelos critérios definidos por você e cálculos com dados públicos (Fundamentus, Yahoo Finance, Banco Central), com cerca de 15 minutos de atraso. Não é recomendação de compra ou venda.</p>`;

// ---------- Busca rápida (Ctrl K) ----------
let sel = 0;
function abrirBusca() { $("#paleta").hidden = false; $("#paleta-input").value = ""; filtrar(); $("#paleta-input").focus(); }
function fecharBusca() { $("#paleta").hidden = true; }
function filtrar() {
  const q = $("#paleta-input").value.trim().toUpperCase();
  const todos = Object.entries(estado.universo);
  const res = (q ? todos.filter(([p, u]) => p.includes(q) || (u.nome || "").toUpperCase().includes(q)).sort((a, b) => b[0].startsWith(q) - a[0].startsWith(q))
    : estado.resultado.watchlist.map((w) => [w.papel, estado.universo[w.papel] || {}])).slice(0, 8);
  sel = 0;
  $("#paleta-lista").innerHTML = res.map(([p, u], i) => `<a href="#acao/${esc(p)}" class="${i ? "" : "sel"}">${ativoCel(p)}<span class="dir">${num(precoDe(p))}<br>${varCel(u.var_dia)}</span></a>`).join("")
    || `<div class="vazio">Nenhuma ação com "${esc(q)}" entre as que têm negociação suficiente.</div>`;
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-busca], #abrir-busca-trilho")) abrirBusca();
  if (e.target.closest("[data-comprar]")) estado.rolarPara = "comprar";
  const praCarteira = e.target.closest("[data-carteira]");
  if (praCarteira) estado.carteiraPapel = praCarteira.dataset.carteira;
  const ordemLista = e.target.closest("[data-lista]");
  if (ordemLista) estado.lista = { q: "", setor: "", campo: ordemLista.dataset.lista, desc: false };
  const rolar = e.target.closest("[data-rolar]");
  if (rolar) document.getElementById(rolar.dataset.rolar)?.scrollIntoView({ behavior: "smooth", block: "start" });
});
$("#paleta").onclick = (e) => { if (e.target.id === "paleta" || e.target.closest("a")) fecharBusca(); };
$("#paleta-input").oninput = filtrar;
$("#paleta-input").onkeydown = (e) => {
  const itens = $$("#paleta-lista a");
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && itens.length) {
    e.preventDefault();
    sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
    itens.forEach((a, i) => a.classList.toggle("sel", i === sel));
  } else if (e.key === "Enter" && itens[sel]) { location.hash = itens[sel].getAttribute("href"); fecharBusca(); }
};
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); abrirBusca(); }
  if (e.key === "Escape") fecharBusca();
});

// ---------- Atualização automática ----------
// O robô do GitHub publica dados novos a cada 5 minutos de pregão. O app confere a cada minuto
// e redesenha a tela atual sem perder a posição da rolagem quando chega algo novo.
async function conferirNovidades() {
  if (document.hidden || !estado.resultado) return;
  try {
    const novo = await carregarJSON("dados/resultado.json");
    if (novo.gerado_em !== estado.resultado.gerado_em) {
      const y = window.scrollY;
      estado.rotaAtual = null;
      await carregar();
      window.scrollTo({ top: y, behavior: "instant" });
    }
  } catch { /* sem rede: tenta de novo no próximo minuto */ }
  marcarIdade();
}
function marcarIdade() {
  if (!estado.resultado) return;
  const min = Math.round((Date.now() - new Date(estado.resultado.gerado_em)) / 60000);
  const agora = new Date(), dia = agora.getDay(), h = agora.getHours() + agora.getMinutes() / 60;
  const pregao = dia > 0 && dia < 6 && h >= 10 && h < 18.2;
  const velho = pregao && min > 30;
  const txt = min < 1 ? "Atualizado agora" : min < 60 ? `Atualizado há ${min} min` : `Atualizado ${quando(estado.resultado.gerado_em)}`;
  $("#status-texto").textContent = velho ? `${txt} · atrasado` : txt;
  $("#status-menu").classList.toggle("atrasado", velho);
}
setInterval(conferirNovidades, 60000);

// ---------- Menu lateral ----------
const app = $("#app");
try { if (localStorage.getItem("radar-menu") === "1") app.classList.add("menu-aberto"); } catch {}
$("#alternar-menu").setAttribute("aria-expanded", app.classList.contains("menu-aberto"));
$("#alternar-menu").onclick = () => {
  const aberto = app.classList.toggle("menu-aberto");
  $("#alternar-menu").setAttribute("aria-expanded", aberto);
  try { localStorage.setItem("radar-menu", aberto ? "1" : "0"); } catch {}
};

// ---------- Início ----------
window.addEventListener("hashchange", rotear);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
tela.innerHTML = `<header class="titulo"><div><h1>Radar B3</h1><div class="carregando" style="width:320px"></div></div></header><section class="painel s8"><div class="carregando"></div><div class="carregando" style="width:40%"></div></section><section class="painel s4"><div class="carregando"></div></section>`;
carregar();
document.addEventListener("visibilitychange", () => { if (!document.hidden && estado.resultado) carregar(); });
