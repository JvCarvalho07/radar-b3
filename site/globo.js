// O mundo hoje: globo em canvas (leve), centrado no Brasil, com as moedas contra o real ou as bolsas.
// Só redesenha quando algo muda (arrastar, zoom, passar o mouse, trocar o modo): nada gira sozinho.
const LIBS_GLOBO = [
  "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js",
  "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js",
];
const MAPA_MUNDO = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";
// Código numérico do mapa-múndi (ISO 3166) + sigla de 2 letras, de 5 em 5 caracteres. O nome em português
// do Brasil vem do próprio navegador (Intl.DisplayNames); o mapa traz os nomes em inglês.
const SIGLAS_PAISES = "004AF008AL010AQ012DZ024AO031AZ032AR036AU040AT044BS050BD051AM056BE064BT068BO070BA072BW076BR084BZ090SB096BN100BG104MM108BI112BY116KH120CM124CA140CF144LK148TD152CL156CN158TW170CO178CG180CD188CR191HR192CU196CY203CZ204BJ208DK214DO218EC222SV226GQ231ET232ER233EE238FK242FJ246FI250FR260TF262DJ266GA268GE270GM275PS276DE288GH300GR304GL320GT324GN328GY332HT340HN348HU352IS356IN360ID364IR368IQ372IE376IL380IT384CI388JM392JP398KZ400JO404KE408KP410KR414KW417KG418LA422LB426LS428LV430LR434LY440LT442LU450MG454MW458MY466ML478MR484MX496MN498MD499ME504MA508MZ512OM516NA524NP528NL540NC548VU554NZ558NI562NE566NG578NO586PK591PA598PG600PY604PE608PH616PL620PT624GW626TL630PR634QA642RO643RU646RW682SA686SN688RS694SL703SK704VN705SI706SO710ZA716ZW724ES728SS729SD732EH740SR748SZ752SE756CH760SY762TJ764TH768TG780TT784AE788TN792TR795TM800UG804UA807MK818EG826GB834TZ840US854BF858UY860UZ862VE887YE894ZM";
const NOMES_PT = (() => {
  try {
    const nome = new Intl.DisplayNames(["pt-BR"], { type: "region" }), m = {};
    for (let i = 0; i < SIGLAS_PAISES.length; i += 5) m[SIGLAS_PAISES.slice(i, i + 3)] = nome.of(SIGLAS_PAISES.slice(i + 3, i + 5));
    return m;
  } catch { return {}; }
})();
const SEM_CODIGO = { "N. Cyprus": "Chipre do Norte", Somaliland: "Somalilândia", Kosovo: "Kosovo" };
const nomePais = (f) => NOMES_PT[f.id] || SEM_CODIGO[f.properties.name] || f.properties.name;
const LEGENDAS = {
  bolsas: "Cor = quanto o principal índice de cada país variou no último pregão. Verde subiu, vermelho caiu.",
  moedas: "Cor = quanto cada moeda variou contra o real. Vermelho: a moeda caiu, ou seja, o real ficou mais forte. Verde: a moeda subiu e o real enfraqueceu.",
};
const SIMBOLOS = { USD: "US$", EUR: "€", GBP: "£", JPY: "¥", CHF: "Fr", CAD: "C$", AUD: "A$", DKK: "kr", NOK: "kr", SEK: "kr" };
// Onde escrever o rótulo de cada moeda (o euro vai na Alemanha)
const ONDE_MOEDA = { USD: "840", EUR: "276", GBP: "826", JPY: "392", CHF: "756", CAD: "124", AUD: "036", DKK: "208", NOK: "578", SEK: "752" };

const carregarScript = (src) => new Promise((ok, erro) => {
  if ([...document.scripts].some((s) => s.src === src && s.dataset.ok)) return ok();
  const ja = [...document.scripts].find((s) => s.src === src);
  if (ja) { ja.addEventListener("load", ok); ja.addEventListener("error", erro); return; }
  const s = document.createElement("script");
  s.crossOrigin = "anonymous";   // resposta legível, para o service worker guardar e funcionar offline
  // Se falhar, tira o script morto da página: senão a próxima tentativa esperaria para sempre por ele.
  s.src = src; s.onload = () => { s.dataset.ok = "1"; ok(); }; s.onerror = () => { s.remove(); erro(); };
  document.head.appendChild(s);
});

