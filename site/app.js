// Radar B3: app estático que lê os JSON gerados pelo scan.py.
const $ = (sel) => document.querySelector(sel);
const conteudo = $("#conteudo");
const estado = { resultado: null, historico: [], universo: {}, estrategia: null };

const ROTULOS = {
  pl: ["P/L", false], pvp: ["P/VP", false], psr: ["PSR", false], dy: ["DY", true],
  ev_ebitda: ["EV/EBITDA", false], mrg_liq: ["Margem líquida", true], roic: ["ROIC", true],
  roe: ["ROE", true], liq_corr: ["Liquidez corrente", false], div_liq_patrim: ["Dív. líq./Patrim.", false],
  cresc_rec_5a: ["Cresc. receita 5a", true], queda_52s: ["Abaixo da máx. 52s", true],
  var_dia: ["Var. dia", true], var_30d: ["Var. 30d", true], var_1a: ["Var. 1 ano", true],
};
const NAO_SE_APLICA_FIN = new Set(["div_liq_patrim", "liq_corr", "roic", "ev_ebitda"]);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, casas = 2) => (v == null || Number.isNaN(v) ? "—" :
  v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }));
const pct = (v, casas = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${num(v, casas)}%`);
const cor = (v) => (v == null ? "" : v >= 0 ? "alta" : "baixa");
const reais = (v) => (v == null ? "—" : `R$ ${num(v)}`);

async function carregarJSON(caminho) {
  const resp = await fetch(caminho, { cache: "no-store" });
  if (!resp.ok) throw new Error(`${caminho}: ${resp.status}`);
  return resp.json();
}

async function carregar() {
  try {
    [estado.resultado, estado.historico, estado.universo] = await Promise.all([
      carregarJSON("dados/resultado.json"), carregarJSON("dados/historico.json"), carregarJSON("dados/universo.json"),
    ]);
  } catch (erro) {
    conteudo.innerHTML = `<div class="aviso">Ainda não há dados publicados. Rode <code>scan.py</code> ou aguarde a próxima atualização.</div>`;
    return;
  }
  const r = estado.resultado;
  estado.estrategia ??= Object.keys(r.estrategias)[0];
  $("#atualizado").textContent = `Atualizado ${new Date(r.gerado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`;
  rotear();
}

function rotear() {
  if (!estado.resultado) return;
  const [aba, arg] = (location.hash.slice(1) || "inicio").split("/");
  document.querySelectorAll("#abas a").forEach((a) => a.classList.toggle("ativa", a.dataset.aba === aba));
  const telas = { inicio: telaInicio, estrategias: telaEstrategias, acao: telaAcao, watchlist: telaWatchlist, alertas: telaAlertas };
  (telas[aba] || telaInicio)(arg);
  window.scrollTo(0, 0);
}

// ---------- Início ----------
function avisoPush() {
  const p = estado.resultado.push || {};
  if (p.expiradas > 0) return `<div class="aviso">Notificações desativadas em ${p.expiradas} aparelho(s). <a href="#alertas">Toque para reativar</a>.</div>`;
  if (!p.configurado) return `<div class="aviso">Notificações ainda não ativadas. <a href="#alertas">Ativar</a>.</div>`;
  return "";
}

function telaInicio() {
  const r = estado.resultado, m = r.mercado || {};
  const cartao = (rot, valor, delta) => `<div class="cartao"><div class="rotulo">${rot}</div><div class="valor">${valor}</div>
    ${delta == null ? "" : `<div class="delta ${cor(delta)}">${pct(delta, 2)} no dia</div>`}</div>`;
  const ultimo = estado.historico[0];
  conteudo.innerHTML = `
    ${avisoPush()}
    <div class="cartoes">
      ${m.ibovespa ? cartao("Ibovespa", num(m.ibovespa.valor, 0), m.ibovespa.var_dia) : ""}
      ${m.dolar ? cartao(m.dolar.fonte === "PTAX/BC" ? "Dólar (PTAX)" : "Dólar", `R$ ${num(m.dolar.valor, 3)}`, m.dolar.var_dia) : ""}
      ${Object.values(r.estrategias).map((e) => cartao(e.nome, e.papeis.length)).join("")}
    </div>
    <h2>Último alerta</h2>
    ${ultimo ? alertaHTML(ultimo) : `<p class="sutil">Nenhum alerta ainda.</p>`}
    <p class="sutil">${r.papeis_liquidos} papéis com liquidez de ${r.total_papeis} na B3.</p>`;
}

// ---------- Estratégias ----------
function itemPapel(p) {
  return `<a class="item" href="#acao/${esc(p.papel)}">
    <span><span class="papel">${esc(p.papel)}</span>${p.financeira ? '<span class="etiqueta">financeira</span>' : ""}</span>
    <span class="preco">${reais(p.preco)} <span class="${cor(p.var_dia)}">${pct(p.var_dia)}</span></span>
    <span class="motivos">${esc((p.motivos || []).join(" · "))}</span></a>`;
}

function textoCriterios(lista) {
  return (lista || []).map((c) => {
    const [rot] = ROTULOS[c.campo] || [c.campo];
    const faixa = [c.min != null ? `≥ ${num(c.min, 1)}` : "", c.max != null ? `≤ ${num(c.max, 1)}` : ""].filter(Boolean).join(" e ");
    return `${rot} ${faixa}`;
  }).join(" · ");
}

function telaEstrategias() {
  const ests = estado.resultado.estrategias, e = ests[estado.estrategia];
  conteudo.innerHTML = `
    <div class="segmentos">${Object.entries(ests).map(([k, v]) =>
      `<button data-est="${k}" class="${k === estado.estrategia ? "ativo" : ""}">${esc(v.nome)} (${v.papeis.length})</button>`).join("")}</div>
    <p>${esc(e.descricao)}</p>
    <p class="sutil">Critérios: ${esc(textoCriterios(e.criterios))}
      ${e.criterios_financeiras ? `<br>Bancos e seguradoras: ${esc(textoCriterios(e.criterios_financeiras))}` : "<br>Bancos e seguradoras não entram nesta estratégia."}</p>
    <div class="lista">${e.papeis.map(itemPapel).join("") || '<p class="sutil">Nenhum papel cumpre os critérios agora.</p>'}</div>`;
  conteudo.querySelectorAll("[data-est]").forEach((b) => b.onclick = () => { estado.estrategia = b.dataset.est; telaEstrategias(); });
}

// ---------- Ação ----------
async function telaAcao(papel) {
  const papeis = Object.keys(estado.universo).sort();
  papel = (papel || "PETR4").toUpperCase();
  conteudo.innerHTML = `
    <input class="busca" id="busca" list="papeis" placeholder="Digite o código (ex.: PETR4)" value="${esc(papel)}">
    <datalist id="papeis">${papeis.map((p) => `<option value="${p}">`).join("")}</datalist>
    <div id="detalhe"></div>`;
  $("#busca").onchange = (ev) => { location.hash = `acao/${ev.target.value.trim().toUpperCase()}`; };

  const u = estado.universo[papel];
  const detalhe = $("#detalhe");
  if (!u) { detalhe.innerHTML = `<p class="sutil">Papel não encontrado entre os ${papeis.length} com liquidez.</p>`; return; }

  const em = Object.values(estado.resultado.estrategias).filter((e) => e.papeis.some((p) => p.papel === papel)).map((e) => e.nome);
  const ind = ["pl", "pvp", "dy", "roe", "roic", "mrg_liq", "div_liq_patrim", "ev_ebitda", "cresc_rec_5a", "liq_corr"];
  detalhe.innerHTML = `
    <h2>${esc(papel)}${u.financeira ? ' <span class="etiqueta">financeira</span>' : ""}</h2>
    <div class="cartoes">
      <div class="cartao"><div class="rotulo">Preço</div><div class="valor">${reais(u.preco ?? u.cotacao)}</div>
        <div class="delta ${cor(u.var_dia)}">${pct(u.var_dia, 2)} no dia</div></div>
      <div class="cartao"><div class="rotulo">30 dias</div><div class="valor ${cor(u.var_30d)}">${pct(u.var_30d)}</div></div>
      <div class="cartao"><div class="rotulo">12 meses</div><div class="valor ${cor(u.var_1a)}">${pct(u.var_1a)}</div></div>
      <div class="cartao"><div class="rotulo">Abaixo da máx. 52s</div><div class="valor">${u.queda_52s == null ? "—" : num(u.queda_52s, 1) + "%"}</div></div>
    </div>
    <div id="grafico"></div>
    <div class="cartoes">${ind.map((c) => {
      const [rot, ehPct] = ROTULOS[c];
      const v = u.financeira && NAO_SE_APLICA_FIN.has(c) ? "n/a" : u[c] == null ? "—" : num(u[c], ehPct ? 1 : 2) + (ehPct ? "%" : "");
      return `<div class="cartao"><div class="rotulo">${rot}</div><div class="valor">${v}</div></div>`;
    }).join("")}</div>
    <p class="sutil">Volume médio diário (2 meses): R$ ${num(u.liq_2meses, 0)}${u.financeira ? " · n/a = indicador não se aplica a bancos e seguradoras" : ""}</p>
    <p><strong>Aparece em:</strong> ${em.length ? esc(em.join(", ")) : "nenhuma estratégia no momento"}</p>`;
  desenharGrafico(papel);
}

async function desenharGrafico(papel) {
  const el = $("#grafico");
  let velas;
  try { velas = await carregarJSON(`dados/precos/${papel}.json`); }
  catch { el.outerHTML = `<p class="sutil">Gráfico disponível só para papéis das estratégias e da watchlist.</p>`; return; }
  if (!window.LightweightCharts) { el.innerHTML = `<p class="sutil">Biblioteca de gráficos não carregou (sem internet?).</p>`; return; }
  const chart = LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: "#8b96a5" },
    grid: { vertLines: { color: "#1c2430" }, horzLines: { color: "#1c2430" } },
    rightPriceScale: { borderColor: "#263040" }, timeScale: { borderColor: "#263040" },
    localization: { locale: "pt-BR", priceFormatter: (p) => `R$ ${num(p)}` },
  });
  const serie = chart.addCandlestickSeries({ upColor: "#22c55e", downColor: "#ef4444", borderVisible: false,
                                             wickUpColor: "#22c55e", wickDownColor: "#ef4444" });
  serie.setData(velas.map(([time, open, high, low, close]) => ({ time, open, high, low, close })));
  const media = chart.addLineSeries({ color: "#60a5fa", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
  media.setData(velas.slice(49).map((v, i) => ({
    time: v[0], value: velas.slice(i, i + 50).reduce((s, x) => s + x[4], 0) / 50,
  })));
  chart.timeScale().fitContent();
}

// ---------- Watchlist ----------
function telaWatchlist() {
  const w = estado.resultado.watchlist;
  conteudo.innerHTML = `
    <p class="sutil">Edite a lista e os alertas de preço no arquivo <code>config.yaml</code> do repositório.</p>
    <div class="lista">${w.map((p) => `<a class="item" href="#acao/${esc(p.papel)}">
      <span class="papel">${esc(p.papel)}</span>
      <span class="preco">${reais(p.preco)} <span class="${cor(p.var_dia)}">${pct(p.var_dia)}</span></span>
      <span class="motivos">30d ${pct(p.var_30d)} · ${p.queda_52s == null ? "" : num(p.queda_52s, 0) + "% abaixo da máx. 52s"}
        ${p.abaixo_de ? ` · alerta abaixo de ${reais(p.abaixo_de)}` : ""}${p.acima_de ? ` · alerta acima de ${reais(p.acima_de)}` : ""}</span>
    </a>`).join("")}</div>`;
}

// ---------- Alertas e notificações ----------
function alertaHTML(a) {
  const quando = new Date(a.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  return `<div class="alerta"><div class="sutil">${quando}</div>${esc(a.linhas.join("\n"))}</div>`;
}

function telaAlertas() {
  conteudo.innerHTML = `
    <h2>Notificações</h2>
    <div id="push"></div>
    <h2>Histórico</h2>
    ${estado.historico.map(alertaHTML).join("") || '<p class="sutil">Nenhum alerta ainda.</p>'}`;
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
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    box.innerHTML = ehIOS && !instalado
      ? `<div class="aviso">No iPhone, primeiro adicione o app à tela inicial: toque em <strong>Compartilhar</strong> → <strong>Adicionar à Tela de Início</strong>. Depois abra pelo ícone e volte aqui.</div>`
      : `<div class="aviso">Este navegador não suporta notificações push.</div>`;
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const atual = await reg.pushManager.getSubscription();
  box.innerHTML = `
    <p>${atual ? "Este aparelho já gerou uma inscrição." : "Ative para receber os alertas como notificação neste aparelho."}</p>
    <button class="botao primario" id="ativar">${atual ? "Mostrar código de novo" : "Ativar notificações"}</button>
    <div id="codigo"></div>`;
  $("#ativar").onclick = async () => {
    try {
      if ((await Notification.requestPermission()) !== "granted") throw new Error("Permissão negada nas configurações do navegador.");
      const insc = atual || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(RADAR.vapidPublica) });
      mostrarCodigo(JSON.stringify(insc));
    } catch (erro) {
      $("#codigo").innerHTML = `<div class="aviso">Não foi possível ativar: ${esc(erro.message)}</div>`;
    }
  };
}

function mostrarCodigo(json) {
  const url = `https://github.com/${RADAR.repo}/settings/secrets/actions`;
  $("#codigo").innerHTML = `
    <div class="aviso ok">Falta um passo (só uma vez por aparelho): o Radar precisa deste código para saber para onde enviar.</div>
    <textarea class="codigo" readonly id="txt">${esc(json)}</textarea>
    <p><button class="botao" id="copiar">Copiar código</button></p>
    <ol class="sutil">
      <li>Abra <a href="${url}" target="_blank" rel="noopener">as Secrets do repositório</a>.</li>
      <li>Crie (ou edite) o secret <strong>PUSH_SUBSCRIPTIONS</strong> e cole o código.</li>
      <li>Vários aparelhos: cole um código por linha no mesmo secret.</li>
    </ol>`;
  $("#copiar").onclick = async () => {
    await navigator.clipboard.writeText(json);
    $("#copiar").textContent = "Copiado!";
  };
}

// ---------- Inicialização ----------
window.addEventListener("hashchange", rotear);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
carregar();
// Recarrega os dados quando o app volta para a frente (ex.: ao abrir pelo ícone).
document.addEventListener("visibilitychange", () => { if (!document.hidden) carregar(); });
