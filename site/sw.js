// Service worker: funciona offline com o último dado visto e recebe as notificações push.
// Na publicação, o publicar.py troca este nome por um resumo dos arquivos do app: qualquer mudança no código
// muda o sw.js, e o app instalado se atualiza sozinho (não precisa reinstalar nem apertar F5).
const VERSAO = "radar-v16";
const CASCA = ["./", "index.html", "estilo.css", "app.js", "rede.js", "globo.js", "mapa.js", "carteira.js", "config.js", "manifest.webmanifest",
               "icones/icone-192.png", "icones/icone-512.png", "icones/icone-maskable-192.png", "icones/icone-180.png"];

self.addEventListener("install", (ev) => {
  // "reload" busca direto do servidor, sem pegar cópia velha guardada pelo navegador
  ev.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA.map((u) => new Request(u, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys().then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (ev) => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== "GET") return;
  // Dados: sempre tenta a rede primeiro; o cache só serve quando está offline.
  if (url.pathname.includes("/dados/")) {
    ev.respondWith(fetch(ev.request).then((resp) => {
      const copia = resp.clone();
      caches.open(VERSAO).then((c) => c.put(ev.request, copia));
      return resp;
    }).catch(() => caches.match(ev.request)));
    return;
  }
  // Casca do app e biblioteca de gráficos: rede primeiro também, para pegar atualizações.
  // Arquivos do próprio app: "no-cache" confere com o servidor (o GitHub deixa o navegador guardar por 10 min).
  const daRede = url.origin === self.location.origin ? fetch(ev.request.url, { cache: "no-cache", credentials: "same-origin" }) : fetch(ev.request);
  ev.respondWith(daRede.then((resp) => {
    if (resp.ok) { const copia = resp.clone(); caches.open(VERSAO).then((c) => c.put(ev.request, copia)); }
    return resp;
  }).catch(() => caches.match(ev.request, { ignoreSearch: true })));
});

self.addEventListener("push", (ev) => {
  let dados = { titulo: "Radar B3", corpo: "Há novidades.", url: "./#alertas" };
  try { dados = { ...dados, ...ev.data.json() }; } catch {}
  ev.waitUntil(self.registration.showNotification(dados.titulo, {
    body: dados.corpo, icon: "icones/icone-192.png", badge: "icones/icone-192.png", data: { url: dados.url },
  }));
});

self.addEventListener("notificationclick", (ev) => {
  ev.notification.close();
  const destino = new URL(ev.notification.data?.url || "./", self.registration.scope).href;
  ev.waitUntil(self.clients.matchAll({ type: "window" }).then((janelas) => {
    for (const j of janelas) if (j.url.startsWith(self.registration.scope)) return j.navigate(destino).then((w) => w.focus());
    return self.clients.openWindow(destino);
  }));
});