function cartaoBrasil(mundo) {
  const m = estado.resultado.mercado || {}, ib = m.ibovespa, eur = mundo.moedas?.["276"];
  // Dólar e euro da mesma fonte (PTAX do Banco Central, contra a PTAX do dia útil anterior), para a comparação ser justa.
  const ptaxUsd = mundo.moedas?.["840"], us = ptaxUsd ? { valor: ptaxUsd.valor, var_dia: ptaxUsd.var } : m.dolar;
  const moedas = [...new Map(Object.values(mundo.moedas || {}).map((d) => [d.moeda, d])).values()];
  const ganhou = moedas.filter((d) => d.var < 0).length;
  return `<div class="brasil-card">
    <div class="brasil-topo"><span class="bandeira" aria-hidden="true"></span><b>Brasil hoje</b></div>
    <div class="brasil-grade">
      <div><span>Ibovespa</span><b>${ib ? num(ib.valor, 0) : "—"}</b><em class="${cls(ib?.var_dia)}">${sinal(ib?.var_dia)}</em></div>
      <div><span>Dólar</span><b>${reais(us?.valor, 3)}</b><em class="${cls(us?.var_dia)}">${sinal(us?.var_dia)}</em></div>
      <div><span>Euro</span><b>${reais(eur?.valor, 3)}</b><em class="${cls(eur?.var)}">${sinal(eur?.var)}</em></div>
    </div>
    <p class="fonte-brasil">Dólar e euro pela PTAX do Banco Central, comparados com a PTAX do dia útil anterior.</p>
    ${moedas.length ? `<p>O real ${ganhou === moedas.length ? "ganhou força contra todas" : ganhou === 0 ? "perdeu força contra todas" : `ganhou força contra ${ganhou} de ${moedas.length}`} as moedas acompanhadas. ${ganhou >= moedas.length / 2 ? "Real forte barateia importados e reduz o ganho em reais de exportadoras como VALE3 e SUZB3." : "Real fraco encarece importados e aumenta o ganho em reais de exportadoras como VALE3 e SUZB3."}</p>` : ""}
  </div>`;
}

