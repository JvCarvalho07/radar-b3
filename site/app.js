// Radar B3: app estático que lê os JSON gerados pelo scan.py.
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
const conteudo = $("#conteudo");
const estado = { resultado: null, historico: [], universo: {}, estrategia: null, graficos: [] };

const ROTULOS = {
  pl: ["P/L", false], pvp: ["P/VP", false], psr: ["PSR", false], dy: ["Dividend yield", true],
  ev_ebitda: ["EV/EBITDA", false], mrg_liq: ["Margem líquida", true], roic: ["ROIC", true],
  roe: ["ROE", true], liq_corr: ["Liquidez corrente", false], div_liq_patrim: ["Dív. líq./Patrim.", false],
  cresc_rec_5a: ["Cresc. receita 5a", true], queda_52s: ["Abaixo da máx. 52s", true],
  var_dia: ["Var. dia", true], var_30d: ["Var. 30d", true], var_1a: ["Var. 1 ano", true],
};
const NAO_SE_APLICA_FIN = new Set(["div_liq_patrim", "liq_corr", "roic", "ev_ebitda"]);
const ICONES_EST = { valor_dividendos: "ti-coins", caiu_demais: "ti-trending-down-2", qualidade: "ti-diamond" };
const PERIODOS = { "1M": 21, "3M": 63, "6M": 126, "1A": 9999 };
const TITULOS = { inicio: "Visão geral", estrategias: "Estratégias", acao: "Ações", watchlist: "Watchlist", alertas: "Alertas" };
const COR = { alta: "#2ed39a", baixa: "#ff5c64", laranja: "#ff8a1f" };

// ---------- Utilidades ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, casas = 2) => (v == null || Number.isNaN(v) ? "—" :
  Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }));
const reais = (v, casas = 2) => (v == null ? "—" : `R$ ${num(v, casas)}`);
const tipo = (v) => (v == null ? "neutra" : v >= 0 ? "alta" : "baixa");
const variacao = (v, casas = 2) => v == null ? `<span class="variacao neutra">—</span>` :
  `<span class="variacao ${tipo(v)}"><i class="ti ti-arrow-${v >= 0 ? "up" : "down"}-right"></i>${num(Math.abs(v), casas)}%</span>`;
const dataHora = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function logo(papel, tam = "") {
  const ini = esc(papel.slice(0, 4));
  return `<span class="logo ${tam}"><b>${ini}</b><img src="https://icons.brapi.dev/icons/${esc(papel)}.svg" alt="" loading="lazy" onerror="this.remove()"></span>`;
}

