/* STQC Alarm (web) – część wspólna strony i service workera.
 * Kod drużyny -> tematy ntfy i klucz AES-256-GCM: dokładnie tak samo jak dekoder (app/mobile.py)
 * i aplikacja na Androida (Crypto.java). Sprawdzane testem tests/test_web.py. */
"use strict";
var STQC = (function () {
  var VERSION = "1.0.1";
  var APP = "web-" + VERSION;
  var ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  var PREFIX = "S1.";
  var DEFAULT_SERVER = "https://ntfy.sh";
  var MAX_ALARMS = 25;
  var te = new TextEncoder(), td = new TextDecoder();
  var AAD = te.encode("stqc1");
  var SALT = te.encode("stqc-team-key-v1");
  var ITER = 100000;

  // ------------------------------------------------------------------ kod drużyny
  /** „7kq2m 9xa4t” / „7KQ2M-9XA4T” -> „7KQ2M9XA4T” (O->0, I/L->1, inne znaki pomijane). */
  function normalize(code) {
    var s = String(code || "").replace(/[^0-9A-Za-z]/g, "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
    var out = "";
    for (var i = 0; i < s.length; i++) if (ALPHABET.indexOf(s[i]) >= 0) out += s[i];
    return out;
  }
  function format(norm) { return norm.length === 10 ? norm.slice(0, 5) + "-" + norm.slice(5) : norm; }
  function base(server) {
    var s = String(server || "").trim().replace(/\/+$/, "");
    if (!s) s = DEFAULT_SERVER;
    if (!/^https?:\/\//.test(s)) s = "https://" + s;
    return s;
  }

  // ------------------------------------------------------------------ base64url / hex
  function b64u(bytes) {
    var b = new Uint8Array(bytes), s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64uDecode(str) {
    var s = String(str).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hex(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }
  function randomHex(n) { return hex(crypto.getRandomValues(new Uint8Array(n))); }

  // ------------------------------------------------------------------ kryptografia
  function sha256hex(s) { return crypto.subtle.digest("SHA-256", te.encode(s)).then(hex); }

  /** Tematy ntfy i klucz z kodu drużyny (PBKDF2-HMAC-SHA256, 100 000 iteracji, 256 bitów). */
  async function derive(norm) {
    var a = await sha256hex("stqc/v1/alarm/" + norm), r = await sha256hex("stqc/v1/resp/" + norm);
    var pw = await crypto.subtle.importKey("raw", te.encode(norm), "PBKDF2", false, ["deriveBits"]);
    var bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: SALT, iterations: ITER, hash: "SHA-256" }, pw, 256);
    return { alarmTopic: "stqc_a_" + a.slice(0, 32), respTopic: "stqc_r_" + r.slice(0, 32), key: b64u(bits) };
  }

  var keyCache = {};
  function aesKey(keyB64) {
    if (!keyCache[keyB64]) {
      keyCache[keyB64] = crypto.subtle.importKey("raw", b64uDecode(keyB64), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    }
    return keyCache[keyB64];
  }

  async function encrypt(keyB64, obj) {
    var nonce = crypto.getRandomValues(new Uint8Array(12));
    var ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: AAD, tagLength: 128 },
      await aesKey(keyB64), te.encode(JSON.stringify(obj))));
    var out = new Uint8Array(12 + ct.length);
    out.set(nonce, 0);
    out.set(ct, 12);
    return PREFIX + b64u(out);
  }

  /** Obiekt albo null, gdy to nie nasza wiadomość / zły klucz. */
  async function decrypt(keyB64, payload) {
    if (!keyB64 || typeof payload !== "string" || payload.indexOf(PREFIX) !== 0) return null;
    try {
      var raw = b64uDecode(payload.slice(PREFIX.length).trim());
      if (raw.length < 12 + 16) return null;
      var pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12), additionalData: AAD, tagLength: 128 },
        await aesKey(keyB64), raw.slice(12));
      return JSON.parse(td.decode(pt));
    } catch (e) {
      return null;
    }
  }

  // ------------------------------------------------------------------ magazyn (IndexedDB – wspólny ze service workerem)
  var dbp = null;
  function idb() {
    if (!dbp) {
      dbp = new Promise(function (res, rej) {
        var r = indexedDB.open("stqc-alarm", 1);
        r.onupgradeneeded = function () { r.result.createObjectStore("kv"); };
        r.onsuccess = function () {
          var d = r.result;
          d.onversionchange = function () { d.close(); dbp = null; };
          d.onclose = function () { dbp = null; };
          res(d);
        };
        r.onerror = function () { dbp = null; rej(r.error); };
        r.onblocked = function () { dbp = null; rej(new Error("baza zablokowana")); };
      });
    }
    return dbp;
  }
  async function kvGet(k) {
    var d = await idb();
    return new Promise(function (res, rej) {
      var q = d.transaction("kv").objectStore("kv").get(k);
      q.onsuccess = function () { res(q.result); };
      q.onerror = function () { rej(q.error); };
    });
  }
  /** Odczyt-zmiana-zapis w jednej transakcji (strona i service worker nie nadpiszą sobie zmian). fn – synchroniczna. */
  async function kvUpdate(k, fn) {
    var d = await idb();
    return new Promise(function (res, rej) {
      var t = d.transaction("kv", "readwrite"), st = t.objectStore("kv"), out;
      var q = st.get(k);
      q.onsuccess = function () {
        out = fn(q.result);
        st.put(out, k);
      };
      t.oncomplete = function () { res(out); };
      t.onerror = function () { rej(t.error); };
      t.onabort = function () { rej(t.error || new Error("transakcja przerwana")); };
    });
  }

  function getCfg() { return kvGet("cfg").then(function (c) { return c || {}; }); }
  function updateCfg(fn) { return kvUpdate("cfg", function (c) { return fn(c || {}) || c || {}; }); }
  function patchCfg(p) { return updateCfg(function (c) { return Object.assign(c, p); }); }
  function paired(c) { return !!(c && c.key && c.alarmTopic && c.respTopic); }

  function alarms() { return kvGet("alarms").then(function (a) { return Array.isArray(a) ? a : []; }); }
  /** Dodaje alarm na początek historii. Zwraca true, jeśli to nowy alarm. */
  async function addAlarm(a) {
    var isNew = false;
    await kvUpdate("alarms", function (list) {
      list = Array.isArray(list) ? list : [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === a.id) {
          for (var k in a) if (!(k in list[i])) list[i][k] = a[k]; // uzupełnij brakujące pola
          return list;
        }
      }
      isNew = true;
      return [a].concat(list).slice(0, MAX_ALARMS);
    });
    return isNew;
  }
  function alarmUpdate(id, fn) {
    return kvUpdate("alarms", function (list) {
      list = Array.isArray(list) ? list : [];
      for (var i = 0; i < list.length; i++) if (list[i].id === id) { fn(list[i]); break; }
      return list;
    });
  }
  function putField(id, field, value) { return alarmUpdate(id, function (a) { a[field] = value; }); }
  /** Moja odpowiedź: s = go|eta|no, state = sending|sent|retry|failed. */
  function setMy(id, s, e, state) { return putField(id, "my", { s: s, e: e || 0, state: state, ts: Date.now() }); }
  function setMyState(id, state) { return alarmUpdate(id, function (a) { if (a.my) a.my.state = state; }); }
  function clearAlarms() { return kvUpdate("alarms", function () { return []; }); }

  // ------------------------------------------------------------------ do dekodera (temat odpowiedzi)
  function message(c, t, extra) {
    return Object.assign({ v: 1, t: t, m: c.member, n: c.name || "", r: c.roles || [], app: APP }, extra || {});
  }
  async function publish(c, obj, timeoutMs) {
    var body = await encrypt(c.key, obj);
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs || 15000) : 0;
    try {
      var r = await fetch(base(c.server) + "/" + c.respTopic, { method: "POST", body: body, cache: "no-store",
        signal: ctl ? ctl.signal : undefined });
      if (!r.ok) throw new Error(r.status === 429 ? "limit serwera ntfy (429)" : "HTTP " + r.status);
      return true;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function label(my) {
    if (!my) return "";
    if (my.s === "go") return "✅ Jadę";
    if (my.s === "eta") return "⏱ Będę za " + (my.e || 0) + " min";
    return "❌ Nie jadę";
  }
  function stateLabel(my) {
    var st = my && my.state;
    if (st === "sent") return "wysłano";
    if (st === "failed") return "BŁĄD wysyłania – sprawdź internet";
    if (st === "retry") return "brak sieci – ponawiam…";
    return "wysyłanie…";
  }

  return {
    VERSION: VERSION, APP: APP, DEFAULT_SERVER: DEFAULT_SERVER, normalize: normalize, format: format, base: base,
    b64u: b64u, b64uDecode: b64uDecode, randomHex: randomHex, sha256hex: sha256hex, derive: derive,
    encrypt: encrypt, decrypt: decrypt, getCfg: getCfg, updateCfg: updateCfg, patchCfg: patchCfg, paired: paired,
    alarms: alarms, addAlarm: addAlarm, alarmUpdate: alarmUpdate, putField: putField, setMy: setMy,
    setMyState: setMyState, clearAlarms: clearAlarms, message: message, publish: publish, label: label,
    stateLabel: stateLabel
  };
})();