async function montarGlobo(slot) {
  slot.insertAdjacentHTML("beforeend", `<section class="painel mundo" id="mundo">
    <div class="painel-cabeca"><h2>O mundo hoje</h2>
      <div class="pilulas" style="margin-left:auto"><button type="button" data-modo="moedas" class="ativo">Moedas em reais</button><button type="button" data-modo="bolsas">Bolsas</button></div></div>
    <div class="mundo-grade">
      <div class="globo-caixa">
        <div class="zoom-globo"><button type="button" data-zoom="1.4" aria-label="Aproximar">+</button><button type="button" data-zoom="0.71" aria-label="Afastar">−</button><button type="button" data-zoom="0" aria-label="Voltar ao Brasil"><i class="ti ti-focus-centered"></i></button></div>
        <canvas class="globo" role="img" aria-label="Globo com a variação de cada país"></canvas><div class="dica-globo"></div>
        <p class="faint legenda-globo" id="legenda-globo">${LEGENDAS.moedas} Arraste para girar, use a roda do mouse para aproximar.</p>
      </div>
      <aside class="mundo-lado"><div id="brasil-slot"></div><div class="destaques-globo" id="destaques-globo"><div class="carregando"></div></div></aside>
    </div></section>`);
  const caixa = $("#mundo"), tela = $(".globo", caixa), dicaEl = $(".dica-globo", caixa);

  let mundo, topo;
  try {
    for (const src of LIBS_GLOBO) await carregarScript(src);
    [mundo, topo] = await Promise.all([carregarJSON("dados/mundo.json"), fetch(MAPA_MUNDO).then((r) => r.json())]);
  } catch {
    $("#destaques-globo").innerHTML = '<div class="vazio">Não foi possível carregar o mapa agora.</div>';
    return;
  }
  if (!document.body.contains(caixa)) return;
  $("#brasil-slot").innerHTML = cartaoBrasil(mundo);

  const paises = topojson.feature(topo, topo.objects.countries).features;
  const fronteiras = topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b);
  const centro = Object.fromEntries(paises.map((f) => [f.id, d3.geoCentroid(f)]));
  centro["840"] = [-98, 39]; centro["250"] = [2.5, 46.5]; centro["578"] = [9, 61]; centro["124"] = [-100, 57];
  const ctx = tela.getContext("2d"), proj = d3.geoOrthographic().clipAngle(90).rotate([50, 12]);
  const caminho = d3.geoPath(proj, ctx), grade = d3.geoGraticule10();
  let modo = "moedas", lado = 0, escalaBase = 1, realce = null, alvo = null, pedido = false;

  const dado = (id) => mundo[modo]?.[id];
  const cor = (v) => {
    if (v == null) return "rgba(255,244,236,.07)";
    const t = Math.min(1, Math.abs(v) / 2);
    return v >= 0 ? d3.interpolateRgb("#2c3d32", "#3ddc8a")(t) : d3.interpolateRgb("#3f2522", "#ff5a4e")(t);
  };
  const rotulos = () => modo === "moedas"
    ? Object.entries(ONDE_MOEDA).map(([m, iso]) => {
        const d = Object.values(mundo.moedas || {}).find((x) => x.moeda === m);
        return d && { iso, l1: `${SIMBOLOS[m]} ${reais(d.valor, d.valor < 1 ? 4 : 2)}`, l2: sinal(d.var), v: d.var };
      }).filter(Boolean)
    : Object.entries(mundo.bolsas || {}).map(([iso, d]) => ({ iso, l1: d.nome, l2: sinal(d.var), v: d.var }));

  const desenhar = () => {
    pedido = false;
    const r = proj.scale(), [cx, cy] = proj.translate();
    ctx.clearRect(0, 0, lado, lado);
    const halo = ctx.createRadialGradient(cx, cy, r * .9, cx, cy, r * 1.08);
    halo.addColorStop(0, "rgba(255,122,31,0)"); halo.addColorStop(.5, "rgba(255,122,31,.22)"); halo.addColorStop(1, "rgba(255,122,31,0)");
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, r * 1.08, 0, 2 * Math.PI); ctx.fill();
    const mar = ctx.createRadialGradient(cx - r * .3, cy - r * .35, r * .1, cx, cy, r);
    mar.addColorStop(0, "#3a2418"); mar.addColorStop(.7, "#1b110c"); mar.addColorStop(1, "#0d0806");
    ctx.fillStyle = mar; ctx.beginPath(); caminho({ type: "Sphere" }); ctx.fill();
    ctx.strokeStyle = "rgba(255,200,150,.07)"; ctx.lineWidth = .6; ctx.beginPath(); caminho(grade); ctx.stroke();
    for (const f of paises) { ctx.fillStyle = cor(dado(f.id)?.var); ctx.beginPath(); caminho(f); ctx.fill(); }
    ctx.strokeStyle = "rgba(14,8,5,.9)"; ctx.lineWidth = .6; ctx.beginPath(); caminho(fronteiras); ctx.stroke();
    const contorno = (id, corL, w) => { const f = paises.find((p) => p.id === id); if (!f) return; ctx.strokeStyle = corL; ctx.lineWidth = w; ctx.beginPath(); caminho(f); ctx.stroke(); };
    contorno("076", "#ffb057", 2);
    if (realce) contorno(realce, "#fff", 2);
    const frente = [-proj.rotate()[0], -proj.rotate()[1]];
    ctx.textAlign = "center"; ctx.lineJoin = "round";
    for (const rt of rotulos()) {
      const c = centro[rt.iso];
      if (!c || d3.geoDistance(c, frente) > 1.35) continue;
      const [x, y] = proj(c);
      ctx.font = "700 12.5px 'Plus Jakarta Sans', sans-serif"; ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(14,8,5,.85)";
      ctx.strokeText(rt.l1, x, y); ctx.fillStyle = "#fff"; ctx.fillText(rt.l1, x, y);
      ctx.font = "700 11.5px 'Plus Jakarta Sans', sans-serif"; ctx.strokeText(rt.l2, x, y + 14);
      ctx.fillStyle = rt.v >= 0 ? "#8ff0c0" : "#ff9a8f"; ctx.fillText(rt.l2, x, y + 14);
    }
  };
  const agendar = () => { if (!pedido) { pedido = true; requestAnimationFrame(desenhar); } };

  const ajustar = () => {
    const w = Math.min(tela.parentElement.clientWidth, 600), dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!w) return;
    // Mantém o zoom da pessoa ao redimensionar; na primeira vez, o globo inteiro (escala padrão do d3 não conta)
    const k = escalaBase > 1 ? proj.scale() / escalaBase : 1;
    lado = w; tela.width = w * dpr; tela.height = w * dpr; tela.style.width = `${w}px`; tela.style.height = `${w}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    escalaBase = w * .46;
    proj.translate([w / 2, w / 2]).scale(escalaBase * (isFinite(k) && k > 0 ? k : 1));
    agendar();
  };
  new ResizeObserver(ajustar).observe(tela.parentElement);
  ajustar();

  const pintarLista = () => {
    const itens = Object.entries(mundo[modo] || {}).filter(([, d], i, arr) => modo === "bolsas" || arr.findIndex(([, x]) => x.moeda === d.moeda) === i)
      .sort((a, b) => b[1].var - a[1].var);
    const linha = ([iso, d]) => `<button type="button" class="item-moeda ${d.var >= 0 ? "pos" : "neg"}" data-iso="${iso}"><b>${esc(modo === "bolsas" ? `${d.pais} · ${d.nome}` : d.nome)}</b><span>${esc(modo === "bolsas" ? num(d.valor, 0) : reais(d.valor, d.valor < 1 ? 4 : 3))}</span><em>${sinal(d.var)}</em></button>`;
    $("#destaques-globo").innerHTML = itens.length
      ? `<h3 class="faint">${modo === "bolsas" ? "Bolsas do mundo, da maior alta para a maior queda" : "Moedas em reais, da maior alta para a maior queda"}</h3>${itens.map(linha).join("")}`
      : '<div class="vazio">Sem dados nesta atualização.</div>';
    $("#legenda-globo").textContent = `${LEGENDAS[modo]} Arraste para girar, use a roda do mouse para aproximar.`;
  };
  pintarLista();

  // Arrastar gira; roda do mouse e botões aproximam; passar o mouse mostra o país.
  d3.select(tela).call(d3.drag().on("start", () => { alvo = null; }).on("drag", (ev) => {
    const [l, f] = proj.rotate(), s = 75 / proj.scale();
    proj.rotate([l + ev.dx * s, Math.max(-75, Math.min(75, f - ev.dy * s))]);
    agendar();
  }));
  const zoom = (k) => { proj.scale(Math.max(escalaBase * .8, Math.min(escalaBase * 7, k))); agendar(); };
  // A roda só segura a página enquanto o zoom muda; no limite, a página volta a rolar normalmente.
  tela.addEventListener("wheel", (ev) => {
    const antes = proj.scale();
    zoom(antes * (ev.deltaY < 0 ? 1.12 : .89));
    if (proj.scale() !== antes) ev.preventDefault();
  }, { passive: false });
  // Girar suavemente até um país (lista ao lado e botão de centralizar)
  const irPara = (iso) => {
    const c = centro[iso];
    if (!c) return;
    alvo = [-c[0], -c[1]];
    const passo = () => {
      if (!alvo) return;
      const [l, f] = proj.rotate(), nl = l + (alvo[0] - l) * .15, nf = f + (alvo[1] - f) * .15;
      proj.rotate([nl, nf]); desenhar();
      if (Math.abs(alvo[0] - nl) < .3 && Math.abs(alvo[1] - nf) < .3) alvo = null; else requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  };
  $$("[data-zoom]", caixa).forEach((b) => b.onclick = () => {
    const f = +b.dataset.zoom;
    if (f) zoom(proj.scale() * f); else { proj.scale(escalaBase); irPara("076"); }
  });
  // Procurar o país sob o mouse testa ~177 contornos: no máximo uma vez por quadro de animação.
  let ultimoEv = null, quadroMouse = 0;
  tela.addEventListener("pointermove", (ev) => {
    ultimoEv = ev;
    if (!quadroMouse) quadroMouse = requestAnimationFrame(() => { quadroMouse = 0; sobMouse(ultimoEv); });
  });
  const sobMouse = (ev) => {
    const r = tela.getBoundingClientRect(), ponto = proj.invert([ev.clientX - r.left, ev.clientY - r.top]);
    const f = ponto && d3.geoDistance(ponto, [-proj.rotate()[0], -proj.rotate()[1]]) < Math.PI / 2 ? paises.find((p) => d3.geoContains(p, ponto)) : null;
    const id = f?.id || null;
    if (id !== realce) { realce = id; agendar(); }
    if (!f) { dicaEl.classList.remove("on"); return; }
    const d = dado(f.id);
    if (f.id === "076" && !d) {   // Brasil: o real é a moeda de referência de tudo no globo
      dicaEl.innerHTML = `<b>Brasil</b><span class="faint">${modo === "moedas" ? "o real é a base das cotações" : "veja o Ibovespa ao lado"}</span>`;
    } else dicaEl.innerHTML = `<b>${esc(d?.pais || nomePais(f))}</b>${d ? `${esc(d.nome)}${modo === "moedas" ? ` · ${reais(d.valor, d.valor < 1 ? 4 : 3)}` : ""}: <span class="${cls(d.var)}">${sinal(d.var)}</span>` : '<span class="faint">sem dado</span>'}`;
    dicaEl.style.left = `${ev.clientX - r.left}px`; dicaEl.style.top = `${ev.clientY - r.top}px`;
    dicaEl.classList.add("on");
  };
  tela.addEventListener("pointerleave", () => { cancelAnimationFrame(quadroMouse); quadroMouse = 0; dicaEl.classList.remove("on"); realce = null; agendar(); });
  $("#destaques-globo").addEventListener("click", (ev) => { const b = ev.target.closest("[data-iso]"); if (b) { realce = b.dataset.iso; irPara(b.dataset.iso); } });
  ligarAbas(caixa, "modo", (m) => { modo = m; pintarLista(); agendar(); });
  estado.pararGlobo = () => { alvo = null; };
}