let idSpark = 0;
function spark(valores, { cheio = true } = {}) {
  if (!valores || valores.length < 2) return `<svg class="spark"></svg>`;
  const w = 100, h = 34, min = Math.min(...valores), max = Math.max(...valores), amp = max - min || 1;
  const pts = valores.map((v, i) => [(i / (valores.length - 1)) * w, h - 2 - ((v - min) / amp) * (h - 4)]);
  const linha = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const cor = valores.at(-1) >= valores[0] ? COR.alta : COR.baixa, id = `sp${idSpark++}`;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${cor}" stop-opacity=".28"/><stop offset="1" stop-color="${cor}" stop-opacity="0"/></linearGradient></defs>
    ${cheio ? `<path d="${linha}L${w},${h}L0,${h}Z" fill="url(#${id})"/>` : ""}
    <path d="${linha}" fill="none" stroke="${cor}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

function contar(el, alvo, casas) {
  if (!el || alvo == null || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const inicio = performance.now(), de = alvo * 0.96;
  const passo = (t) => {
    const p = Math.min(1, (t - inicio) / 900), e = 1 - Math.pow(1 - p, 3);
    el.firstChild.textContent = num(de + (alvo - de) * e, casas);
    if (p < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

const precoDe = (p) => { const u = estado.universo[p] || {}; return u.preco ?? u.cotacao ?? null; };
const comPreco = () => Object.entries(estado.universo).filter(([, u]) => u.var_dia != null);

async function carregarJSON(caminho) {
  const resp = await fetch(caminho, { cache: "no-store" });
  if (!resp.ok) throw new Error(`${caminho}: ${resp.status}`);
  return resp.json();
}

// ---------- Carga e rotas ----------
async function carregar() {
  try {
    [estado.resultado, estado.historico, estado.universo] = await Promise.all([
      carregarJSON("dados/resultado.json"), carregarJSON("dados/historico.json"), carregarJSON("dados/universo.json"),
    ]);
  } catch {
    conteudo.innerHTML = `<div class="aviso"><i class="ti ti-cloud-off"></i><div>Ainda não há dados publicados. Rode <code>scan.py</code> ou aguarde a próxima atualização.</div></div>`;
    return;
  }
  // Watchlist fora do filtro de liquidez também precisa de preço para a fita e os cards.
  for (const w of estado.resultado.watchlist) estado.universo[w.papel] ??= { preco: w.preco, var_dia: w.var_dia, var_30d: w.var_30d, queda_52s: w.queda_52s };
  estado.estrategia ??= Object.keys(estado.resultado.estrategias)[0];
  $("#atualizado").innerHTML = `<span class="ponto"></span>Atualizado ${dataHora(estado.resultado.gerado_em)}`;
  montarFita();
  montarMiniPush();
  rotear();
}

function rotear() {
  if (!estado.resultado) return;
  const [aba, arg] = (location.hash.slice(1) || "inicio").split("/");
  const tela = TITULOS[aba] ? aba : "inicio";
  $$("#menu a, #inferior a").forEach((a) => a.classList.toggle("ativa", a.dataset.aba === tela));
  $("#titulo").textContent = TITULOS[tela];
  estado.graficos.forEach((g) => g.remove());
  estado.graficos = [];
  conteudo.classList.remove("entrar");
  ({ inicio: telaInicio, estrategias: telaEstrategias, acao: telaAcao, watchlist: telaWatchlist, alertas: telaAlertas })[tela](arg);
  $$(":scope > *", conteudo).forEach((el, i) => el.style.setProperty("--i", i));
  void conteudo.offsetWidth;
  conteudo.classList.add("entrar");
  window.scrollTo({ top: 0 });
}

// ---------- Fita de cotações ----------
function montarFita() {
  const watch = estado.resultado.watchlist.map((w) => w.papel);
  const movers = comPreco().sort((a, b) => Math.abs(b[1].var_dia) - Math.abs(a[1].var_dia)).slice(0, 14).map(([p]) => p);
  const m = estado.resultado.mercado || {};
  const itens = [
    m.ibovespa && `<a href="#inicio"><b>IBOV</b>${num(m.ibovespa.valor, 0)} <span class="txt-${tipo(m.ibovespa.var_dia)}">${num(m.ibovespa.var_dia)}%</span></a>`,
    m.dolar && `<a href="#inicio"><b>USD</b>${num(m.dolar.valor, 3)} <span class="txt-${tipo(m.dolar.var_dia)}">${num(m.dolar.var_dia)}%</span></a>`,
    ...[...new Set([...watch, ...movers])].map((p) => {
      const u = estado.universo[p] || {};
      return `<a href="#acao/${esc(p)}"><b>${esc(p)}</b>${num(precoDe(p))} <span class="txt-${tipo(u.var_dia)}">${u.var_dia == null ? "" : num(u.var_dia) + "%"}</span></a>`;
    }),
  ].filter(Boolean).join("");
  $("#fita").innerHTML = `<div class="fita-trilho">${itens}${itens}</div>`;
}

// ---------- Gráficos ----------
function novoGrafico(el, extra = {}) {
  const g = LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: "#8a8a96", fontFamily: "Plus Jakarta Sans, system-ui", fontSize: 11 },
    grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,.05)" } },
    rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false },
    crosshair: { mode: 0, vertLine: { color: "rgba(255,193,92,.5)", labelBackgroundColor: "#ff8a1f" },
                 horzLine: { color: "rgba(255,193,92,.3)", labelBackgroundColor: "#ff8a1f" } },
    handleScroll: false, handleScale: false,
    localization: { locale: "pt-BR", priceFormatter: (p) => num(p, p > 1000 ? 0 : 2) },
    ...extra,
  });
  estado.graficos.push(g);
  return g;
}

function serieArea(g) {
  return g.addAreaSeries({ lineColor: "#ff8a1f", lineWidth: 2, topColor: "rgba(255,138,31,.32)", bottomColor: "rgba(255,74,43,0)",
                           priceLineVisible: false, crosshairMarkerBackgroundColor: "#ffc15c", crosshairMarkerBorderColor: "#ff4a2b" });
}

function pilulasPeriodo(ativo = "6M") {
  return `<div class="pilulas" role="tablist">${Object.keys(PERIODOS).map((p) =>
    `<button type="button" data-periodo="${p}" class="${p === ativo ? "ativo" : ""}">${p}</button>`).join("")}</div>`;
}

