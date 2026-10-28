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
      <div class="pilulas" style="margin-left:auto"><button type="button" data-modo="bolsas" class="ativo">Bolsas</button><button type="button" data-modo="moedas">Moedas contra o real</button></div></div>
    <div class="mundo-grade">
      <div class="globo-caixa"><svg class="globo" viewBox="0 0 600 600" role="img" aria-label="Globo com a variação de cada país"></svg><div class="dica-globo"></div>
        <p class="faint legenda-globo" id="legenda-globo">${LEGENDAS.bolsas}</p></div>
      <aside class="mundo-lista" id="mundo-lista"><div class="carregando"></div><div class="carregando" style="width:40%"></div></aside>
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

  let modo = "bolsas";
  const dado = (f) => mundo[modo]?.[f.id];
  const cor = (v) => {
    if (v == null) return "rgba(255,244,236,.07)";
    const t = Math.min(1, Math.abs(v) / 2);
    return v >= 0 ? d3.interpolateRgb("#2c3d32", "#62dca0")(t) : d3.interpolateRgb("#3f2522", "#ff6b5e")(t);
  };
  const redesenhar = () => {
    svg.selectAll(".esfera, .graticula").attr("d", caminho);
    terras.attr("d", caminho);
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
  ligarAbas(caixa, "modo", (m) => { modo = m; pintar(); });

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
