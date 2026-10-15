/* STQC Alarm (web) – service worker: powiadomienia o alarmach (Web Push z dekodera) i praca bez sieci. */
"use strict";
importScripts("common.js");

var CACHE = "stqc-alarm-" + STQC.VERSION;
var FILES = ["./", "index.html", "app.css", "app.js", "common.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/apple-touch-icon.png", "icons/badge-72.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("stqc-alarm-") === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/* Najpierw sieć (zawsze najnowsza wersja), bez sieci – kopia z pamięci (historia alarmów działa offline). */
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || /\.apk$/.test(url.pathname)) return;
  e.respondWith(fetch(req, { cache: "no-cache" }).then(function (res) {
    if (res && res.ok && res.type === "basic") {
      var copy = res.clone();
      var key = req.mode === "navigate" ? "./" : req;
      caches.open(CACHE).then(function (c) { return c.put(key, copy); }).catch(function () {});
    }
    return res;
  }).catch(function () {
    return caches.match(req.mode === "navigate" ? "./" : req, { ignoreSearch: req.mode === "navigate" })
      .then(function (r) { return r || caches.match("./"); });
  }));
});

function withTimeout(p, ms) {
  return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error("timeout")); }, ms); })]);
}

function tell(msg) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    list.forEach(function (c) { try { c.postMessage(msg); } catch (e) { /* zamknięte okno */ } });
  });
}

/* Alarm z powiadomienia: zapis w historii (aplikacja pokaże go od razu po otwarciu) i potwierdzenie
 * dostarczenia do dekodera – druh widnieje jako „odebrał alarm”, zanim jeszcze otworzy aplikację. */
async function storeAlarm(a) {
  a.recv = Date.now();
  a.push = true;
  var isNew = await STQC.addAlarm(a);
  var cfg = await STQC.getCfg();
  if (!STQC.paired(cfg) || String(a.id).indexOf("local.") === 0) return;
  var list = await STQC.alarms();
  var cur = list.filter(function (x) { return x.id === a.id; })[0];
  if (cur && !cur.acked) {
    await withTimeout(STQC.publish(cfg, STQC.message(cfg, "ack", { id: a.id }), 8000), 9000);
    await STQC.putField(a.id, "acked", true);
  }
  return isNew;
}

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: "STQC Alarm", body: e.data ? e.data.text() : "" }; }
  var alarm = d.t === "alarm";
  var tag = alarm ? "alarm-" + (d.id || Date.now()) : (d.tag || "stqc-" + Date.now());
  var opts = {
    body: d.body || "", tag: tag, data: { id: d.id || "", t: d.t || "" }, icon: "icons/icon-192.png",
    badge: "icons/badge-72.png", timestamp: Date.now(), renotify: true, requireInteraction: alarm,
    vibrate: alarm ? [900, 400, 900, 400, 900] : [200]
  };
  var maxActions = (self.Notification && self.Notification.maxActions) || 0;
  if (alarm && maxActions >= 2 && d.id) { // Android/komputer: odpowiedź prosto z powiadomienia (iPhone tego nie ma)
    opts.actions = [{ action: "go", title: "✅ Jadę" }, { action: "no", title: "❌ Nie jadę" }];
  }
  var jobs = [self.registration.showNotification(d.title || "STQC Alarm", opts)];
  if (alarm && d.a && d.a.id) jobs.push(storeAlarm(d.a));
  if (alarm && self.navigator.setAppBadge) jobs.push(self.navigator.setAppBadge(1));
  if (d.tag === "stqc-ok" || d.t === "test") jobs.push(STQC.patchCfg({ pushOkAt: Date.now() }));
  e.waitUntil(Promise.all(jobs.map(function (p) { return Promise.resolve(p).catch(function () {}); }))
    .then(function () { return tell({ type: "push", t: d.t || "", id: d.id || "", tag: d.tag || "" }); }));
});

self.addEventListener("notificationclick", function (e) {
  var data = (e.notification && e.notification.data) || {};
  var id = data.id || "";
  e.notification.close();
  if ((e.action === "go" || e.action === "no") && id) {
    e.waitUntil(answerFromNotification(id, e.action));
    return;
  }
  var url = new URL(id ? "./?a=" + encodeURIComponent(id) : "./", self.registration.scope).href;
  e.waitUntil((async function () {
    if (id) await STQC.patchCfg({ openAlarm: id, openAt: Date.now() }).catch(function () {});
    var wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (var i = 0; i < wins.length; i++) {
      try {
        wins[i].postMessage({ type: "open", id: id });
        await wins[i].focus();
        return;
      } catch (err) { /* spróbuj otworzyć nowe okno */ }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});

async function answerFromNotification(id, s) {
  var cfg = await STQC.getCfg();
  if (!STQC.paired(cfg)) return;
  await STQC.setMy(id, s, 0, "sending");
  try {
    await withTimeout(STQC.publish(cfg, STQC.message(cfg, "resp", { id: id, s: s, e: 0, ts: Math.floor(Date.now() / 1000) })), 15000);
    await STQC.setMyState(id, "sent");
    await self.registration.showNotification("Wysłano: " + (s === "go" ? "✅ Jadę" : "❌ Nie jadę"),
      { tag: "sent-" + id, body: "Dotknij, aby zobaczyć, kto jedzie.", data: { id: id }, icon: "icons/icon-192.png" });
  } catch (err) {
    await STQC.setMyState(id, "retry"); // aplikacja ponowi po otwarciu
    await self.registration.showNotification("⚠ Nie wysłano odpowiedzi", { tag: "sent-" + id, data: { id: id },
      body: "Brak internetu – otwórz aplikację, odpowiedź zostanie wysłana ponownie.", icon: "icons/icon-192.png" });
  }
  if (self.navigator.clearAppBadge) self.navigator.clearAppBadge().catch(function () {});
  await tell({ type: "my", id: id });
}

self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "skipWaiting") self.skipWaiting();
});