function ligarPilulas(raiz, aoMudar) {
  $$("[data-periodo]", raiz).forEach((b) => b.onclick = () => {
    $$("[data-periodo]", raiz).forEach((x) => x.classList.toggle("ativo", x === b));
    aoMudar(b.dataset.periodo);
  });
}

// ---------- Visão geral ----------
function telaInicio() {
  const r = estado.resultado, m = r.mercado || {}, ib = m.ibovespa;
  const ests = Object.entries(r.estrategias);
  conteudo.innerHTML = `
    ${avisoPush()}
    <div class="grade-inicio">
      <section class="card card-destaque" id="hero">
        <div class="hero-topo">
          <div>
            <div class="rotulo"><i class="ti ti-building-bank"></i>Ibovespa</div>
            <div class="valor-gigante" id="ibov-valor">${ib ? num(ib.valor, 0) : "—"}<small> pts</small></div>
            <div style="display:flex;gap:10px;align-items:center">${variacao(ib?.var_dia)}<span class="apagado" id="ibov-periodo">hoje</span></div>
          </div>
          ${pilulasPeriodo("6M")}
        </div>
        <div class="grafico" id="grafico-ibov"></div>
      </section>
      <div class="coluna">
        <section class="card">
          <div class="rotulo"><i class="ti ti-currency-dollar"></i>Dólar ${m.dolar?.fonte === "PTAX/BC" ? '<span class="chip">PTAX</span>' : "comercial"}</div>
          <div class="valor-grande" style="margin:8px 0 10px">${m.dolar ? reais(m.dolar.valor, 3) : "—"}</div>
          ${variacao(m.dolar?.var_dia)}
        </section>
        <section class="card" style="flex:1">
          <div class="card-cabeca"><h2>Alertas recentes</h2><a class="acao-link" href="#alertas">Ver todos<i class="ti ti-chevron-right"></i></a></div>
          <div class="linha-tempo">${eventos(estado.historico.slice(0, 2)).slice(0, 5).map(eventoHTML).join("") || '<div class="vazio">Nenhum alerta ainda.</div>'}</div>
        </section>
      </div>
    </div>

    <section>
      <div class="card-cabeca"><h2 class="secao-titulo">Suas estratégias</h2><a class="acao-link" href="#estrategias">Ver todas<i class="ti ti-chevron-right"></i></a></div>
      <div class="trilho">${ests.map(([k, e]) => `
        <a class="card estrategia" href="#estrategias/${k}">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="icone"><i class="ti ${ICONES_EST[k] || "ti-filter"}"></i></span>
            <span class="valor-grande">${e.papeis.length}<span class="apagado"> ações</span></span>
          </div>
          <div><b>${esc(e.nome)}</b><div class="apagado">${esc(e.descricao)}</div></div>
          <div class="rodape-card"><div class="pilha">${e.papeis.slice(0, 5).map((p) => logo(p.papel, "p")).join("")}</div>
            <span class="acao-link">Abrir<i class="ti ti-arrow-right"></i></span></div>
        </a>`).join("")}</div>
    </section>

    <section class="card">
      <div class="card-cabeca" style="flex-wrap:wrap"><h2>Em movimento hoje</h2>
        <div class="pilulas" style="margin-left:auto"><button type="button" data-mov="alta" class="ativo">Maiores altas</button><button type="button" data-mov="baixa">Maiores baixas</button></div></div>
      <div class="lista" id="movimento"></div>
    </section>`;

  const mov = (lado) => {
    const lista = comPreco().sort((a, b) => lado === "alta" ? b[1].var_dia - a[1].var_dia : a[1].var_dia - b[1].var_dia).slice(0, 6);
    $("#movimento").innerHTML = lista.map(([p, u]) => linhaAcao(p, u)).join("") || '<div class="vazio">Sem dados de preço.</div>';
  };
  mov("alta");
  $$("[data-mov]").forEach((b) => b.onclick = () => { $$("[data-mov]").forEach((x) => x.classList.toggle("ativo", x === b)); mov(b.dataset.mov); });

  contar($("#ibov-valor"), ib?.valor, 0);
  if (ib?.serie && window.LightweightCharts) {
    const g = novoGrafico($("#grafico-ibov"));
    const s = serieArea(g);
    const aplicar = (per) => {
      const dados = ib.serie.slice(-PERIODOS[per]);
      s.setData(dados.map(([time, value]) => ({ time, value })));
      g.timeScale().fitContent();
      const v = (dados.at(-1)[1] / dados[0][1] - 1) * 100;
      $("#ibov-periodo").innerHTML = `<span class="txt-${tipo(v)}">${v >= 0 ? "+" : ""}${num(v, 1)}%</span> em ${per === "1A" ? "12 meses" : per}`;
    };
    aplicar("6M");
    ligarPilulas($("#hero"), aplicar);
  }
}

