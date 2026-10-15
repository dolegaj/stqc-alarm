/* STQC Alarm (web) – aplikacja dla iPhone'a (i każdej przeglądarki): ten sam kod drużyny, protokół i szyfrowanie
 * co aplikacja na Androida, więc wszyscy są w jednej zbiórce i widzą tę samą listę „kto jedzie”. */
"use strict";
(function () {
  // ================================================================== środowisko
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var main = $("#main"), alarmEl = $("#alarm");
  var UA = navigator.userAgent;
  var IOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var ANDROID = /Android/i.test(UA);
  var STANDALONE = (window.matchMedia && (matchMedia("(display-mode: standalone)").matches ||
    matchMedia("(display-mode: fullscreen)").matches)) || navigator.standalone === true;
  var IOS_NOT_SAFARI = IOS && /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\/|Telegram/.test(UA);
  var PUSH_OK = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  var CRYPTO_OK = !!(window.crypto && crypto.subtle && window.indexedDB);
  var ROLES = [["dowódca", "⭐ dowódca"], ["kierowca", "🚗 kierowca"], ["KPP", "➕ KPP"], ["ratownik", "🧑‍🚒 ratownik"],
    ["pilarz", "🪚 pilarz"]];
  var LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round">' +
    '<path d="M20 20a17 17 0 0 0 0 24"/><path d="M44 20a17 17 0 0 1 0 24"/><path d="M12 13a27 27 0 0 0 0 38" opacity=".6"/>' +
    '<path d="M52 13a27 27 0 0 1 0 38" opacity=".6"/></g><circle cx="32" cy="32" r="7" fill="#fff"/></svg>';
  var SHARE_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="#4da3ff" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
  var ADD_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="#e9edf3" stroke-width="2" stroke-linecap="round">' +
    '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';

  // ================================================================== stan
  var cfg = {}, alarms = [];
  var view = "";
  var hashCode = "";
  var st = { connected: false, lastAct: 0, lastError: "", es: null, gen: 0, backoff: 2000, timer: 0, lastHello: 0,
    waitingWelcome: 0 };
  var seen = {}, seenQ = [];
  var queue = Promise.resolve();
  var shown = null, changing = false, ringing = null, ringTimer = 0;
  var dismissed = {}, rung = {}, sending = {};
  var pushState = { checked: false, sub: null, busy: false };

  // ================================================================== pomocnicze
  function setHTML(el, html) {
    if (el && el._h !== html) { el._h = html; el.innerHTML = html; }
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hhmm(ts) { var d = new Date(ts); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function ddmm(ts) { var d = new Date(ts); return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + " " + hhmm(ts); }
  function ago(ts) {
    var s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 45) return "przed chwilą";
    var m = Math.round(s / 60);
    if (m < 60) return m + " min temu";
    var h = Math.floor(m / 60);
    if (h < 24) return h + " godz. temu";
    var d = Math.floor(h / 24);
    return d === 1 ? "wczoraj" : d + " dni temu";
  }
  function alarmTs(a) { return a.ts ? a.ts * 1000 : (a.recv || Date.now()); }
  /** Zbiórka zamknięta: informacja z dekodera albo minął jej czas (np. telefon był wtedy offline). */
  function isClosed(a) {
    var until = (a.rc && a.rc.until) || a.until || 0;
    return !!((a.rc && a.rc.closed) || (until && Date.now() / 1000 > until + 60));
  }
  function toast(msg, err) {
    var t = $("#toast");
    t.textContent = msg;
    t.className = "on" + (err ? " err" : "");
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.className = ""; }, err ? 5000 : 3500);
  }
  function dialog(title, html, buttons) {
    buttons = buttons || [["OK"]];
    var d = $("#dlg");
    $("#dlgT").textContent = title;
    $("#dlgB").innerHTML = html;
    $("#dlgBtns").innerHTML = buttons.map(function (b, i) {
      return '<button class="btn ' + (b[1] || (i < buttons.length - 1 ? "sec" : "")) + '" data-i="' + i + '">' + esc(b[0]) + "</button>";
    }).join("");
    return new Promise(function (res) {
      $$("#dlgBtns button").forEach(function (b) {
        b.onclick = function () { try { d.close(); } catch (e) { d.removeAttribute("open"); } res(+b.dataset.i); };
      });
      try { d.showModal(); } catch (e) { d.setAttribute("open", ""); }
    });
  }
  function copy(text) {
    var done = function () { toast("Skopiowano: " + text); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { /* brak schowka */ }
    ta.remove();
  }
  function deviceName() {
    var m = UA.match(/(iPhone|iPad|iPod)[^)]*?OS (\d+)[_.](\d+)/), s;
    if (m) s = m[1] + ", iOS " + m[2] + "." + m[3];
    else if (IOS) s = "iPad";
    else if ((m = UA.match(/Android (\d+(?:\.\d+)?)/))) s = "Android " + m[1] + " (przeglądarka)";
    else if (/Mac OS X/.test(UA)) s = "Mac (przeglądarka)";
    else if (/Windows/.test(UA)) s = "Windows (przeglądarka)";
    else s = "Przeglądarka";
    return s + (STANDALONE ? " · ekran początkowy" : "");
  }
  async function reload() {
    try {
      cfg = await STQC.getCfg();
      alarms = await STQC.alarms();
    } catch (e) { /* zostaw poprzedni stan */ }
  }
  function header(sub) {
    return '<div class="head"><div class="logo">' + LOGO + '</div><div><h1>STQC Alarm</h1><div class="sub" id="hSub">' +
      esc(sub) + "</div></div></div>";
  }

  // ================================================================== start
  async function boot() {
    if (!CRYPTO_OK) {
      main.innerHTML = header("Alarmy jednostki OSP") + '<div class="card"><h2>Ta przeglądarka nie obsługuje aplikacji</h2>' +
        '<p class="muted">Otwórz stronę w Safari (iPhone) lub Chrome (Android, komputer) przez https://. ' +
        "Tryb prywatny może blokować zapis danych.</p></div>";
      return;
    }
    try {
      cfg = await STQC.getCfg();
      alarms = await STQC.alarms();
    } catch (e) {
      main.innerHTML = header("Alarmy jednostki OSP") + '<div class="card"><h2>Brak dostępu do pamięci</h2>' +
        '<p class="muted">Wyłącz tryb prywatny albo zezwól stronie na zapis danych i otwórz ją ponownie.</p></div>';
      return;
    }
    if (!cfg.member) cfg = await STQC.patchCfg({ member: STQC.randomHex(8) });
    registerSW();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    var q = new URLSearchParams(location.search), h = new URLSearchParams(location.hash.slice(1));
    hashCode = STQC.normalize(h.get("k") || q.get("k") || "");
    var openId = q.get("a") || h.get("a") || "";
    if (openId || (hashCode && STQC.paired(cfg))) history.replaceState(null, "", location.pathname);
    route();
    if (STQC.paired(cfg)) {
      connect("start");
      resendPending();
      syncPush();
    }
    if (openId) openAlarm(openId); else maybeShowAlarm();
    setInterval(tick, 5000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", function (e) { if (e.persisted) onVisible(); });
    window.addEventListener("online", function () { if (STQC.paired(cfg)) connect("online"); });
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", onSwMessage);
  }

  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" })
      .then(function (r) { r.update().catch(function () {}); })
      .catch(function (e) { console.warn("service worker:", e); });
  }

  function route() {
    if (STQC.paired(cfg)) return showHome();
    var browser = false;
    try { browser = !!sessionStorage.getItem("stqc-browser"); } catch (e) { /* bez sessionStorage */ }
    if (!STANDALONE && !browser && (IOS || ANDROID)) return showInstall();
    showPair();
  }

  // ================================================================== instalacja (iPhone / Android)
  function codeBox() {
    if (hashCode.length !== 10) return "";
    var f = STQC.format(hashCode);
    return '<div class="codebox"><div style="flex:1"><small class="muted">Kod Twojej drużyny</small><br><b class="mono">' + f +
      '</b></div><button class="btn sm sec" data-act="copyCode" data-code="' + f + '">📋 Kopiuj</button></div>';
  }
  function showInstall() {
    view = "install";
    if (IOS) {
      main.innerHTML = header("Alarmy jednostki OSP na iPhonie") +
        '<div class="card"><h2>Zainstaluj aplikację na iPhonie</h2>' +
        '<p class="muted">Aplikacja musi działać z ekranu początkowego – tylko wtedy iPhone pokaże powiadomienie o alarmie, ' +
        "także na zablokowanym ekranie. To zajmie 20 sekund:</p>" +
        '<ol class="steps">' +
        "<li><div>Stuknij <b>Udostępnij</b> <span class=\"ico\">" + SHARE_ICO + "</span> na pasku Safari " +
        "(na dole ekranu; na iPadzie u góry).</div></li>" +
        "<li><div>Przewiń listę i wybierz <b>„Do ekranu początkowego”</b> <span class=\"ico\">" + ADD_ICO + "</span>.</div></li>" +
        "<li><div>Stuknij <b>Dodaj</b>, a potem uruchom <b>STQC Alarm</b> z ekranu początkowego.</div></li>" +
        "<li><div>W aplikacji wpisz <b>kod drużyny</b> i imię, a potem stuknij <b>Włącz powiadomienia</b>.</div></li>" +
        "</ol>" + codeBox() + "</div>" +
        (IOS_NOT_SAFARI ? '<div class="note">⚠ Ta strona jest otwarta poza Safari. Otwórz ją w <b>Safari</b> ' +
          "(w Telegramie: ⋯ → „Otwórz w Safari”), wtedy pojawi się „Do ekranu początkowego”.</div>" : "") +
        '<div class="note blue">Wymagany iOS 16.4 lub nowszy (Ustawienia → Ogólne → Informacje). ' +
        "Kod drużyny zapisz lub skopiuj – aplikacja na ekranie początkowym ma osobną pamięć i poprosi o niego.</div>" +
        '<button class="btn ghost" data-act="browser" style="margin-top:14px">Kontynuuj w przeglądarce (bez powiadomień)</button>';
    } else {
      main.innerHTML = header("Alarmy jednostki OSP na telefonie") +
        '<div class="card"><h2>Masz telefon z Androidem</h2>' +
        "<p>Zainstaluj aplikację <b>STQC Alarm</b> na Androida – alarm zadzwoni jak budzik, na pełnym ekranie, " +
        "także na wyciszonym i zablokowanym telefonie.</p>" +
        '<a class="btn" href="STQC-Alarm.apk" download style="margin-top:12px">⬇ Pobierz aplikację (APK)</a>' +
        '<p class="hint">Otwórz pobrany plik i zezwól na instalowanie aplikacji z tego źródła. Android 8 lub nowszy. ' +
        "Potem wpisz w aplikacji kod drużyny.</p>" + codeBox() + "</div>" +
        '<button class="btn sec" data-act="browser" style="margin-top:12px">Użyj wersji w przeglądarce</button>' +
        '<p class="hint" style="text-align:center">Wersja w przeglądarce pokazuje alarm jako zwykłe powiadomienie.</p>';
    }
  }

  // ================================================================== parowanie
  function rolesHtml(id, cur) {
    cur = cur || [];
    return '<div class="roles" id="' + id + '">' + ROLES.map(function (r) {
      return '<label class="chk"><input type="checkbox" value="' + esc(r[0]) + '"' + (cur.indexOf(r[0]) >= 0 ? " checked" : "") +
        "><span>" + esc(r[1]) + "</span></label>";
    }).join("") + "</div>";
  }
  function checkedRoles(id) { return $$("#" + id + " input:checked").map(function (i) { return i.value; }); }

  function showPair() {
    view = "pair";
    var code = hashCode.length === 10 ? STQC.format(hashCode) : (cfg.code ? STQC.format(cfg.code) : "");
    var canPaste = !!(navigator.clipboard && navigator.clipboard.readText);
    main.innerHTML = header("Alarmy jednostki OSP na telefonie") +
      '<div class="card"><form id="pairForm" autocomplete="off">' +
      '<label class="lbl" for="pCode">1. Kod drużyny</label>' +
      '<div class="row"><input id="pCode" class="code" type="text" inputmode="text" autocapitalize="characters" ' +
      'autocorrect="off" spellcheck="false" placeholder="np. 7KQ2M-9XA4T" value="' + esc(code) + '">' +
      (canPaste ? '<button type="button" class="btn sm sec" style="flex:none" data-act="paste">📋 Wklej</button>' : "") + "</div>" +
      '<p class="hint">Kod jest w programie STQC Decoder na komputerze: zakładka „Drużyna” → „Aplikacja na telefon” ' +
      "(albo w wiadomości na grupie drużyny).</p>" +
      '<label class="lbl" for="pName">2. Imię i nazwisko</label>' +
      '<input id="pName" type="text" autocapitalize="words" placeholder="np. dh. Jan Kowalski" maxlength="60" value="' +
      esc(cfg.name || "") + '">' +
      '<label class="lbl">3. Twoje funkcje (opcjonalnie)</label>' + rolesHtml("pRoles", cfg.roles) +
      '<p class="hint" data-act="adv" style="cursor:pointer;margin-top:14px">▸ Ustawienia serwera (zaawansowane)</p>' +
      '<input id="pServer" type="url" placeholder="https://ntfy.sh" hidden value="' + esc(cfg.server || STQC.DEFAULT_SERVER) + '">' +
      '<button class="btn" type="submit" id="pBtn" style="margin-top:20px">Połącz z dekoderem</button>' +
      '<p id="pStatus" class="muted" style="min-height:1.4em"></p></form></div>' +
      '<p class="hint">Alarmy idą przez darmowy serwer ntfy.sh. Treść jest szyfrowana kluczem z kodu drużyny – ' +
      "nikt postronny jej nie odczyta. Ten sam kod działa na Androidzie i iPhonie – wszyscy są w jednej zbiórce.</p>";
    $("#pairForm").addEventListener("submit", function (e) { e.preventDefault(); pair(); });
  }

  async function pair() {
    var stEl = $("#pStatus"), btn = $("#pBtn");
    var norm = STQC.normalize($("#pCode").value);
    var name = $("#pName").value.trim().replace(/\s+/g, " ").slice(0, 60);
    var roles = checkedRoles("pRoles");
    var server = STQC.base($("#pServer").value);
    stEl.style.color = "var(--red2)";
    if (norm.length !== 10) {
      stEl.textContent = "Kod drużyny ma 10 znaków (np. 7KQ2M-9XA4T). Wpisano: " + norm.length;
      return;
    }
    if (name.length < 2) {
      stEl.textContent = "Wpisz imię i nazwisko – zobaczą je inni w zbiórce.";
      return;
    }
    btn.disabled = true;
    stEl.style.color = "";
    stEl.textContent = "Łączenie…";
    unlockAudio();
    try {
      var d = await STQC.derive(norm);
      cfg = await STQC.updateCfg(function (c) {
        return Object.assign(c, { code: norm, server: server, key: d.key, alarmTopic: d.alarmTopic, respTopic: d.respTopic,
          name: name, roles: roles, pairedAt: Date.now(), linkedAt: 0, unit: "", beaconAt: 0, lastId: "", vapid: "",
          pushOkAt: 0, pushSentAt: 0, pushEndpoint: "", pushVapid: "", openAlarm: "" });
      });
      await STQC.clearAlarms();
      alarms = [];
      hashCode = "";
      history.replaceState(null, "", location.pathname);
      st.waitingWelcome = Date.now();
      showHome();
      connect("pair");
      setTimeout(welcomeTimeout, 30000);
    } catch (e) {
      btn.disabled = false;
      stEl.style.color = "var(--red2)";
      stEl.textContent = "Błąd: " + (e && e.message || e);
    }
  }

  function welcomeTimeout() {
    if (!st.waitingWelcome || !STQC.paired(cfg)) return;
    st.waitingWelcome = 0;
    renderAll();
    dialog("Dekoder nie odpowiedział", "<p>Telefon nasłuchuje, ale dekoder nie potwierdził połączenia.</p>" +
      "<p>• sprawdź, czy kod drużyny jest poprawny,<br>• sprawdź, czy program STQC Decoder działa i ma włączone " +
      "„Alarmy na telefony”.</p><p>Gdy dekoder ruszy, połączenie potwierdzi się samo.</p>");
  }

  // ================================================================== panel
  function showHome() {
    view = "home";
    main.innerHTML = header(cfg.unit || "Kod drużyny " + STQC.format(cfg.code || "")) +
      '<div id="hPush"></div>' +
      '<div class="card" id="hStatus"></div>' +
      '<div id="hLast"></div>' +
      '<div class="card" id="hReady"></div>' +
      '<button class="btn sec" data-act="localTest" style="margin-top:12px">🔊 Testuj alarm na tym telefonie</button>' +
      settingsHtml() +
      '<div class="card" id="hHist" hidden></div>' +
      '<div class="foot" id="hFoot"></div>' +
      '<button class="btn ghost" data-act="unpair" style="margin-top:6px">Rozłącz ten telefon</button>';
    renderAll();
  }

  function renderAll() {
    if (view === "home") {
      var sub = $("#hSub");
      if (sub) sub.textContent = cfg.unit || "Kod drużyny " + STQC.format(cfg.code || "");
      renderPushBanner();
      renderStatus();
      renderLast();
      renderReady();
      renderHistory();
      setHTML($("#hFoot"), "Kod drużyny: " + esc(STQC.format(cfg.code || "")) + " · serwer: " +
        esc(STQC.base(cfg.server).replace(/^https?:\/\//, "")) + " · wersja web " + STQC.VERSION);
    }
    renderAlarm();
  }

  function pushEnabled() {
    return PUSH_OK && Notification.permission === "granted" && !!pushState.sub && !!cfg.pushSentAt &&
      (!cfg.vapid || !cfg.pushVapid || cfg.pushVapid === cfg.vapid);
  }

  function renderPushBanner() {
    var el = $("#hPush");
    if (!el) return;
    var html = "";
    if (PUSH_OK && pushState.checked && !pushEnabled() && Notification.permission !== "denied") {
      html = '<div class="card" style="background:#2a1416"><h2>🔔 Włącz powiadomienia o alarmach</h2>' +
        '<p class="muted">Bez tego alarm nie dotrze, gdy aplikacja jest zamknięta.</p>' +
        '<button class="btn" data-act="push" style="margin-top:10px"' + (cfg.vapid ? "" : " disabled") + ">" +
        (cfg.vapid ? "Włącz powiadomienia" : "Czekam na dekoder…") + "</button></div>";
    } else if (!PUSH_OK && IOS && !STANDALONE) {
      html = '<div class="card" style="background:#2a1416"><h2>📲 Zainstaluj na ekranie początkowym</h2>' +
        '<p class="muted">W przeglądarce iPhone nie pokaże powiadomienia o alarmie. Dodaj aplikację do ekranu ' +
        "początkowego i połącz ją tam tym samym kodem.</p>" +
        '<button class="btn" data-act="howInstall" style="margin-top:10px">Jak to zrobić?</button></div>';
    }
    setHTML(el, html);
  }

  function renderStatus() {
    var el = $("#hStatus");
    if (!el) return;
    var ok = st.connected, line, warn = false;
    if (st.waitingWelcome) line = "Czekam na potwierdzenie z dekodera… (do 30 s)";
    else if (!cfg.linkedAt && !cfg.beaconAt) line = "Dekoder jeszcze nie potwierdził połączenia – sprawdź kod drużyny i czy dekoder działa.";
    else if (!cfg.beaconAt) line = "Połączono z dekoderem";
    else if (Date.now() - cfg.beaconAt > 7 * 3600e3) {
      warn = true;
      line = "⚠ Dekoder nie dał znaku życia od " + ago(cfg.beaconAt).replace(" temu", "") + " – sprawdź komputer z radiem";
    } else line = "Dekoder działa · ostatni sygnał " + ago(cfg.beaconAt);
    setHTML(el, '<div class="status"><span class="dot ' + (ok ? "ok" : st.lastAct ? "" : "wait") + '"></span><span>' +
      (ok ? "Połączono – zbiórka na żywo" : st.lastAct || st.lastError ? "Brak połączenia – ponawiam…" : "Łączenie…") +
      "</span></div>" + '<p class="' + (warn ? "" : "muted") + '" style="' + (warn ? "color:#ffb020" : "") + '">' + esc(line) + "</p>" +
      (!ok && st.lastError ? '<p class="hint">' + esc(st.lastError) + "</p>" : ""));
  }

  function renderLast() {
    var el = $("#hLast");
    if (!el) return;
    var a = alarms[0];
    if (!a) { setHTML(el, ""); return; }
    var rc = a.rc, my = a.my, ts = alarmTs(a);
    setHTML(el, '<div class="card alarmcard" data-act="openAlarm" data-id="' + esc(a.id) + '">' +
      '<div class="k">' + (a.test ? "🧪 Ostatni test" : "🚨 Ostatni alarm") + "</div>" +
      '<div class="t">' + esc(a.title || "Alarm") + "</div>" +
      '<div class="muted" style="font-size:14px">godz. ' + hhmm(ts) + " · " + ago(ts) + "<br>" +
      (my ? "Twoja odpowiedź: " + esc(STQC.label(my)) : "Nie odpowiedziałeś") +
      (rc ? "<br>Zbiórka: ✅ " + len(rc.go) + " · ⏱ " + len(rc.eta) + " · ❌ " + len(rc.no) : "") + "</div></div>");
  }
  function len(x) { return Array.isArray(x) ? x.length : 0; }

  function check(ok, title, sub, btn) {
    return '<div class="check ' + (ok === false ? "bad" : "") + '"><span class="ic">' + (ok === true ? "✅" : ok === false ? "❌" : "ℹ️") +
      '</span><div class="ct"><span>' + title + "</span>" + (sub ? "<small>" + sub + "</small>" : "") + "</div>" + (btn || "") + "</div>";
  }

  function renderReady() {
    var el = $("#hReady");
    if (!el) return;
    var rows = [];
    if (IOS) {
      rows.push(check(STANDALONE, "Aplikacja na ekranie początkowym", STANDALONE ? "" : "Tylko wtedy iPhone pokaże powiadomienie o alarmie",
        STANDALONE ? "" : '<button class="btn sm" data-act="howInstall">Jak?</button>'));
    }
    if (!PUSH_OK) {
      rows.push(check(false, "Powiadomienia o alarmach", IOS ? (STANDALONE ? "Wymagany iOS 16.4 lub nowszy" :
        "Dostępne po uruchomieniu aplikacji z ekranu początkowego") : "Ta przeglądarka nie obsługuje powiadomień push"));
    } else if (Notification.permission === "denied") {
      rows.push(check(false, "Powiadomienia o alarmach", IOS ? "Zablokowane – włącz: Ustawienia → Powiadomienia → STQC Alarm" :
        "Zablokowane – zezwól na powiadomienia w ustawieniach strony"));
    } else if (pushEnabled()) {
      rows.push(check(true, "Powiadomienia o alarmach", "Włączone"));
      rows.push(check(cfg.pushOkAt ? true : false, "Dekoder wysyła powiadomienia na ten telefon",
        cfg.pushOkAt ? "Ostatnie potwierdzenie " + ago(cfg.pushOkAt) + ". Test: stuknij i zablokuj telefon." :
          "Czekam na powiadomienie testowe z dekodera…",
        '<button class="btn sm ' + (cfg.pushOkAt ? "sec" : "") + '" data-act="pushtest">Testuj</button>'));
    } else {
      rows.push(check(false, "Powiadomienia o alarmach", cfg.vapid ? "Wyłączone" : "Czekam na klucz z dekodera…",
        '<button class="btn sm" data-act="push"' + (cfg.vapid && !pushState.busy ? "" : " disabled") + ">Włącz</button>"));
    }
    rows.push(check(!!(cfg.linkedAt || cfg.beaconAt), "Połączenie z dekoderem",
      cfg.linkedAt ? "Potwierdzone " + ago(cfg.linkedAt) : "Dekoder jeszcze nie odpowiedział"));
    if (IOS) {
      rows.push(check(null, "Tryb skupienia i wyciszenie", "Dodaj STQC Alarm do dozwolonych aplikacji: Ustawienia → Skupienie → " +
        "Nie przeszkadzać → Aplikacje. Przy przełączniku wyciszenia iPhone tylko zawibruje."));
    }
    setHTML(el, "<h2>Gotowość telefonu</h2>" + rows.join(""));
  }

  function renderHistory() {
    var el = $("#hHist");
    if (!el) return;
    if (alarms.length < 2) { el.hidden = true; return; }
    el.hidden = false;
    setHTML(el, "<h2>Historia alarmów</h2>" + alarms.slice(0, 12).map(function (a) {
      return '<div class="hist" data-act="openAlarm" data-id="' + esc(a.id) + '">' + ddmm(alarmTs(a)) + "  " + (a.test ? "🧪 " : "") +
        esc(a.title || "Alarm") + (a.my ? "  —  " + esc(STQC.label(a.my)) : "") + "</div>";
    }).join(""));
  }

  function settingsHtml() {
    var snd = cfg.sound || "siren", rm = cfg.ringMin || 3;
    return '<div class="card" id="hSettings"><h2>Ustawienia</h2>' +
      '<label class="lbl" for="sName" style="margin-top:12px">Imię i nazwisko</label>' +
      '<input id="sName" type="text" autocapitalize="words" maxlength="60" value="' + esc(cfg.name || "") + '">' +
      '<label class="lbl">Funkcje</label>' + rolesHtml("sRoles", cfg.roles) +
      '<button class="btn sec" data-act="saveMe" style="margin-top:10px;min-height:46px">Zapisz dane druha</button>' +
      '<label class="lbl">Dźwięk alarmu w otwartej aplikacji</label><div class="radio">' +
      [["siren", "Syrena STQC"], ["none", "Bez dźwięku"]].map(function (o) {
        return '<label><input type="radio" name="snd" data-set="sound" value="' + o[0] + '"' + (snd === o[0] ? " checked" : "") +
          "><span>" + o[1] + "</span></label>";
      }).join("") + "</div>" +
      '<label class="lbl">Syrena gra przez</label><div class="radio">' + [1, 3, 5, 10].map(function (m) {
        return '<label><input type="radio" name="rm" data-set="ringMin" value="' + m + '"' + (rm === m ? " checked" : "") +
          "><span>" + m + " min</span></label>";
      }).join("") + "</div>" +
      (IOS ? '<p class="hint">Gdy aplikacja jest zamknięta, alarm przychodzi jako powiadomienie iPhone\'a z jego dźwiękiem.</p>' : "") +
      "</div>";
  }

  // ================================================================== ekran alarmu
  function find(id) {
    for (var i = 0; i < alarms.length; i++) if (alarms[i].id === id) return alarms[i];
    return null;
  }
  function openAlarm(id) {
    var a = find(id);
    if (!a) { // jeszcze nie ma w pamięci (np. powiadomienie przyszło, ale wiadomość dopiero się pobiera)
      shown = id;
      renderAlarm();
      return;
    }
    shown = a.id;
    changing = false;
    renderAlarm();
  }
  function closeAlarm() {
    if (shown) dismissed[shown] = true;
    if (ringing) silence();
    shown = null;
    changing = false;
    renderAlarm();
    clearBadge();
  }
  function maybeShowAlarm() {
    if (!STQC.paired(cfg)) return;
    if (cfg.openAlarm && Date.now() - (cfg.openAt || 0) < 180000) {
      var id = cfg.openAlarm;
      STQC.patchCfg({ openAlarm: "" }).then(function (c) { cfg = c; });
      openAlarm(id);
      return;
    }
    var a = alarms[0];
    if (!a || shown || dismissed[a.id] || a.local) { if (!shown) clearBadge(); return; }
    if (!a.my && !isClosed(a) && Date.now() - alarmTs(a) < 30 * 60000) openAlarm(a.id);
    else clearBadge();
  }

  function roleIcons(r) {
    if (!Array.isArray(r)) return "";
    return r.map(function (x) { return x === "kierowca" ? " 🚗" : x === "dowódca" ? " ⭐" : x === "KPP" ? " ➕" : ""; }).join("");
  }
  function rcHtml(a) {
    var rc = a.rc;
    if (!rc) {
      return '<div class="rc"><h3>' + (a.local ? "Test lokalny – bez zbiórki" : "Zbiórka") + "</h3>" +
        (a.local ? "" : '<div class="muted">Czekam na odpowiedzi drużyny…</div>') + "</div>";
    }
    var go = rc.go || [], et = rc.eta || [], no = rc.no || [], roles = rc.roles || {}, rows = "";
    go.forEach(function (p) {
      rows += '<div class="person"><span class="w">✅</span><span class="n">' + esc(p.n) + roleIcons(p.r) + "</span></div>";
    });
    et.forEach(function (p) {
      rows += '<div class="person"><span class="w">⏱</span><span class="n">' + esc(p.n) + roleIcons(p.r) + '</span><span class="e">za ' +
        (parseInt(p.e, 10) || 0) + " min" + (p.a ? " (~" + hhmm(p.a * 1000) + ")" : "") + "</span></div>";
    });
    no.forEach(function (p) {
      rows += '<div class="person"><span class="w">❌</span><span class="n">' + esc(p.n) + roleIcons(p.r) + "</span></div>";
    });
    return '<div class="rc"><h3>Zbiórka' + (isClosed(a) ? " · zakończona" : " na żywo") + "</h3>" +
      '<div class="tiles"><div class="tile go"><b>' + go.length + '</b><span>JADĄ</span></div><div class="tile eta"><b>' + et.length +
      '</b><span>DOJADĄ</span></div><div class="tile no"><b>' + no.length + "</b><span>NIE JADĄ</span></div></div>" +
      '<div class="roleline">🚗 kierowca ' + ((roles["kierowca"] | 0) > 0 ? "✓" : "brak") + " · ⭐ dowódca " +
      ((roles["dowódca"] | 0) > 0 ? "✓" : "brak") + " · ➕ KPP " + (roles["KPP"] | 0) + "</div>" +
      '<div class="people">' + (rows || '<div class="muted">Jeszcze nikt nie odpowiedział.</div>') + "</div>" +
      (rc.delivered ? '<div class="hint">📱 alarm odebrało telefonów: ' + (rc.delivered | 0) + "</div>" : "") + "</div>";
  }

  function renderAlarm() {
    if (!shown) {
      if (!alarmEl.hidden) {
        alarmEl.hidden = true;
        document.documentElement.style.overflow = "";
        alarmEl._built = false;
      }
      return;
    }
    var a = find(shown);
    if (!alarmEl._built) {
      alarmEl.innerHTML = '<div class="in"><div id="aHead"></div><div id="aAns"></div><div id="aSil"></div><div id="aRc"></div>' +
        '<div id="aTx"></div><button class="btn sec" data-act="closeAlarm" style="margin-top:18px;background:#ffffff26;' +
        'min-height:46px">Zamknij</button></div>';
      alarmEl._built = true;
      ["aHead", "aAns", "aSil", "aRc", "aTx"].forEach(function (k) { alarmEl[k] = $("#" + k, alarmEl); });
    }
    alarmEl.hidden = false;
    document.documentElement.style.overflow = "hidden";
    if (!a) {
      setHTML(alarmEl.aHead, '<span class="badge pulse">🚨 ALARM</span><div class="a-title">Pobieram alarm…</div>' +
        '<div class="a-meta">Czekam na połączenie z serwerem</div>');
      setHTML(alarmEl.aAns, "");
      setHTML(alarmEl.aSil, "");
      setHTML(alarmEl.aRc, "");
      setHTML(alarmEl.aTx, "");
      return;
    }
    var rc = a.rc, closed = !a.local && isClosed(a), my = a.my, answered = !!my, isRinging = ringing === a.id;
    var eta = (Array.isArray(a.eta) && a.eta.length ? a.eta : [5, 10]).slice(0, 2).map(function (m) { return parseInt(m, 10) || 5; });
    if (eta.length < 2) eta.push(10);
    var ts = alarmTs(a);
    setHTML(alarmEl.aHead, '<span class="badge' + ((isRinging || !answered) && !closed ? " pulse" : "") + '">' +
      (a.test ? "🧪 TEST ALARMU" : "🚨 ALARM") + "</span>" +
      '<div class="a-title">' + esc(a.title || "Alarm") + "</div>" + (a.text ? '<div class="a-text">' + esc(a.text) + "</div>" : "") +
      '<div class="a-meta" id="aMeta">godz. ' + hhmm(ts) + " · " + ago(ts) + "</div>" +
      (a.status === "uncertain" ? '<div class="a-warn">⚠ Niepewny odbiór sygnału – sprawdź na grupie, która jednostka</div>' : "") +
      (closed ? '<div class="a-warn">Zbiórka została zakończona.</div>' : ""));
    var ans = "";
    if (!closed && (!answered || changing)) {
      ans = '<div class="a-q">Zgłoś gotowość:</div><div class="stack">' +
        '<button class="btn go" data-act="answer" data-s="go">✅&nbsp; JADĘ</button><div class="row">' +
        eta.map(function (m) { return '<button class="btn eta" data-act="answer" data-s="eta" data-e="' + m + '">⏱ ' + m + " MIN</button>"; }).join("") +
        '</div><button class="btn no" data-act="answer" data-s="no">❌&nbsp; NIE JADĘ</button></div>';
    } else if (answered) {
      ans = '<div class="mine ' + esc(my.s) + '">' + esc(STQC.label(my)) + "<small>" + esc(STQC.stateLabel(my)) + "</small></div>" +
        (closed ? "" : '<button class="btn sec" data-act="change" style="margin-top:8px;min-height:46px">Zmień odpowiedź</button>');
    }
    setHTML(alarmEl.aAns, ans);
    setHTML(alarmEl.aSil, isRinging ? '<button class="btn sec" data-act="silence" style="margin-top:14px;background:#ffffff40">' +
      "🔇&nbsp; Wycisz syrenę</button>" + (cfg.sound !== "none" && audioLocked() ?
      '<div class="tapsound" data-act="sound">🔊 Dotknij, aby włączyć syrenę</div>' : "") : "");
    setHTML(alarmEl.aRc, rcHtml(a));
    setHTML(alarmEl.aTx, a.tx ? '<div class="tx">📝 Korespondencja (transkrypcja AI – może zawierać błędy):\n' + esc(a.tx) + "</div>" : "");
  }

  async function answer(s, e) {
    var id = shown;
    if (!id || !find(id)) return;
    changing = false;
    silence();
    await STQC.setMy(id, s, e, "sending");
    await reload();
    renderAll();
    clearBadge();
    sendResp(id, s, e);
  }

  async function sendResp(id, s, e) {
    if (String(id).indexOf("local.") === 0) {
      await STQC.setMyState(id, "sent");
      await reload();
      renderAll();
      return;
    }
    var token = {};
    sending[id] = token;
    var delay = 1000;
    for (var i = 0; i < 9; i++) {
      if (sending[id] !== token) return; // nowsza odpowiedź zastąpiła tę
      try {
        await STQC.publish(cfg, STQC.message(cfg, "resp", { id: id, s: s, e: e || 0, ts: Math.floor(Date.now() / 1000) }));
        if (sending[id] !== token) return;
        delete sending[id];
        await STQC.setMyState(id, "sent");
        await reload();
        renderAll();
        return;
      } catch (err) {
        if (i === 0) {
          await STQC.setMyState(id, "retry");
          await reload();
          renderAll();
        }
        await sleep(delay);
        delay = Math.min(delay * 2, 60000);
      }
    }
    if (sending[id] === token) {
      delete sending[id];
      await STQC.setMyState(id, "failed");
      await reload();
      renderAll();
    }
  }

  function resendPending() {
    alarms.forEach(function (a) {
      var my = a.my;
      if (!my || sending[a.id] || String(a.id).indexOf("local.") === 0) return;
      var age = Date.now() - (my.ts || 0);
      if (((my.state === "sending" || my.state === "retry") && age < 2 * 3600e3) || (my.state === "failed" && age < 30 * 60000)) {
        sendResp(a.id, my.s, my.e);
      }
    });
  }

  function sendAck(id) {
    if (String(id).indexOf("local.") === 0) return;
    STQC.publish(cfg, STQC.message(cfg, "ack", { id: id }))
      .then(function () { return STQC.putField(id, "acked", true); })
      .catch(function () { /* niekrytyczne */ });
  }

  function clearBadge() {
    if (navigator.clearAppBadge) navigator.clearAppBadge().catch(function () {});
  }

  // ================================================================== syrena (Web Audio)
  var actx = null, siren = null, wl = null;
  function audioCtx() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!actx) { try { actx = new AC(); } catch (e) { return null; } }
    return actx;
  }
  function audioLocked() { return !actx || actx.state !== "running"; }
  function playbackSession() {
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) { /* starszy iOS */ }
  }
  /** Gest użytkownika odblokowuje dźwięk (iOS) – wtedy syrena zagra przy alarmie, gdy aplikacja jest otwarta. */
  function unlockAudio(e) {
    var t = e && e.target && e.target.closest ? e.target.closest("[data-act]") : null;
    var stopping = !!(t && /^(answer|silence|closeAlarm|change)$/.test(t.dataset.act));
    if (stopping) sirenStop(); // dotknięcie JADĘ / Wycisz nie może na moment włączyć syreny
    playbackSession();
    var c = audioCtx();
    if (!c) return;
    if (c.state !== "running") c.resume().then(function () { renderAlarm(); }).catch(function () {});
    if (!unlockAudio.done) {
      try {
        var b = c.createBuffer(1, 1, 22050), src = c.createBufferSource();
        src.buffer = b;
        src.connect(c.destination);
        src.start(0);
        unlockAudio.done = true;
      } catch (e) { /* nic */ }
    }
    if (ringing && !siren && !stopping) sirenStart();
  }
  function sirenStart() {
    if (cfg.sound === "none") return;
    var c = audioCtx();
    if (!c) return;
    playbackSession();
    if (c.state !== "running") c.resume().catch(function () {});
    sirenStop();
    try {
      var now = c.currentTime;
      var o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = "sawtooth";
      o.frequency.value = 925;           // wycie 600 -> 1250 -> 600 Hz w 1,6 s (jak w aplikacji na Androida)
      lfo.type = "triangle";
      lfo.frequency.value = 0.625;
      lg.gain.value = 325;
      f.type = "lowpass";
      f.frequency.value = 2800;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.75, now + 0.15);
      lfo.connect(lg);
      lg.connect(o.frequency);
      o.connect(f);
      f.connect(g);
      g.connect(c.destination);
      o.start(now);
      lfo.start(now);
      siren = { o: o, lfo: lfo, g: g };
    } catch (e) { siren = null; }
  }
  function sirenStop() {
    if (!siren) return;
    try { siren.o.stop(); siren.lfo.stop(); siren.g.disconnect(); } catch (e) { /* już zatrzymana */ }
    siren = null;
  }
  async function wakeLock() {
    try {
      if (navigator.wakeLock && document.visibilityState === "visible") wl = await navigator.wakeLock.request("screen");
    } catch (e) { wl = null; }
  }
  function ring(id) {
    rung[id] = true;
    ringing = id;
    shown = id;
    changing = false;
    sirenStart();
    wakeLock();
    if (navigator.vibrate) { try { navigator.vibrate([900, 450, 900, 450, 900, 450, 900]); } catch (e) { /* brak */ } }
    clearTimeout(ringTimer);
    ringTimer = setTimeout(silence, Math.max(1, cfg.ringMin || 3) * 60000);
    renderAlarm();
  }
  function silence() {
    ringing = null;
    clearTimeout(ringTimer);
    sirenStop();
    if (wl) { try { wl.release(); } catch (e) { /* nic */ } wl = null; }
    if (navigator.vibrate) { try { navigator.vibrate(0); } catch (e) { /* brak */ } }
    renderAlarm();
  }
  ["pointerdown", "touchend", "keydown"].forEach(function (ev) {
    document.addEventListener(ev, unlockAudio, { capture: true, passive: true });
  });

  async function localTest() {
    unlockAudio();
    var id = "local." + Date.now();
    await STQC.addAlarm({ t: "alarm", id: id, title: "Test alarmu na tym telefonie", test: true, local: true,
      text: "Sprawdź głośność i ekran. Odpowiedź nie zostanie wysłana.", ts: Math.floor(Date.now() / 1000), recv: Date.now() });
    await reload();
    ring(id);
    renderAll();
  }

  // ================================================================== połączenie z serwerem ntfy (strumień SSE)
  function setConnected(on) {
    if (st.connected !== on) {
      st.connected = on;
      if (on) st.lastError = "";
      renderStatus();
    }
  }
  function connect(why) {
    if (!STQC.paired(cfg)) return;
    clearTimeout(st.timer);
    st.timer = 0;
    if (st.es) { try { st.es.close(); } catch (e) { /* zamknięte */ } st.es = null; }
    var gen = ++st.gen;
    var since = cfg.lastId || "12h";
    var es;
    try {
      es = new EventSource(STQC.base(cfg.server) + "/" + cfg.alarmTopic + "/sse?since=" + encodeURIComponent(since));
    } catch (e) {
      st.lastError = String(e && e.message || e);
      scheduleReconnect(gen);
      return;
    }
    st.es = es;
    es.addEventListener("open", function (ev) {
      if (gen !== st.gen) return;
      st.lastAct = Date.now();
      if (!ev.data) return; // otwarcie po stronie przeglądarki; czekamy na „open” z serwera (wtedy już słucha)
      st.backoff = 2000;
      setConnected(true);
      setTimeout(function () { if (gen === st.gen) catchUp(since); }, 3000);
      helloUntilLinked(true);
    });
    es.addEventListener("keepalive", function () {
      if (gen !== st.gen) return;
      st.lastAct = Date.now();
      setConnected(true);
    });
    es.onmessage = function (ev) {
      if (gen !== st.gen) return;
      st.lastAct = Date.now();
      setConnected(true);
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      enqueue(m, true);
    };
    es.onerror = function () {
      if (gen !== st.gen) return;
      st.lastError = navigator.onLine === false ? "Brak internetu" : "Serwer alarmów niedostępny";
      try { es.close(); } catch (e) { /* zamknięte */ }
      if (st.es === es) st.es = null;
      setConnected(false);
      scheduleReconnect(gen);
    };
  }
  function scheduleReconnect(gen) {
    clearTimeout(st.timer);
    st.timer = setTimeout(function () { st.timer = 0; if (gen === st.gen) connect("retry"); }, st.backoff);
    st.backoff = Math.min(st.backoff * 2, 60000);
  }
  /** Po połączeniu: jednorazowo pobierz wiadomości od „since” – nic nie przepadnie w chwili łączenia. */
  async function catchUp(since) {
    try {
      var r = await fetch(STQC.base(cfg.server) + "/" + cfg.alarmTopic + "/json?poll=1&since=" + encodeURIComponent(since),
        { cache: "no-store" });
      if (!r.ok) return;
      (await r.text()).split("\n").forEach(function (line) {
        if (!line.trim()) return;
        try { enqueue(JSON.parse(line), false); } catch (e) { /* zła linia */ }
      });
    } catch (e) { /* spróbujemy przy następnym połączeniu */ }
  }
  function enqueue(m, live) {
    queue = queue.then(function () { return handleEvent(m, live); }).catch(function (e) { console.warn("wiadomość:", e); });
  }
  async function handleEvent(m, live) {
    if (!m || m.event !== "message" || (m.topic && m.topic !== cfg.alarmTopic)) return;
    var id = m.id || "";
    if (id) {
      if (live && id !== cfg.lastId) cfg = await STQC.patchCfg({ lastId: id }); // nadrabianie nie cofa znacznika
      if (seen[id]) return;
      seen[id] = 1;
      seenQ.push(id);
      if (seenQ.length > 400) delete seen[seenQ.shift()];
    }
    var o = await STQC.decrypt(cfg.key, m.message || "");
    if (!o || typeof o !== "object") return; // nie nasza wiadomość / inny kod drużyny
    await onMessage(o, m.time || Math.floor(Date.now() / 1000), live);
  }

  async function onMessage(o, srv, live) {
    var t = o.t;
    if (t === "alarm") {
      if (!o.id) return;
      o.recv = Date.now();
      o.srv = srv;
      await STQC.addAlarm(o);
      await reload();
      var a = find(o.id), age = Date.now() / 1000 - srv, fresh = age < 600; // starsze niż 10 min – bez syreny
      if (a && fresh && !a.my && !rung[a.id] && live && !a.push) ring(a.id); // a.push: już zaalarmowało powiadomienie
      else if (a && fresh && !a.my && !shown && !dismissed[a.id] && !isClosed(a) &&
        document.visibilityState === "visible") openAlarm(a.id); // np. po otwarciu z powiadomienia
      if (a && !a.acked && age < 3600) sendAck(a.id);
      renderAll();
    } else if (t === "rc") {
      await STQC.putField(o.id, "rc", o);
      await reload();
      renderAll();
    } else if (t === "tx") {
      await STQC.putField(o.id, "tx", String(o.text || ""));
      await reload();
      renderAll();
    } else if (t === "welcome") {
      if (o.m !== cfg.member) return;
      var patch = { linkedAt: Date.now(), beaconAt: Math.max(cfg.beaconAt || 0, srv * 1000) };
      if (o.unit) patch.unit = String(o.unit);
      if (o.vapid) patch.vapid = String(o.vapid);
      cfg = await STQC.patchCfg(patch);
      if (st.waitingWelcome) {
        st.waitingWelcome = 0;
        toast("✅ Połączono z dekoderem: " + (o.unit || ""));
      }
      renderAll();
      if (o.push === false && PUSH_OK && pushState.sub && Notification.permission === "granted") {
        sendSub(pushState.sub, false).catch(function () {}); // dekoder nie ma subskrypcji (np. nowa baza) – wyślij ponownie
      } else syncPush();
    } else if (t === "beacon") {
      var p = { beaconAt: Math.max(cfg.beaconAt || 0, srv * 1000) };
      if (o.unit) p.unit = String(o.unit);
      if (o.vapid) p.vapid = String(o.vapid);
      cfg = await STQC.patchCfg(p);
      helloUntilLinked(false);
      renderAll();
      if (o.vapid && cfg.pushVapid && cfg.pushVapid !== cfg.vapid) syncPush();
    }
  }

  function hello() {
    STQC.patchCfg({ helloAt: Date.now() }).then(function (c) { cfg = c; }).catch(function () {});
    return STQC.publish(cfg, STQC.message(cfg, "hello", { dev: deviceName() }))
      .catch(function (e) { st.lastError = "Wysyłanie do dekodera: " + (e && e.message || e); renderStatus(); });
  }
  /** „hello” do dekodera, dopóki nie potwierdzi parowania – po połączeniu, potem co 2 min. */
  function helloUntilLinked(justConnected) {
    var now = Date.now();
    if (!cfg.linkedAt && now - st.lastHello > (justConnected ? 5000 : 120000)) {
      st.lastHello = now;
      hello();
    } else if (justConnected && cfg.linkedAt && now - (cfg.helloAt || 0) > 6 * 3600e3 && now - st.lastHello > 60000) {
      st.lastHello = now; // co kilka godzin: dekoder potwierdzi, że ma subskrypcję powiadomień tego telefonu
      hello();
    }
  }

  function tick() {
    if (!STQC.paired(cfg)) return;
    if (document.visibilityState === "visible") {
      if (st.es && st.lastAct && Date.now() - st.lastAct > 75000) connect("watchdog"); // ntfy: keepalive co 45 s
      else if (!st.es && !st.timer) connect("watchdog");
    }
    if (st.connected) helloUntilLinked(false);
    renderStatus();
    var meta = $("#aMeta"), a = shown && find(shown);
    if (meta && a) meta.textContent = "godz. " + hhmm(alarmTs(a)) + " · " + ago(alarmTs(a));
  }

  async function onVisible() {
    if (document.visibilityState !== "visible") return;
    await reload();
    if (!STQC.paired(cfg)) { if (view === "home") route(); return; }
    if (view !== "home") route();
    if (!st.connected || Date.now() - st.lastAct > 40000) connect("visible");
    else catchUp(cfg.lastId || "10m");
    resendPending();
    syncPush();
    maybeShowAlarm();
    if (ringing && !siren) sirenStart();
    renderAll();
  }

  async function onSwMessage(e) {
    var d = e.data || {};
    await reload();
    if (d.type === "open" && d.id) openAlarm(d.id);
    else if (d.type === "push" && d.t === "alarm" && d.id && document.visibilityState === "visible") {
      var a = find(d.id);
      if (a && !a.my && !rung[a.id]) ring(a.id);
    }
    renderAll();
  }

  // ================================================================== powiadomienia (Web Push)
  function sameKey(buf, b64) {
    if (!buf) return true; // przeglądarka nie podaje klucza – zakładamy zgodność
    var a = new Uint8Array(buf), b = STQC.b64uDecode(b64);
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  async function swReg() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      return await Promise.race([navigator.serviceWorker.ready, sleep(10000).then(function () { return null; })]);
    } catch (e) { return null; }
  }
  /** Wywoływane bezpośrednio z dotknięcia przycisku (iPhone pyta o zgodę tylko w geście użytkownika). */
  function enablePush() {
    if (!PUSH_OK) {
      howInstall();
      return;
    }
    if (!cfg.vapid) {
      toast("Czekam na klucz z dekodera – sprawdź, czy dekoder działa", true);
      st.lastHello = 0;
      helloUntilLinked(true);
      return;
    }
    pushState.busy = true;
    renderReady();
    var p;
    try { p = Notification.requestPermission(); } catch (e) { p = null; }
    Promise.resolve(p || Notification.permission).then(async function (perm) {
      if (perm !== "granted") {
        pushState.busy = false;
        renderAll();
        dialog("Powiadomienia wyłączone", IOS ? "<p>Włącz je w <b>Ustawienia → Powiadomienia → STQC Alarm</b> " +
          "(Pozwalaj na powiadomienia, Dźwięki, Ekran blokady), a potem wróć do aplikacji.</p>" :
          "<p>Zezwól stronie na powiadomienia (ikona kłódki obok adresu → Powiadomienia).</p>");
        return;
      }
      try {
        await subscribePush(true);
      } catch (e) {
        toast("Nie udało się włączyć powiadomień: " + (e && e.message || e), true);
      }
      pushState.busy = false;
      renderAll();
    });
  }
  async function subscribePush(confirm) {
    var reg = await swReg();
    if (!reg) throw new Error("brak service workera");
    var sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub.options && sub.options.applicationServerKey, cfg.vapid)) {
      await sub.unsubscribe().catch(function () {});
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: STQC.b64uDecode(cfg.vapid) });
    pushState.sub = sub;
    pushState.checked = true;
    await sendSub(sub, confirm);
  }
  async function sendSub(sub, confirm) {
    var j = sub.toJSON();
    await STQC.publish(cfg, STQC.message(cfg, "push", { sub: { endpoint: j.endpoint, keys: j.keys }, confirm: !!confirm,
      dev: deviceName() }));
    cfg = await STQC.patchCfg({ pushSentAt: Date.now(), pushEndpoint: j.endpoint, pushVapid: cfg.vapid });
    if (confirm) toast("🔔 Włączone – za chwilę przyjdzie potwierdzenie z dekodera");
    renderAll();
  }
  /** Przy starcie i powrocie do aplikacji: stan subskrypcji i odnowienie jej u dekodera (bez pytania użytkownika). */
  async function syncPush() {
    if (!PUSH_OK || !STQC.paired(cfg) || pushState.busy) return;
    var reg = await swReg();
    if (!reg) { pushState.checked = true; renderAll(); return; }
    var sub = null;
    try { sub = await reg.pushManager.getSubscription(); } catch (e) { sub = null; }
    pushState.sub = sub;
    pushState.checked = true;
    try {
      if (Notification.permission === "granted" && cfg.vapid) {
        var confirm = !cfg.pushOkAt; // jeszcze nie przyszło żadne powiadomienie – niech dekoder wyśle potwierdzenie
        if (!sub || (cfg.pushVapid && cfg.pushVapid !== cfg.vapid) || !sameKey(sub.options && sub.options.applicationServerKey, cfg.vapid)) {
          await subscribePush(confirm);
        } else if (cfg.pushEndpoint !== sub.endpoint || Date.now() - (cfg.pushSentAt || 0) > 24 * 3600e3) {
          await sendSub(sub, confirm);
        }
      }
    } catch (e) { /* użytkownik włączy przyciskiem */ }
    renderAll();
  }
  function testPush() {
    STQC.publish(cfg, STQC.message(cfg, "pushtest", { d: 10 }))
      .then(function () { toast("Za 10 s przyjdzie powiadomienie testowe – możesz zablokować telefon 🔒"); })
      .catch(function (e) { toast("Nie wysłano: " + (e && e.message || e), true); });
  }

  function howInstall() {
    dialog("Instalacja na iPhonie", '<ol class="steps">' +
      "<li><div>Otwórz <b>" + esc(location.origin + location.pathname) + "</b> w <b>Safari</b>.</div></li>" +
      "<li><div>Stuknij <b>Udostępnij</b> <span class=\"ico\">" + SHARE_ICO + "</span>.</div></li>" +
      "<li><div>Wybierz <b>„Do ekranu początkowego”</b> <span class=\"ico\">" + ADD_ICO + "</span> → <b>Dodaj</b>.</div></li>" +
      "<li><div>Uruchom <b>STQC Alarm</b> z ekranu początkowego i połącz go kodem drużyny.</div></li></ol>" +
      '<p class="hint">Wymagany iOS 16.4 lub nowszy. Aplikacja z ekranu początkowego ma osobną pamięć – trzeba ją połączyć ' +
      "jeszcze raz.</p>");
  }

  // ================================================================== ustawienia / rozłączanie
  async function saveMe() {
    var name = $("#sName").value.trim().replace(/\s+/g, " ").slice(0, 60);
    if (name.length < 2) { toast("Wpisz imię i nazwisko", true); return; }
    cfg = await STQC.patchCfg({ name: name, roles: checkedRoles("sRoles") });
    hello().then(function () { toast("Zapisano i wysłano do dekodera"); });
    renderAll();
  }
  async function unpair() {
    if (await dialog("Rozłączyć telefon?", "<p>Telefon przestanie odbierać alarmy jednostki.</p>",
      [["Anuluj"], ["Rozłącz"]]) !== 1) return;
    silence();
    shown = null;
    try { await STQC.publish(cfg, STQC.message(cfg, "bye"), 4000); } catch (e) { /* bez sieci */ }
    try {
      var reg = await swReg(), sub = reg && await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch (e) { /* brak subskrypcji */ }
    st.gen++;
    clearTimeout(st.timer);
    if (st.es) { try { st.es.close(); } catch (e) { /* zamknięte */ } st.es = null; }
    setConnected(false);
    st.lastAct = 0;
    pushState = { checked: false, sub: null, busy: false };
    cfg = await STQC.updateCfg(function (c) {
      return { member: c.member, name: c.name, roles: c.roles, server: c.server, sound: c.sound, ringMin: c.ringMin };
    });
    await STQC.clearAlarms();
    alarms = [];
    clearBadge();
    renderAlarm();
    route();
  }

  // ================================================================== obsługa dotknięć
  var ACTS = {
    answer: function (b) { answer(b.dataset.s, parseInt(b.dataset.e, 10) || 0); },
    change: function () { changing = true; renderAlarm(); },
    silence: function () { silence(); },
    sound: function () { unlockAudio(); },
    closeAlarm: function () { closeAlarm(); },
    openAlarm: function (b) { unlockAudio(); openAlarm(b.dataset.id); },
    localTest: function () { localTest(); },
    push: function () { enablePush(); },
    pushtest: function () { testPush(); },
    howInstall: function () { howInstall(); },
    unpair: function () { unpair(); },
    saveMe: function () { saveMe(); },
    browser: function () {
      try { sessionStorage.setItem("stqc-browser", "1"); } catch (e) { /* bez sessionStorage */ }
      showPair();
    },
    copyCode: function (b) { copy(b.dataset.code); },
    paste: function () {
      navigator.clipboard.readText().then(function (t) {
        var n = STQC.normalize(t);
        if (n.length >= 10) $("#pCode").value = STQC.format(n.slice(0, 10));
        else toast("W schowku nie ma kodu drużyny", true);
      }).catch(function () { toast("Brak dostępu do schowka – wpisz kod ręcznie", true); });
    },
    adv: function () { var s = $("#pServer"); s.hidden = !s.hidden; }
  };
  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b || b.disabled) return;
    var f = ACTS[b.dataset.act];
    if (f) { e.preventDefault(); f(b, e); }
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (!t || !t.dataset || !t.dataset.set) return;
    var patch = {};
    patch[t.dataset.set] = t.dataset.set === "ringMin" ? parseInt(t.value, 10) : t.value;
    STQC.patchCfg(patch).then(function (c) { cfg = c; });
  });

  // testy automatyczne: stan aplikacji
  window.__stqc = { state: function () { return { cfg: cfg, alarms: alarms, st: { connected: st.connected, lastError: st.lastError },
    shown: shown, ringing: ringing, push: { checked: pushState.checked, sub: !!pushState.sub, enabled: pushEnabled() }, view: view }; } };

  boot();
})();
