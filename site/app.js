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
  rotear();
}

function rotear() {
  if (!estado.resultado) return;
  const [aba, arg] = (location.hash.slice(1) || "inicio").split("/");
  const telas = { inicio: telaInicio, estrategias: telaEstrategias, acao: telaAcao, watchlist: telaWatchlist, alertas: telaAlertas };
  const nome = telas[aba] ? aba : "inicio";
  $$("#menu a").forEach((a) => a.classList.toggle("ativa", a.dataset.aba === nome));
  estado.graficos.forEach((g) => g.remove());
  estado.graficos = [];
  telas[nome](arg && decodeURIComponent(arg));
  ligarLinhas();
  window.scrollTo({ top: 0 });
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
      <span class="carimbo"><i class="ti ti-clock" style="font-size:14px"></i>Atualizado ${quando(r.gerado_em)}</span>
      <button class="busca" type="button" data-busca><i class="ti ti-search" style="font-size:16px"></i>Buscar ação<kbd>Ctrl K</kbd></button>
    </div></header>`;
}

// ---------- Gráficos ----------
function grafico(el) {
  const g = LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: "#8a8c92", fontFamily: "IBM Plex Mono, monospace", fontSize: 11 },
    grid: { vertLines: { visible: false }, horzLines: { color: "#232327" } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: .12, bottom: .08 } },
    timeScale: { borderVisible: false },
    crosshair: { mode: 0, vertLine: { color: "#55555b", style: 2, labelBackgroundColor: "#ff8a1f" }, horzLine: { color: "#55555b", style: 2, labelBackgroundColor: "#ff8a1f" } },
    handleScroll: false, handleScale: false,
    localization: { locale: "pt-BR", priceFormatter: (p) => num(p, p >= 1000 ? 0 : 2) },
  });
  estado.graficos.push(g);
  return g;
}
const area = (g) => g.addAreaSeries({ lineColor: "#ff8a1f", lineWidth: 2, topColor: "rgba(255,138,31,.16)", bottomColor: "rgba(255,138,31,0)", priceLineVisible: false, crosshairMarkerBackgroundColor: "#ffb547" });
const abasPeriodo = (ativo) => `<div class="abas" role="tablist">${Object.keys(PERIODOS).map((p) => `<button type="button" data-periodo="${p}" class="${p === ativo ? "ativo" : ""}">${p}</button>`).join("")}</div>`;
function ligarAbas(raiz, attr, fn) {
  $$(`[data-${attr}]`, raiz).forEach((b) => b.onclick = () => {
    $$(`[data-${attr}]`, raiz).forEach((x) => x.classList.toggle("ativo", x === b));
    fn(b.dataset[attr]);
  });
}

// ---------- Visão geral ----------
function telaInicio() {
  const r = estado.resultado, ib = r.mercado?.ibovespa, us = r.mercado?.dolar;
  const evs = eventos(estado.historico.slice(0, 1));
  const n = evs.filter((e) => e.tipo !== "info").length;
  const ests = Object.entries(r.estrategias);
  const movers = Object.entries(estado.universo).filter(([, u]) => u.var_dia != null);
  tela.innerHTML = `
    ${cabecalho("Visão geral", `Ibovespa <b class="num">${num(ib?.valor, 0)}</b> pontos, <b class="${cls(ib?.var_dia)}">${sinal(ib?.var_dia)}</b> hoje.
      ${estado.historico.length ? `${n ? `<b>${n} mudança${n > 1 ? "s" : ""}</b> nas suas estratégias` : "Nenhuma mudança nas suas estratégias"} na última atualização com novidades (${quando(estado.historico[0].em)}).` : ""}`)}
    ${avisoPush()}
    <section class="painel s8" id="p-ibov">
      <div class="cabeca-grafico">
        <div><div class="faint">Ibovespa</div><div class="figura">${num(ib?.valor, 0)}<small>pts</small></div><div class="delta" id="ibov-per"></div></div>
        ${abasPeriodo("6M")}
      </div>
      <div class="grafico" id="g-ibov"></div>
    </section>
    <section class="painel s4">
      <div class="kpis">
        <div><div class="faint">Dólar ${us?.fonte === "PTAX/BC" ? "(PTAX)" : "comercial"}</div><div class="num" style="font-size:20px;line-height:28px;font-weight:500">${reais(us?.valor, 3)}</div><div class="delta ${cls(us?.var_dia)}">${sinal(us?.var_dia)} <span class="faint">hoje</span></div></div>
        <div><div class="faint">Ações acompanhadas</div><div class="num" style="font-size:20px;line-height:28px;font-weight:500">${r.papeis_liquidos}</div><div class="faint">de ${r.total_papeis} na B3</div></div>
      </div>
      <div class="painel-cabeca"><h2>Últimas mudanças</h2><a class="ver-todos" href="#alertas">Histórico<i class="ti ti-chevron-right"></i></a></div>
      ${eventos(estado.historico.slice(0, 3)).slice(0, 6).map(mudancaHTML).join("") || '<div class="vazio">Nenhuma mudança registrada ainda.</div>'}
    </section>
    <section class="painel estrategias">${ests.map(([k, e]) => `
      <a class="est-col" href="#estrategias/${k}">
        <h3>${esc(e.nome)}</h3>
        <div class="linha-num"><span class="figura" style="font-size:24px;line-height:30px">${e.papeis.length}</span><span class="faint">ações cumprem hoje</span></div>
        <p class="descricao">${esc(e.descricao)}</p>
        <div class="papeis">${e.papeis.slice(0, 8).map((p) => `<span>${esc(p.papel)}</span>`).join("")}${e.papeis.length > 8 ? `<span>+${e.papeis.length - 8}</span>` : ""}</div>
      </a>`).join("")}
    </section>
    <section class="painel s7">
      <div class="painel-cabeca"><h2>Em movimento hoje</h2>
        <div class="abas" style="margin-left:auto"><button type="button" data-mov="alta" class="ativo">Maiores altas</button><button type="button" data-mov="baixa">Maiores baixas</button></div></div>
      <div class="rolagem"><table><thead><tr><th>Ação</th><th class="n">Preço</th><th class="n">Hoje</th><th class="n esconde-celular">30 dias</th></tr></thead><tbody id="t-mov"></tbody></table></div>
    </section>
    <section class="painel s5">
      <div class="painel-cabeca"><h2>Watchlist</h2><a class="ver-todos" href="#watchlist">Alertas de preço<i class="ti ti-chevron-right"></i></a></div>
      <div class="rolagem"><table><thead><tr><th>Ação</th><th class="n">Preço</th><th class="n">Hoje</th></tr></thead><tbody>
        ${r.watchlist.slice(0, 5).map((w) => `<tr data-href="#acao/${esc(w.papel)}"><td>${ativoCel(w.papel)}</td><td class="n">${num(w.preco)}</td><td class="n">${varCel(w.var_dia)}</td></tr>`).join("")}
      </tbody></table></div>
    </section>
    ${rodape()}`;

  const mov = (lado) => {
    const lista = [...movers].sort((a, b) => lado === "alta" ? b[1].var_dia - a[1].var_dia : a[1].var_dia - b[1].var_dia).slice(0, 5);
    $("#t-mov").innerHTML = lista.map(([p, u]) => `<tr data-href="#acao/${esc(p)}"><td>${ativoCel(p)}</td><td class="n">${num(precoDe(p))}</td><td class="n">${varCel(u.var_dia)}</td><td class="n esconde-celular">${varCel(u.var_30d, 1)}</td></tr>`).join("");
    ligarLinhas();
  };
  mov("alta");
  ligarAbas(tela, "mov", mov);

  if (ib?.serie && window.LightweightCharts) {
    const g = grafico($("#g-ibov")), s = area(g);
    const aplicar = (per) => {
      const d = ib.serie.slice(-PERIODOS[per]);
      s.setData(d.map(([time, value]) => ({ time, value })));
      s.setMarkers(eventoMaior(d));
      g.timeScale().fitContent();
      const v = dif(d.at(-1)[1], d[0][1]);
      $("#ibov-per").innerHTML = `<span class="${cls(v)}">${sinal(v, 1)}</span> <span class="faint">em ${per === "1A" ? "12 meses" : per.replace("M", " meses").replace("1 meses", "1 mês")}</span>`;
    };
    aplicar("6M");
    ligarAbas($("#p-ibov"), "periodo", aplicar);
  }
}

// Anota o maior movimento do período quando ele é bem maior que o normal (regra da skill: explicar o salto).
function eventoMaior(d) {
  const mov = d.slice(1).map((v, i) => [v[0], (v[1] / d[i][1] - 1) * 100]);
  if (mov.length < 10) return [];
  const tipico = mov.reduce((s, m) => s + Math.abs(m[1]), 0) / mov.length;
  const [data, v] = mov.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
  if (Math.abs(v) < tipico * 3) return [];
  const [, mes, dia] = data.split("-");
  return [{ time: data, position: v < 0 ? "aboveBar" : "belowBar", color: v < 0 ? "#e5566f" : "#44a282", shape: v < 0 ? "arrowDown" : "arrowUp", text: `${sinal(v, 1)} em ${dia}/${mes}` }];
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
      </tr>`).join("")}</tbody></table></div>` : '<div class="vazio">Nenhuma ação cumpre todos os critérios agora.</div>'}`;
  $$("[data-ord]").forEach((th) => th.onclick = () => {
    const c = th.dataset.ord;
    estado.ordem = { campo: c, desc: o.campo === c ? !o.desc : c !== "papel" };
    desenharEstrategia();
  });
  ligarLinhas();
}