function linhaAcao(p, u, extra = "") {
  return `<a class="linha-acao" href="#acao/${esc(p)}">${logo(p)}
    <span class="nome"><b>${esc(p)}</b><span class="apagado">${extra || (u.financeira ? "Financeira" : "R$ " + num((u.liq_2meses || 0) / 1e6, 0) + " mi/dia")}</span></span>
    ${spark(u.spark?.slice(-30), { cheio: false })}
    <span class="preco">${reais(precoDe(p))}${variacao(u.var_dia)}</span></a>`;
}

// ---------- Estratégias ----------
function textoCriterio(c) {
  const [rot, pct] = ROTULOS[c.campo] || [c.campo, false];
  const f = (v) => num(v, v % 1 ? 1 : 0) + (pct ? "%" : "");
  if (c.min != null && c.max != null) return `${rot} entre ${f(c.min)} e ${f(c.max)}`;
  return c.min != null ? `${rot} ≥ ${f(c.min)}` : `${rot} ≤ ${f(c.max)}`;
}

const ORDENS = {
  papel: ["A–Z", (a, b) => a.papel.localeCompare(b.papel)],
  dy: ["Maior dividend yield", (a, b) => (b.dy ?? -1) - (a.dy ?? -1)],
  queda: ["Mais abaixo da máxima", (a, b) => (b.queda_52s ?? -1) - (a.queda_52s ?? -1)],
  pl: ["Menor P/L", (a, b) => (a.pl ?? 999) - (b.pl ?? 999)],
  dia: ["Maior alta no dia", (a, b) => (b.var_dia ?? -99) - (a.var_dia ?? -99)],
};

function telaEstrategias(arg) {
  const ests = estado.resultado.estrategias;
  if (arg && ests[arg]) estado.estrategia = arg;
  const desenhar = () => {
    const e = ests[estado.estrategia], ordem = $("#ordem")?.value || "papel";
    $("#est-info").innerHTML = `
      <div class="card-cabeca" style="margin:0"><span class="estrategia"><span class="icone"><i class="ti ${ICONES_EST[estado.estrategia] || "ti-filter"}"></i></span></span>
        <div><h2>${esc(e.nome)}</h2><div class="apagado">${esc(e.descricao)}</div></div></div>
      <div class="chips" style="margin-top:16px">${e.criterios.map((c) => `<span class="chip laranja">${esc(textoCriterio(c))}</span>`).join("")}</div>
      <div class="apagado" style="margin-top:12px"><i class="ti ti-building-bank"></i> Bancos e seguradoras: ${e.criterios_financeiras ? esc(e.criterios_financeiras.map(textoCriterio).join(" · ")) : "não entram nesta estratégia."}</div>`;
    const papeis = [...e.papeis].sort(ORDENS[ordem][1]);
    $("#est-lista").innerHTML = papeis.map(cardAcao).join("") || '<div class="card vazio">Nenhuma ação cumpre os critérios agora.</div>';
    $$(".card-acao", $("#est-lista")).forEach((el, i) => { el.style.animation = `subir .45s ${Math.min(i, 12) * 35}ms both cubic-bezier(.2,.8,.2,1)`; });
  };
  conteudo.innerHTML = `
    <div class="pilulas" id="est-abas">${Object.entries(ests).map(([k, v]) =>
      `<button type="button" data-est="${k}" class="${k === estado.estrategia ? "ativo" : ""}">${esc(v.nome)}<span class="conta">${v.papeis.length}</span></button>`).join("")}</div>
    <section class="card" id="est-info"></section>
    <div class="ordenar"><span class="apagado">Toque numa ação para ver o gráfico e os indicadores.</span>
      <select class="seletor" id="ordem" aria-label="Ordenar">${Object.entries(ORDENS).map(([k, [r]]) => `<option value="${k}">${r}</option>`).join("")}</select></div>
    <div class="grade-cards" id="est-lista"></div>`;
  $$("[data-est]").forEach((b) => b.onclick = () => {
    estado.estrategia = b.dataset.est;
    $$("[data-est]").forEach((x) => x.classList.toggle("ativo", x === b));
    history.replaceState(null, "", `#estrategias/${b.dataset.est}`);
    desenhar();
  });
  $("#ordem").onchange = desenhar;
  desenhar();
}

