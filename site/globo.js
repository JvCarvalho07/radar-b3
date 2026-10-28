// O mundo hoje: globo que gira com as bolsas de cada país ou as moedas contra o real.
const LIBS_GLOBO = [
  "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js",
  "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js",
];
const MAPA_MUNDO = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";
const LEGENDAS = {
  bolsas: "Variação do principal índice de cada país no último pregão dele. Verde subiu, vermelho caiu.",
  moedas: "Quanto cada moeda variou contra o real na última PTAX do Banco Central. Verde: a moeda subiu, ou seja, o real ficou mais fraco. Vermelho: a moeda caiu e o real ficou mais forte.",
};

const carregarScript = (src) => new Promise((ok, erro) => {
  if ([...document.scripts].some((s) => s.src === src)) return ok();
  const s = document.createElement("script");
  s.src = src; s.onload = ok; s.onerror = erro;
  document.head.appendChild(s);
});

async function montarGlobo(slot) {
  slot.insertAdjacentHTML("beforeend", `<section class="painel mundo" id="mundo">
    <div class="painel-cabeca"><h2>O mundo hoje</h2>
      <div class="pilulas" style="margin-left:auto"><button type="button" data-modo="moedas" class="ativo">Moedas em reais</button><button type="button" data-modo="bolsas">Bolsas</button></div></div>
    <div class="mundo-grade">
      <div class="globo-caixa"><div class="zoom-globo"><button type="button" data-zoom="1.4" aria-label="Aproximar">+</button><button type="button" data-zoom="0.71" aria-label="Afastar">−</button><button type="button" data-zoom="0" aria-label="Voltar ao tamanho normal"><i class="ti ti-focus-centered"></i></button></div><svg class="globo" viewBox="0 0 600 600" role="img" aria-label="Globo com a variação de cada país"></svg><div class="dica-globo"></div>
        <p class="faint legenda-globo" id="legenda-globo">${LEGENDAS.moedas}</p></div>
      <aside class="mundo-lado"><div class="destaques-globo" id="destaques-globo"><div class="carregando"></div></div><div class="mundo-lista" id="mundo-lista" hidden></div></aside>
    </div></section>`);
  const caixa = $("#mundo"), svgEl = $(".globo", caixa), dicaEl = $(".dica-globo", caixa);

  let mundo, topo;
  try {
    await Promise.all(LIBS_GLOBO.map(carregarScript));
    [mundo, topo] = await Promise.all([carregarJSON("dados/mundo.json"), fetch(MAPA_MUNDO).then((r) => r.json())]);
  } catch {
    $("#mundo-lista").innerHTML = '<div class="vazio">Não foi possível carregar o mapa agora.</div>';
    return;
  }
  if (!document.body.contains(caixa)) return;  // trocou de tela enquanto carregava

  const paises = topojson.feature(topo, topo.objects.countries).features;
  const proj = d3.geoOrthographic().scale(282).translate([300, 300]).clipAngle(90).rotate([50, 12]);
  const caminho = d3.geoPath(proj);
  const svg = d3.select(svgEl);
  svg.append("defs").html(`<radialGradient id="oceano" cx="38%" cy="32%"><stop offset="0" stop-color="#3a2418"/><stop offset=".7" stop-color="#1b110c"/><stop offset="1" stop-color="#0d0806"/></radialGradient>
    <radialGradient id="halo"><stop offset=".86" stop-color="rgba(255,122,31,0)"/><stop offset=".93" stop-color="rgba(255,122,31,.22)"/><stop offset="1" stop-color="rgba(255,122,31,0)"/></radialGradient>`);
  svg.append("circle").attr("cx", 300).attr("cy", 300).attr("r", 318).attr("fill", "url(#halo)");
  svg.append("path").datum({ type: "Sphere" }).attr("class", "esfera").attr("fill", "url(#oceano)");
  svg.append("path").datum(d3.geoGraticule10()).attr("class", "graticula");
  const terras = svg.append("g").selectAll("path").data(paises).join("path").attr("class", "pais");
  const camadaRotulos = svg.append("g").attr("class", "rotulos-globo");

  let modo = "moedas";
  const SIMBOLOS = { USD: "US$", EUR: "€", GBP: "£", JPY: "¥", CHF: "Fr", CAD: "C$", AUD: "A$", DKK: "kr", NOK: "kr", SEK: "kr" };
  // Onde escrever cada rótulo: um país por moeda (o euro vai na Alemanha) ou cada país com bolsa.
  const ONDE_MOEDA = { USD: "840", EUR: "276", GBP: "826", JPY: "392", CHF: "756", CAD: "124", AUD: "036", DKK: "208", NOK: "578", SEK: "752" };
  const centro = Object.fromEntries(paises.map((f) => [f.id, d3.geoCentroid(f)]));
  // Ajustes finos de posição para países cujo centróide cai fora do continente principal
  centro["840"] = [-98, 39]; centro["250"] = [2.5, 46.5]; centro["578"] = [9, 61]; centro["124"] = [-100, 57];
  const rotulos = () => modo === "moedas"
    ? Object.entries(ONDE_MOEDA).filter(([m]) => Object.values(mundo.moedas || {}).some((d) => d.moeda === m)).map(([m, iso]) => {
        const d = Object.values(mundo.moedas).find((x) => x.moeda === m);
        return { iso, linha1: `${SIMBOLOS[m]} ${reais(d.valor, d.valor < 1 ? 4 : 2)}`, linha2: sinal(d.var), v: d.var };
      })
    : Object.entries(mundo.bolsas || {}).map(([iso, d]) => ({ iso, linha1: d.nome, linha2: sinal(d.var), v: d.var }));
  const dado = (f) => mundo[modo]?.[f.id];
  const cor = (v) => {
    if (v == null) return "rgba(255,244,236,.07)";
    const t = Math.min(1, Math.abs(v) / 2);
    return v >= 0 ? d3.interpolateRgb("#2c3d32", "#62dca0")(t) : d3.interpolateRgb("#3f2522", "#ff6b5e")(t);
  };
  const redesenhar = () => {
    svg.selectAll(".esfera, .graticula").attr("d", caminho);
    terras.attr("d", caminho);
    const [l, f] = proj.rotate(), frente = [-l, -f];
    camadaRotulos.selectAll("g").data(rotulos(), (r) => r.iso).join((e) => {
      const g = e.append("g");
      g.append("text").attr("class", "r1");
      g.append("text").attr("class", "r2").attr("dy", 14);
      return g;
    }).each(function (r) {
      const c = centro[r.iso], visivel = c && d3.geoDistance(c, frente) < 1.35;
      const g = d3.select(this).style("display", visivel ? null : "none");
      if (!visivel) return;
      const [x, y] = proj(c);
      g.attr("transform", `translate(${x.toFixed(1)},${y.toFixed(1)})`);
      g.select(".r1").text(r.linha1);
      g.select(".r2").text(r.linha2).attr("class", `r2 ${r.v >= 0 ? "sobe" : "desce"}`);
    });
  };
  const pintar = () => {
    terras.attr("fill", (f) => cor(dado(f)?.var)).classed("brasil", (f) => f.id === "076").classed("com-dado", (f) => !!dado(f));
    $("#legenda-globo").textContent = LEGENDAS[modo];
    const itens = Object.entries(mundo[modo] || {}).filter(([, d], i, arr) => modo === "bolsas" || arr.findIndex(([, x]) => x.moeda === d.moeda) === i)
      .sort((a, b) => b[1].var - a[1].var);
    $("#mundo-lista").innerHTML = itens.length ? itens.map(([iso, d]) => `<button type="button" class="mundo-item" data-iso="${iso}">
        <span><b>${esc(modo === "bolsas" ? d.pais : d.nome)}</b><span class="faint">${esc(modo === "bolsas" ? `${d.nome} · ${num(d.valor, 0)}` : `${d.moeda} · ${reais(d.valor, d.valor < 1 ? 4 : 3)}`)}</span></span>
        <span class="pilula ${cls(d.var)}">${sinal(d.var)}</span></button>`).join("")
      : '<div class="vazio">Sem dados nesta atualização.</div>';
    const linha = ([iso, d]) => `<button type="button" class="item-moeda ${d.var >= 0 ? "pos" : "neg"}" data-iso="${iso}"><b>${esc(modo === "bolsas" ? d.pais : d.nome)}</b><span>${esc(modo === "bolsas" ? num(d.valor, 0) : reais(d.valor, d.valor < 1 ? 4 : 3))}</span><em>${sinal(d.var)}</em></button>`;
    const usd = modo === "moedas" ? itens.find(([, d]) => d.moeda === "USD") : null;
    const resto = itens.filter((x) => x !== usd);
    const vars = itens.map(([, d]) => d.var), sobem = vars.filter((v) => v > 0).length;
    const frase = modo === "moedas"
      ? (sobem === 0
        ? `O real se valorizou contra todas as ${itens.length} moedas hoje (de ${sinal(Math.max(...vars))} a ${sinal(Math.min(...vars))}). É um movimento comum, não um dado isolado.`
        : `${sobem} de ${itens.length} moedas subiram contra o real hoje.`)
      : `${sobem} de ${itens.length} bolsas subiram hoje.`;
    $("#destaques-globo").innerHTML = itens.length
      ? `${usd ? `<div class="dolar-fixo"><h3 class="faint">Dólar (USD)</h3>${linha(usd)}</div>` : ""}
         <p class="faint frase-globo">${frase}</p>
         <div class="todos-destaques"><h3 class="faint">${modo === "bolsas" ? "Todas as bolsas" : "Demais moedas"}, da maior alta para a maior queda</h3>${resto.map(linha).join("")}</div>`
      : "";
  };
  redesenhar();
  pintar();

  // Interação: arrastar gira, passar o mouse mostra o país, a lista leva o globo até ele.
  let pausado = false, alvo = null;
  const reduzido = matchMedia("(prefers-reduced-motion: reduce)").matches;
  svg.call(d3.drag().on("start", () => { pausado = true; alvo = null; }).on("drag", (ev) => {
    const [l, f] = proj.rotate();
    proj.rotate([l + ev.dx * 0.3, Math.max(-60, Math.min(60, f - ev.dy * 0.3))]);
    redesenhar();
  }).on("end", () => { pausado = false; }));
  terras.on("mousemove", (ev, f) => {
    const d = dado(f), [x, y] = d3.pointer(ev, caixa.querySelector(".globo-caixa"));
    dicaEl.innerHTML = `<b>${esc(d?.pais || f.properties.name)}</b>${d ? `${esc(modo === "bolsas" ? d.nome : d.nome)}: <span class="${cls(d.var)}">${sinal(d.var)}</span>` : '<span class="faint">sem dado</span>'}`;
    dicaEl.style.left = `${x}px`; dicaEl.style.top = `${y}px`;
    dicaEl.classList.add("on");
    pausado = true;
  }).on("mouseleave", () => { dicaEl.classList.remove("on"); pausado = false; });
  $("#mundo-lista").addEventListener("mouseover", (ev) => {
    const b = ev.target.closest("[data-iso]");
    if (!b) return;
    const f = paises.find((p) => p.id === b.dataset.iso);
    if (f) { const [lon, lat] = d3.geoCentroid(f); alvo = [-lon, -lat]; }
    terras.classed("realce", (p) => p.id === b.dataset.iso);
  });
  $("#mundo-lista").addEventListener("mouseleave", () => terras.classed("realce", false));
  $("#destaques-globo").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-iso]"), f = b && paises.find((p) => p.id === b.dataset.iso);
    if (f) { const [lon, lat] = d3.geoCentroid(f); alvo = [-lon, -lat]; }
  });
  ligarAbas(caixa, "modo", (m) => { modo = m; pintar(); redesenhar(); });

  const ESCALA = 282;
  const aplicarZoom = (k) => { proj.scale(Math.max(ESCALA * 0.8, Math.min(ESCALA * 6, k))); redesenhar(); };
  svgEl.addEventListener("wheel", (ev) => { ev.preventDefault(); pausado = true; aplicarZoom(proj.scale() * (ev.deltaY < 0 ? 1.15 : 0.87)); clearTimeout(svgEl._t); svgEl._t = setTimeout(() => { pausado = false; }, 1500); }, { passive: false });
  $$("[data-zoom]", caixa).forEach((b) => b.onclick = () => { const f = +b.dataset.zoom; aplicarZoom(f ? proj.scale() * f : ESCALA); });
  $("#destaques-globo").addEventListener("mouseover", (ev) => {
    const b = ev.target.closest("[data-iso]");
    if (!b) return;
    const f = paises.find((p) => p.id === b.dataset.iso);
    if (f) { const [lon, lat] = d3.geoCentroid(f); alvo = [-lon, -lat]; }
    terras.classed("realce", (p) => p.id === b.dataset.iso);
  });
  const relogio = d3.timer(() => {
    if (document.hidden) return;
    const [l, f] = proj.rotate();
    if (alvo) {
      const nl = l + (alvo[0] - l) * 0.08, nf = f + (alvo[1] - f) * 0.08;
      proj.rotate([nl, nf]);
      if (Math.abs(alvo[0] - nl) < .2 && Math.abs(alvo[1] - nf) < .2) alvo = null;
    } else if (!pausado && !reduzido) {
      proj.rotate([l + 0.12, f]);
    } else return;
    redesenhar();
  });
  estado.pararGlobo = () => relogio.stop();
}