// ---------- Ação ----------
async function telaAcao(arg) {
  const papel = (arg || estado.resultado.watchlist[0]?.papel || "PETR4").toUpperCase();
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
    <section class="painel">
      <div class="cabeca-grafico" style="align-items:flex-start">
        <div><div class="figura">${reais(preco)}</div><div class="delta">${varCel(u.var_dia)} <span class="faint">hoje</span> · ${varCel(u.var_30d, 1)} <span class="faint">em 30 dias</span> · ${varCel(u.var_1a, 1)} <span class="faint">em 12 meses</span></div></div>
        <p class="muted" style="max-width:520px;margin-left:auto;font-size:14px;line-height:21px">${achado.length ? `O preço de hoje está ${achado.join(" e ")}.` : "Sem lucro, dividendos ou cobertura de analistas suficientes para estimar um preço justo."}
          ${u.faixa_1m ? ` Pela oscilação recente, em 2 de cada 3 meses o preço termina entre <b class="num" style="color:var(--text)">${reais(u.faixa_1m[0])}</b> e <b class="num" style="color:var(--text)">${reais(u.faixa_1m[1])}</b>.` : ""}</p>
      </div>
      <h2 style="font-size:16px;font-weight:600;margin-top:22px">Régua de preço</h2>
      <p class="faint" style="margin-top:2px">Do mais barato (âmbar) ao mais caro (vermelho), dentro dos valores calculados para ${esc(papel)}.</p>
      ${regua(u, preco)}
      ${tabelaRegua(u, preco, temAnalistas)}
    </section>

    <section class="painel s8 coluna-flex" id="p-graf">
      <div class="painel-cabeca"><h2>Cotação</h2>
        <div class="abas" style="margin-left:auto"><button type="button" data-tipo="velas" class="ativo">Velas</button><button type="button" data-tipo="linha">Linha</button></div>
        ${abasPeriodo("6M")}</div>
      <div class="grafico alto" id="g-acao"><div class="carregando"></div></div>
      <p class="faint">A linha tracejada é a média dos últimos 20 pregões.</p>
    </section>
    <section class="painel s4 leitura">
      <div class="painel-cabeca"><h2>Leitura do Radar</h2></div>
      <div class="placar"><div><b class="pos">${u.a_favor?.length ?? 0}</b>a favor</div><div><b class="${u.atencao?.length ? "neg" : ""}">${u.atencao?.length ?? 0}</b>pedem atenção</div></div>
      ${(u.a_favor || []).map((s) => `<div class="sinal-item"><i class="ti ti-check pos"></i><div><b>${esc(s.t)}</b><p>${esc(s.d)}</p></div></div>`).join("")}
      ${(u.atencao || []).map((s) => `<div class="sinal-item"><i class="ti ti-alert-triangle neg"></i><div><b>${esc(s.t)}</b><p>${esc(s.d)}</p></div></div>`).join("")}
      ${!u.a_favor && !u.atencao ? '<div class="vazio">Sem dados de preço suficientes para a leitura.</div>' : ""}
      <p class="faint" style="margin-top:12px">Sinais calculados com regras fixas, explicadas ao lado. Não dizem o que fazer: ajudam a entender a ação.</p>
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

    <section class="painel">
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
    <div class="marco hoje" style="left:${xh}%;top:0"><div class="rot">Hoje<b>${num(preco)}</b></div><div class="haste" style="height:16px"></div></div>
    <div class="regua-trilha">
      ${u.faixa_1m ? `<div class="regua-faixa" style="left:${x(u.faixa_1m[0])}%;width:${x(u.faixa_1m[1]) - x(u.faixa_1m[0])}%" title="Faixa provável em 1 mês"></div>` : ""}
      ${temA && u.alvo_min && u.alvo_max ? `<div class="regua-alvo" style="left:${x(u.alvo_min)}%;width:${Math.max(0.5, x(u.alvo_max) - x(u.alvo_min))}%" title="Alvos dos analistas, do menor ao maior"></div>` : ""}
    </div>
    ${posicionados.map((g) => `<div class="marco ${g.sec ? "secundario" : ""}" style="left:${g.x}%;top:56px"><div class="haste" style="height:${8 + g.pista * 44}px"></div>
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
  itens.push(`<div class="conta-item"><b>Leitura do Radar</b><p>Conta sinais com regras fixas: preço abaixo de Graham (10% ou mais) ou de Bazin, ROE acima de 15%, dívida até 0,5× o patrimônio e alvo dos analistas 10% acima contam a favor. Prejuízo, ROE abaixo de 8%, dívida acima de 2×, queda de 15% no mês ou alvo abaixo do preço pedem atenção.</p></div>`);
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
  let tipo = "velas", periodo = "6M", serie, media;
  const desenhar = () => {
    if (serie) g.removeSeries(serie);
    if (media) g.removeSeries(media);
    const d = velas.slice(-PERIODOS[periodo]), ini = velas.length - d.length;
    if (tipo === "velas") {
      serie = g.addCandlestickSeries({ upColor: "#44a282", downColor: "#e5566f", borderVisible: false, wickUpColor: "#44a282", wickDownColor: "#e5566f", priceLineVisible: false });
      serie.setData(d.map(([time, open, high, low, close]) => ({ time, open, high, low, close })));
    } else {
      serie = area(g);
      serie.setData(d.map((v) => ({ time: v[0], value: v[4] })));
    }
    media = g.addLineSeries({ color: "#ffb547", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    media.setData(d.map((v, i) => { const j = ini + i; return j < 19 ? null : { time: v[0], value: velas.slice(j - 19, j + 1).reduce((s, x) => s + x[4], 0) / 20 }; }).filter(Boolean));
    g.timeScale().fitContent();
  };
  desenhar();
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
  const corpo = `<span class="sinal ${e.tipo === "info" ? "" : e.tipo}" style="${e.tipo === "info" ? "color:var(--ambar)" : ""}">${e.s}</span><div><b>${esc(e.t)}</b><p>${esc(e.d)}</p></div><span class="quando">${quando(e.em).split(",")[0]}</span>`;
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
document.addEventListener("click", (e) => { if (e.target.closest("[data-busca], #abrir-busca-trilho")) abrirBusca(); });
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

// ---------- Início ----------
window.addEventListener("hashchange", rotear);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
tela.innerHTML = `<header class="titulo"><div><h1>Radar B3</h1><div class="carregando" style="width:320px"></div></div></header><section class="painel s8"><div class="carregando"></div><div class="carregando" style="width:40%"></div></section><section class="painel s4"><div class="carregando"></div></section>`;
carregar();
document.addEventListener("visibilitychange", () => { if (!document.hidden && estado.resultado) carregar(); });
