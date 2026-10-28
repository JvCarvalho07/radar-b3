// Mapa do mercado (estilo Finviz): cada quadrado é uma ação, agrupada por setor.
// Tamanho = volume negociado por dia (raiz quadrada, para as gigantes não engolirem o resto); cor = variação do dia.
const D3_MAPA = "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js";
let slotMapa = null, tempoMapa = null;
window.addEventListener("resize", () => {
  clearTimeout(tempoMapa);
  tempoMapa = setTimeout(() => { if (slotMapa?.isConnected) desenharMapa(slotMapa); }, 250);
});

const corVariacao = (v) => {
  if (v == null) return "#3a302b";
  const t = Math.min(1, Math.abs(v) / 4);
  return v >= 0 ? d3.interpolateRgb("#2e3a31", "#25b36a")(t) : d3.interpolateRgb("#3d2a25", "#e0443e")(t);
};

async function montarMapa(slot) {
  slot.innerHTML = `<section class="painel mapa" id="mapa">
    <div class="painel-cabeca"><h2>Mapa do mercado hoje</h2>
      <span class="extra">Cada quadrado é uma ação, agrupada por setor. Tamanho = quanto é negociado por dia. Cor = variação de hoje.</span></div>
    <div class="mapa-caixa" id="mapa-caixa"><div class="carregando"></div></div>
    <div class="mapa-legenda"><span>−4% ou mais</span><i></i><span>+4% ou mais</span></div>
    <div class="dica-mapa" id="dica-mapa"></div>
  </section>`;
  try { await carregarScript(D3_MAPA); } catch { $("#mapa-caixa", slot).innerHTML = '<div class="vazio">Não foi possível carregar o mapa agora.</div>'; return; }
  slotMapa = slot;
  desenharMapa(slot);
}

function desenharMapa(slot) {
  const caixa = $("#mapa-caixa", slot), dicaEl = $("#dica-mapa", slot);
  if (!caixa) return;
  const porSetor = {};
  for (const [p, u] of Object.entries(estado.universo)) {
    if (u.var_dia == null || !u.liq_2meses) continue;
    const setor = SETORES[u.setor] || u.setor || "Outros";
    (porSetor[setor] ||= []).push({ nome: p, valor: Math.sqrt(u.liq_2meses), u });
  }
  const raiz = d3.hierarchy({ children: Object.entries(porSetor).map(([nome, children]) => ({ nome, children })) })
    .sum((d) => d.valor || 0).sort((a, b) => b.value - a.value);
  const W = caixa.clientWidth, H = W > 900 ? 480 : W > 600 ? 520 : 620;
  d3.treemap().size([W, H]).paddingTop(20).paddingInner(2).paddingOuter(2).round(true)(raiz);
  caixa.style.height = `${H}px`;

  const setores = raiz.children.map((s) => {
    const w = s.x1 - s.x0;
    return `<div class="setor-mapa" style="left:${s.x0}px;top:${s.y0}px;width:${w}px;height:${s.y1 - s.y0}px">
      <span>${w > 70 ? esc(s.data.nome) : ""}</span></div>`;
  }).join("");
  const celulas = raiz.leaves().map((f) => {
    const w = f.x1 - f.x0, h = f.y1 - f.y0, v = f.data.u.var_dia;
    const texto = w > 46 && h > 30 ? `<b style="font-size:${Math.min(18, Math.max(11, w / 6))}px">${esc(f.data.nome)}</b><em>${sinal(v)}</em>`
      : w > 34 && h > 16 ? `<b style="font-size:10.5px">${esc(f.data.nome)}</b>` : "";
    return `<a class="celula-mapa" href="#acao/${esc(f.data.nome)}" data-p="${esc(f.data.nome)}"
      style="left:${f.x0}px;top:${f.y0}px;width:${w}px;height:${h}px;background:${corVariacao(v)}" aria-label="${esc(f.data.nome)}: ${sinal(v)} hoje">${texto}</a>`;
  }).join("");
  caixa.innerHTML = setores + celulas;

  caixa.onmousemove = (ev) => {
    const c = ev.target.closest(".celula-mapa");
    if (!c) { dicaEl.classList.remove("on"); return; }
    const u = estado.universo[c.dataset.p] || {}, r = slot.querySelector(".mapa").getBoundingClientRect();
    dicaEl.innerHTML = `<b>${esc(c.dataset.p)}</b>${esc(curto(u.nome) || "")}<br>${reais(precoDe(c.dataset.p))} · <span class="${cls(u.var_dia)}">${sinal(u.var_dia)} hoje</span> · ${sinal(u.var_30d, 1)} em 30 dias`;
    dicaEl.style.left = `${Math.min(ev.clientX - r.left, r.width - 140)}px`;
    dicaEl.style.top = `${ev.clientY - r.top}px`;
    dicaEl.classList.add("on");
  };
  caixa.onmouseleave = () => dicaEl.classList.remove("on");
}