function cardAcao(p) {
  const u = estado.universo[p.papel] || {};
  return `<a class="card card-acao" href="#acao/${esc(p.papel)}">
    <div class="topo">${logo(p.papel)}<div><b>${esc(p.papel)}</b>${p.financeira ? '<span class="etiqueta">financeira</span>' : ""}
      <div class="apagado">${u.var_30d == null ? "" : `30d <span class="txt-${tipo(u.var_30d)}">${num(u.var_30d, 1)}%</span>`}</div></div>
      <div class="preco">${reais(p.preco)}${variacao(p.var_dia)}</div></div>
    ${spark(u.spark)}
    <div class="chips">${(p.motivos || []).slice(0, 4).map((m) => `<span class="chip">${esc(m)}</span>`).join("")}</div></a>`;
}

// ---------- Ação ----------
async function telaAcao(arg) {
  const papel = (arg || estado.resultado.watchlist[0]?.papel || "PETR4").toUpperCase();
  const u = estado.universo[papel];
  if (!u) {
    conteudo.innerHTML = `<div class="card vazio"><i class="ti ti-search" style="font-size:28px"></i><p>${esc(papel)} não está entre as ações com liquidez.</p>
      <button class="botao" type="button" onclick="abrirBusca()"><i class="ti ti-search"></i>Buscar outra</button></div>`;
    return;
  }
  const em = Object.entries(estado.resultado.estrategias).map(([k, e]) => [k, e, e.papeis.find((p) => p.papel === papel)]).filter((x) => x[2]);
  const ind = ["pl", "pvp", "dy", "roe", "roic", "mrg_liq", "div_liq_patrim", "ev_ebitda", "cresc_rec_5a", "liq_corr"];
  const vInd = (c) => {
    const [, pct] = ROTULOS[c];
    if (u.financeira && NAO_SE_APLICA_FIN.has(c)) return `<span class="apagado">n/a</span>`;
    return u[c] == null ? "—" : num(u[c], pct ? 1 : 2) + (pct ? "%" : "");
  };
  conteudo.innerHTML = `
    <section class="card card-destaque" id="acao-hero">
      <div class="acao-topo">${logo(papel, "g")}
        <div><h2>${esc(papel)}${u.financeira ? '<span class="etiqueta">financeira</span>' : ""}</h2>
          <div class="apagado">Volume médio R$ ${num((u.liq_2meses || 0) / 1e6, 1)} mi/dia</div></div>
        <div class="preco-acao"><div class="valor-gigante" id="acao-preco">${num(precoDe(papel))}<small> R$</small></div>${variacao(u.var_dia)} <span class="apagado">hoje</span></div>
      </div>
      <div class="hero-topo" style="margin-top:18px">
        ${pilulasPeriodo("6M")}
        <div class="pilulas"><button type="button" data-tipo="velas" class="ativo"><i class="ti ti-chart-candle"></i> Velas</button><button type="button" data-tipo="linha"><i class="ti ti-chart-area-line"></i> Linha</button></div>
      </div>
      <div class="grafico alto" id="grafico-acao"><div class="esqueleto" style="height:100%"></div></div>
    </section>

    <div class="grade-mini">
      ${[["var_30d", "30 dias"], ["var_1a", "12 meses"]].map(([c, r]) => `<div class="indicador"><div class="rotulo">${r}</div><div class="valor txt-${tipo(u[c])}">${u[c] == null ? "—" : (u[c] >= 0 ? "+" : "") + num(u[c], 1) + "%"}</div></div>`).join("")}
      <div class="indicador"><div class="rotulo">Abaixo da máx. 52s</div><div class="valor">${u.queda_52s == null ? "—" : num(u.queda_52s, 1) + "%"}</div></div>
      <div class="indicador"><div class="rotulo">Estratégias</div><div class="valor">${em.length}</div></div>
    </div>

    <div class="grade-inicio">
      <section class="card">
        <div class="card-cabeca"><h2>Indicadores</h2>${u.financeira ? '<span class="apagado">n/a = não se aplica a bancos e seguradoras</span>' : ""}</div>
        <div class="grade-mini">${ind.map((c) => `<div class="indicador"><div class="rotulo">${ROTULOS[c][0]}</div><div class="valor">${vInd(c)}</div></div>`).join("")}</div>
      </section>
      <section class="card">
        <div class="card-cabeca"><h2>Por que aparece</h2></div>
        ${em.length ? em.map(([k, e, p]) => `<div style="margin-bottom:16px"><a class="acao-link" href="#estrategias/${k}" style="color:var(--texto);font-size:14px"><i class="ti ${ICONES_EST[k] || "ti-filter"}" style="color:var(--laranja)"></i>${esc(e.nome)}</a>
          <div class="chips" style="margin-top:8px">${p.motivos.map((m) => `<span class="chip laranja">${esc(m)}</span>`).join("")}</div></div>`).join("")
          : '<div class="vazio">Não cumpre os critérios de nenhuma estratégia agora.</div>'}
      </section>
    </div>`;
  contar($("#acao-preco"), precoDe(papel), 2);

  let velas;
  try { velas = await carregarJSON(`dados/precos/${papel}.json`); } catch { velas = null; }
  const el = $("#grafico-acao");
  if (!el) return;  // trocou de tela enquanto carregava
  if (!velas || !window.LightweightCharts) {
    el.innerHTML = `<div class="vazio"><i class="ti ti-chart-off" style="font-size:28px"></i><p>Gráfico disponível para ações das estratégias e da watchlist.</p></div>`;
    return;
  }
  el.innerHTML = "";
  const g = novoGrafico(el);
  let tipoGraf = "velas", periodo = "6M", serie = null, media = null;
  const desenhar = () => {
    if (serie) g.removeSeries(serie);
    if (media) g.removeSeries(media);
    const dados = velas.slice(-PERIODOS[periodo]);
    if (tipoGraf === "velas") {
      serie = g.addCandlestickSeries({ upColor: COR.alta, downColor: COR.baixa, borderVisible: false, wickUpColor: COR.alta, wickDownColor: COR.baixa, priceLineVisible: false });
      serie.setData(dados.map(([time, open, high, low, close]) => ({ time, open, high, low, close })));
    } else {
      serie = serieArea(g);
      serie.setData(dados.map((v) => ({ time: v[0], value: v[4] })));
    }
    const ini = velas.length - dados.length;
    media = g.addLineSeries({ color: "rgba(255,193,92,.75)", lineWidth: 1.5, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    media.setData(dados.map((v, i) => {
      const j = ini + i; if (j < 19) return null;
      return { time: v[0], value: velas.slice(j - 19, j + 1).reduce((s, x) => s + x[4], 0) / 20 };
    }).filter(Boolean));
    g.timeScale().fitContent();
  };
  desenhar();
  ligarPilulas($("#acao-hero"), (p) => { periodo = p; desenhar(); });
  $$("[data-tipo]").forEach((b) => b.onclick = () => { $$("[data-tipo]").forEach((x) => x.classList.toggle("ativo", x === b)); tipoGraf = b.dataset.tipo; desenhar(); });
}

// ---------- Watchlist ----------
function telaWatchlist() {
  const w = estado.resultado.watchlist;
  const alvo = (p) => {
    if (p.preco == null) return "";
    const partes = [];
    if (p.abaixo_de) {
      const falta = (p.preco / p.abaixo_de - 1) * 100;
      partes.push(falta <= 0 ? `<span class="chip laranja"><i class="ti ti-bell-ringing"></i>Abaixo de ${reais(p.abaixo_de)}</span>`
        : `<div><div class="apagado" style="margin-bottom:6px">Alerta abaixo de ${reais(p.abaixo_de)} · faltam ${num(falta, 1)}%</div><div class="barra-alerta"><span style="width:${Math.max(4, 100 - falta * 5)}%"></span></div></div>`);
    }
    if (p.acima_de) {
      const falta = (p.acima_de / p.preco - 1) * 100;
      partes.push(falta <= 0 ? `<span class="chip laranja"><i class="ti ti-bell-ringing"></i>Acima de ${reais(p.acima_de)}</span>`
        : `<div><div class="apagado" style="margin-bottom:6px">Alerta acima de ${reais(p.acima_de)} · faltam ${num(falta, 1)}%</div><div class="barra-alerta"><span style="width:${Math.max(4, 100 - falta * 5)}%"></span></div></div>`);
    }
    return partes.join("");
  };
  conteudo.innerHTML = `
    <div class="aviso"><i class="ti ti-pencil"></i><div>Para adicionar ações ou mudar os alertas de preço, edite a <code>watchlist</code> no
      <a href="https://github.com/${RADAR.repo}/edit/main/config.yaml" target="_blank" rel="noopener">config.yaml</a>. A próxima atualização já usa a lista nova.</div></div>
    <div class="grade-cards">${w.map((p) => {
      const u = estado.universo[p.papel] || {};
      return `<a class="card card-acao" href="#acao/${esc(p.papel)}">
        <div class="topo">${logo(p.papel)}<div><b>${esc(p.papel)}</b><div class="apagado">${p.queda_52s == null ? "" : num(p.queda_52s, 0) + "% abaixo da máx."}</div></div>
          <div class="preco">${reais(p.preco)}${variacao(p.var_dia)}</div></div>
        ${spark(u.spark)}${alvo(p)}</a>`;
    }).join("")}</div>`;
}

// ---------- Alertas e notificações ----------
function eventos(registros) {
  const lista = [];
  for (const r of registros) {
    let grupo = "";
    for (const l of r.linhas) {
      const m = l.match(/^\[(.+)\]$/);
      if (m) { grupo = m[1]; continue; }
      if (l.startsWith("+ ")) {
        const [, p, resto] = l.match(/^\+ (\S+) (.*)$/) || [];
        lista.push({ em: r.em, tipo: "alta", icone: "ti-plus", titulo: `${p} entrou em ${grupo}`, texto: resto, papel: p });
      } else if (l.startsWith("- ")) {
        const [, p, resto] = l.match(/^- (\S+) saiu: (.*)$/) || [];
        lista.push({ em: r.em, tipo: "baixa", icone: "ti-minus", titulo: `${p} saiu de ${grupo}`, texto: resto, papel: p });
      } else {
        const p = l.match(/^([A-Z]{4}\d{1,2})\b/)?.[1];
        lista.push({ em: r.em, tipo: "info", icone: p ? "ti-bell-ringing" : "ti-info-circle", titulo: p ? `Alerta de preço: ${p}` : "Radar", texto: l, papel: p });
      }
    }
  }
  return lista;
}

function eventoHTML(e) {
  const corpo = `<span class="marcador ${e.tipo}"><i class="ti ${e.icone}"></i></span><div><b>${esc(e.titulo)}</b><p>${esc(e.texto)}</p></div>`;
  return e.papel ? `<a class="evento" href="#acao/${esc(e.papel)}">${corpo}</a>` : `<div class="evento">${corpo}</div>`;
}

function avisoPush() {
  const p = estado.resultado.push || {};
  if (p.expiradas > 0) return `<div class="aviso"><i class="ti ti-bell-off"></i><div>Notificações desativadas em ${p.expiradas} aparelho(s). <a href="#alertas">Reativar</a></div></div>`;
  if (!p.configurado) return `<div class="aviso"><i class="ti ti-bell-plus"></i><div>Receba os alertas como notificação no celular. <a href="#alertas">Ativar agora</a></div></div>`;
  return "";
}

function montarMiniPush() {
  const p = estado.resultado.push || {};
  $("#lateral-push").innerHTML = p.configurado
    ? `<div class="mini-push"><i class="ti ti-bell-check"></i><div><b>Notificações ativas</b>${p.inscricoes} aparelho(s)</div></div>`
    : `<a class="mini-push" href="#alertas"><i class="ti ti-bell-plus"></i><div><b>Ativar notificações</b>Receba os alertas no celular</div></a>`;
}

function telaAlertas() {
  const regs = estado.historico;
  conteudo.innerHTML = `
    <div class="grade-inicio">
      <section class="card">
        <div class="card-cabeca"><h2>Histórico</h2><span class="apagado" style="margin-left:auto">${regs.length} atualizações com mudança</span></div>
        <div class="linha-tempo">${regs.map((r) => `<div class="grupo-alerta"><div class="quando">${dataHora(r.em)}</div>
          <div class="linha-tempo">${eventos([r]).map(eventoHTML).join("")}</div></div>`).join("") || '<div class="vazio">Nenhum alerta ainda.</div>'}</div>
      </section>
      <section class="card card-destaque push-card" id="push"></section>
    </div>`;
  montarPush();
}

const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalado = matchMedia("(display-mode: standalone)").matches || navigator.standalone;

function chaveParaBytes(b64) {
  const s = atob((b64 + "=".repeat((4 - b64.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function montarPush() {
  const box = $("#push");
  const titulo = `<div class="estado"><span class="estrategia"><span class="icone"><i class="ti ti-bell-ringing"></i></span></span>Notificações</div>`;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    box.innerHTML = titulo + (ehIOS && !instalado
      ? `<p class="sutil">No iPhone, primeiro adicione o app à tela inicial: toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>. Depois abra pelo ícone e volte aqui.</p>`
      : `<p class="sutil">Este navegador não suporta notificações push.</p>`);
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const atual = await reg.pushManager.getSubscription();
  box.innerHTML = `${titulo}
    <p class="sutil" style="margin:0">${atual ? "Este aparelho já está inscrito." : "Receba um aviso no celular sempre que uma ação entrar ou sair das suas estratégias, ou cruzar um preço da watchlist."}</p>
    <button class="botao primario" id="ativar" type="button"><i class="ti ti-bell-plus"></i>${atual ? "Mostrar código de novo" : "Ativar notificações"}</button>
    <div id="codigo"></div>`;
  $("#ativar").onclick = async () => {
    try {
      if ((await Notification.requestPermission()) !== "granted") throw new Error("permissão negada nas configurações do navegador.");
      const insc = atual || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(RADAR.vapidPublica) });
      mostrarCodigo(JSON.stringify(insc));
    } catch (erro) {
      $("#codigo").innerHTML = `<div class="aviso"><i class="ti ti-alert-triangle"></i><div>Não foi possível ativar: ${esc(erro.message)}</div></div>`;
    }
  };
}

function mostrarCodigo(json) {
  const url = `https://github.com/${RADAR.repo}/settings/secrets/actions`;
  $("#codigo").innerHTML = `
    <p class="sutil">Último passo (uma vez por aparelho): o Radar precisa deste código para saber para onde enviar.</p>
    <textarea class="codigo" readonly>${esc(json)}</textarea>
    <button class="botao" id="copiar" type="button" style="margin:10px 0"><i class="ti ti-copy"></i>Copiar código</button>
    <ol class="passos">
      <li>Abra <a href="${url}" target="_blank" rel="noopener">as Secrets do repositório</a>.</li>
      <li>Crie (ou edite) o secret <b>PUSH_SUBSCRIPTIONS</b> e cole o código.</li>
      <li>Vários aparelhos: um código por linha no mesmo secret.</li>
    </ol>`;
  $("#copiar").onclick = async () => {
    await navigator.clipboard.writeText(json);
    $("#copiar").innerHTML = `<i class="ti ti-check"></i>Copiado!`;
  };
}

// ---------- Busca rápida (Ctrl K) ----------
let selBusca = 0;
function abrirBusca() {
  $("#paleta").hidden = false;
  const inp = $("#paleta-input");
  inp.value = "";
  filtrarBusca();
  inp.focus();
}
function fecharBusca() { $("#paleta").hidden = true; }
function filtrarBusca() {
  const q = $("#paleta-input").value.trim().toUpperCase();
  const todos = Object.keys(estado.universo).sort();
  const res = (q ? todos.filter((p) => p.includes(q)).sort((a, b) => b.startsWith(q) - a.startsWith(q)) : estado.resultado.watchlist.map((w) => w.papel)).slice(0, 8);
  selBusca = 0;
  $("#paleta-lista").innerHTML = res.map((p, i) => {
    const u = estado.universo[p] || {};
    return `<a href="#acao/${esc(p)}" class="${i ? "" : "sel"}">${logo(p, "p")}<b>${esc(p)}</b><span class="preco">${reais(precoDe(p))} ${variacao(u.var_dia)}</span></a>`;
  }).join("") || `<div class="vazio">Nenhuma ação com "${esc(q)}".</div>`;
}
$("#abrir-busca").onclick = abrirBusca;
$("#paleta").onclick = (ev) => { if (ev.target.id === "paleta" || ev.target.closest("a")) fecharBusca(); };
$("#paleta-input").oninput = filtrarBusca;
$("#paleta-input").onkeydown = (ev) => {
  const itens = $$("#paleta-lista a");
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    selBusca = (selBusca + (ev.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
    itens.forEach((a, i) => a.classList.toggle("sel", i === selBusca));
  } else if (ev.key === "Enter" && itens[selBusca]) {
    location.hash = itens[selBusca].getAttribute("href");
    fecharBusca();
  }
};
document.addEventListener("keydown", (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); abrirBusca(); }
  if (ev.key === "Escape") fecharBusca();
});

// ---------- Inicialização ----------
window.addEventListener("hashchange", rotear);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
conteudo.innerHTML = `<div class="grade-inicio"><div class="esqueleto" style="height:380px"></div><div class="esqueleto" style="height:380px"></div></div><div class="esqueleto"></div>`;
carregar();
// Recarrega os dados quando o app volta para a frente (ex.: ao abrir pelo ícone).
document.addEventListener("visibilitychange", () => { if (!document.hidden && estado.resultado) carregar(); });
