// background.js — fizy Yardımcı servis çalışanı (v2).
//
// Sorumluluklar:
//   1) Akıllı Duraklat — fizy DIŞINDA bir sekme ses çıkarınca fizy'i durdur;
//      ses bitince devam ettir.
//   2) Sanatçı bilgisi getir — NVIDIA Build (Llama 3.1) API'sine istek at,
//      sonucu yerel cache'le.
//   3) Popup ayar değişikliklerine tepki ver.
//
// MV3 dayanıklılık kararları (mühendislik denetimi sonrası):
//   • Servis çalışanı ~30 sn'de unload olur; bu yüzden duraklatma durumu
//     SADECE bellekte tutulamaz — chrome.storage.session'a kalıcılaştırılır.
//     SW uyanınca durum kaybolmaz → "sonsuza dek duraklatılı kalma" bug'ı yok.
//   • Resume için kısa setTimeout (SW canlıyken hızlı) + periyodik
//     chrome.alarms güvenlik ağı (timer kaybolsa bile ~30 sn'de kurtarır).
//   • evaluateState bir promise zinciriyle serileştirilir (scheduleEvaluate)
//     → eşzamanlı olaylarda yarış koşulu / tutarsız PAUSE/RESUME yok.
//
// Güvenlik:
//   • API anahtarı yalnız service worker context'inde okunur — content
//     script'e veya sayfa DOM'una sızmaz.
//   • Cache: 7 gün TTL, en fazla 50 sanatçı (FIFO budama).
//   • Mesaj tip-doğrulamalı; tanınmayan tipler sessizce atılır.

"use strict";

// ===== Sabitler =====

const FIZY_URL_GLOB = "https://listen.fizy.com/*";
const FIZY_URL_PATTERN = /^https:\/\/listen\.fizy\.com/;
const RESUME_DELAY_MS = 800;
const RECOVERY_ALARM = "smart-pause-recovery";
const RECOVERY_PERIOD_MIN = 0.5; // alarms minimumu — güvenlik ağı

const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL = "meta/llama-3.1-70b-instruct";
const ARTIST_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün
const ARTIST_CACHE_MAX = 50;

const Messages = Object.freeze({
  PAUSE: "FIZY_PAUSE",
  RESUME: "FIZY_RESUME",
  SETTINGS_CHANGED: "SETTINGS_CHANGED",
  FETCH_ARTIST_INFO: "FETCH_ARTIST_INFO",
  TEST_API_KEY: "TEST_API_KEY",
});

const StorageKeys = Object.freeze({
  SMART_PAUSE: "smartPauseEnabled",
  SIDEBAR: "sidebarEnabled",
  API_KEY: "nvidiaApiKey",
  ARTIST_CACHE: "artistCache",
  PAUSED_TABS: "pausedFizyTabs", // storage.session
});

// ===== Akıllı Duraklat state =====

// resumeTimers yalnız bellekte (SW canlıyken hızlı resume için); kaybolursa
// recovery alarmı kurtarır. Asıl gerçek (hangi sekme bizim tarafımızdan
// duraklatıldı) chrome.storage.session'da tutulur.
const resumeTimers = new Map(); // tabId -> timeoutId

// ===== Yardımcılar =====

async function findFizyTab() {
  const tabs = await chrome.tabs.query({ url: FIZY_URL_GLOB });
  return tabs[0] ?? null;
}

async function findAudibleNonFizyTab() {
  const audible = await chrome.tabs.query({ audible: true });
  return audible.find((tab) => !FIZY_URL_PATTERN.test(tab.url ?? "")) ?? null;
}

async function getSetting(key, fallback) {
  const stored = await chrome.storage.local.get(key);
  return stored[key] ?? fallback;
}

function sendToTab(tabId, message) {
  try {
    chrome.tabs.sendMessage(tabId, message, () => {
      void chrome.runtime.lastError;
    });
  } catch (_) {
    // ignore
  }
}

function clearResumeTimer(tabId) {
  const timer = resumeTimers.get(tabId);
  if (timer !== undefined) {
    clearTimeout(timer);
    resumeTimers.delete(tabId);
  }
}

// ===== Duraklatılmış sekmelerin kalıcı durumu (storage.session) =====

async function getPausedTabs() {
  try {
    const s = await chrome.storage.session.get(StorageKeys.PAUSED_TABS);
    return s[StorageKeys.PAUSED_TABS] ?? {};
  } catch (_) {
    return {};
  }
}

async function setPausedTabs(map) {
  try {
    await chrome.storage.session.set({ [StorageKeys.PAUSED_TABS]: map });
  } catch (_) {
    // ignore
  }
}

function ensureRecoveryAlarm() {
  // Periyodik güvenlik ağı: timer kaybolsa bile SW'yi uyandırıp yeniden
  // değerlendirir; en kötü durumda kalıcı duraklama ~30 sn'ye iner.
  chrome.alarms.create(RECOVERY_ALARM, {
    periodInMinutes: RECOVERY_PERIOD_MIN,
  });
}

async function clearRecoveryAlarmIfIdle() {
  const paused = await getPausedTabs();
  if (Object.keys(paused).length === 0) {
    chrome.alarms.clear(RECOVERY_ALARM);
  }
}

// ===== Akıllı Duraklat çekirdeği =====

async function evaluateState() {
  const fizyTab = await findFizyTab();
  const paused = await getPausedTabs();

  // fizy sekmesi yoksa: artık geçerli olmayan duraklatma kayıtlarını temizle.
  if (!fizyTab) {
    if (Object.keys(paused).length > 0) {
      await setPausedTabs({});
      await clearRecoveryAlarmIfIdle();
    }
    return;
  }

  const fizyId = fizyTab.id;
  const enabled = await getSetting(StorageKeys.SMART_PAUSE, true);

  // Özellik kapalı: bizim duraklattığımız varsa devam ettir.
  if (!enabled) {
    if (paused[fizyId]) {
      delete paused[fizyId];
      await setPausedTabs(paused);
      clearResumeTimer(fizyId);
      sendToTab(fizyId, { type: Messages.RESUME });
      await clearRecoveryAlarmIfIdle();
    }
    return;
  }

  const audibleOther = await findAudibleNonFizyTab();

  if (audibleOther) {
    // Başka sekme ses çıkarıyor → bekleyen resume'u iptal et, gerekirse duraklat.
    clearResumeTimer(fizyId);
    if (!paused[fizyId]) {
      paused[fizyId] = { reasonTabId: audibleOther.id };
      await setPausedTabs(paused);
      sendToTab(fizyId, { type: Messages.PAUSE });
      ensureRecoveryAlarm();
    }
    return;
  }

  // Sessizlik: biz duraklattıysak kısa gecikmeyle devam ettir.
  if (paused[fizyId]) {
    clearResumeTimer(fizyId);
    const timer = setTimeout(() => {
      resumeTimers.delete(fizyId);
      // Idempotent: güncel durumu yeniden oku.
      (async () => {
        const p = await getPausedTabs();
        if (!p[fizyId]) return;
        // Bu arada yeniden ses çıkmış olabilir — son bir kontrol.
        const stillOther = await findAudibleNonFizyTab();
        if (stillOther) return;
        delete p[fizyId];
        await setPausedTabs(p);
        sendToTab(fizyId, { type: Messages.RESUME });
        await clearRecoveryAlarmIfIdle();
      })();
    }, RESUME_DELAY_MS);
    resumeTimers.set(fizyId, timer);
  } else {
    await clearRecoveryAlarmIfIdle();
  }
}

// evaluateState'i serileştir — eşzamanlı olaylarda yarış koşulu olmasın.
let evalChain = Promise.resolve();
function scheduleEvaluate() {
  evalChain = evalChain.then(() => evaluateState().catch(() => {}));
  return evalChain;
}

// ===== Sanatçı bilgisi cache =====

async function getArtistCache() {
  const stored = await chrome.storage.local.get(StorageKeys.ARTIST_CACHE);
  return stored[StorageKeys.ARTIST_CACHE] ?? {};
}

async function readCachedArtist(key) {
  const cache = await getArtistCache();
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > ARTIST_CACHE_TTL_MS) return null;
  return entry.data;
}

async function writeCachedArtist(key, data) {
  const cache = await getArtistCache();
  cache[key] = { ts: Date.now(), data };

  // Cache boyutunu sınırla (en eski entry'leri at)
  const keys = Object.keys(cache);
  if (keys.length > ARTIST_CACHE_MAX) {
    keys.sort((a, b) => cache[a].ts - cache[b].ts);
    const toDrop = keys.length - ARTIST_CACHE_MAX;
    for (let i = 0; i < toDrop; i++) delete cache[keys[i]];
  }

  await chrome.storage.local.set({ [StorageKeys.ARTIST_CACHE]: cache });
}

// ===== NVIDIA Build API =====

function buildArtistPrompt(artistName) {
  return `Müzisyen adı: "${artistName}"

Bu sanatçı hakkında SADECE aşağıdaki JSON formatında yanıt ver. Markdown, açıklama, başlık veya başka herhangi bir metin EKLEME.

{
  "bio": "<Türkçe, 2-3 cümlelik biyografi: stil/tür, etkin olduğu dönem, önemli katkılar>",
  "similar": ["<benzer sanatçı 1>", "<benzer sanatçı 2>", "<benzer sanatçı 3>", "<benzer sanatçı 4>"],
  "topTracks": ["<şarkı 1>", "<şarkı 2>", "<şarkı 3>", "<şarkı 4>", "<şarkı 5>"],
  "concert": null
}

Sanatçı az bilinen biri olsa bile en iyi tahminini ver. Tüm metinler Türkçe olsun. Yanıt YALNIZCA bu JSON nesnesi olsun — başka hiçbir şey YOK.`;
}

function extractJsonObject(content) {
  // LLM ``` code-fence ile sarabilir; temizle
  const cleaned = String(content || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  // İlk { ile son } arasını dene (LLM'in başına/sonuna metin eklemesine karşı)
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return null;
  try {
    return JSON.parse(cleaned.slice(first, last + 1));
  } catch (_) {
    return null;
  }
}

function isValidArtistShape(obj) {
  return (
    obj &&
    typeof obj === "object" &&
    typeof obj.bio === "string" &&
    Array.isArray(obj.similar) &&
    Array.isArray(obj.topTracks)
  );
}

async function callNvidiaApi(apiKey, prompt) {
  const res = await fetch(NVIDIA_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Sen müzik sanatçıları konusunda uzman bir asistansın. " +
            "Verilen sanatçı için yalnızca geçerli JSON üretirsin — " +
            "markdown ya da açıklama eklemezsin.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 600,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, details: text.slice(0, 300) };
  }
  const json = await res.json();
  return { ok: true, json };
}

async function fetchArtistFromLLM(artistName) {
  const apiKey = await getSetting(StorageKeys.API_KEY, null);
  if (!apiKey) return { error: "NO_API_KEY" };

  try {
    const result = await callNvidiaApi(apiKey, buildArtistPrompt(artistName));
    if (!result.ok) {
      return {
        error: `API_${result.status}`,
        details: result.details,
      };
    }
    const content = result.json?.choices?.[0]?.message?.content;
    const parsed = extractJsonObject(content);
    if (!isValidArtistShape(parsed)) {
      return { error: "INVALID_SHAPE", details: String(content).slice(0, 200) };
    }
    // Normalize
    return {
      data: {
        bio: parsed.bio.trim(),
        similar: parsed.similar.map(String).filter(Boolean).slice(0, 6),
        topTracks: parsed.topTracks.map(String).filter(Boolean).slice(0, 6),
        concert: parsed.concert || null,
      },
    };
  } catch (e) {
    return { error: "FETCH_FAILED", details: String(e?.message || e) };
  }
}

// ===== Test API key (popup'tan çağrılır) =====

async function testApiKey(apiKey) {
  try {
    const res = await fetch(NVIDIA_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5,
        temperature: 0,
      }),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401) return { ok: false, reason: "Geçersiz anahtar" };
    return { ok: false, reason: `Sunucu hatası ${res.status}` };
  } catch (e) {
    return { ok: false, reason: `Bağlantı hatası: ${e?.message || e}` };
  }
}

// ===== Olay dinleyicileri =====

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.audible !== undefined) scheduleEvaluate();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const paused = await getPausedTabs();
  if (paused[tabId]) {
    delete paused[tabId];
    await setPausedTabs(paused);
  }
  clearResumeTimer(tabId);
  scheduleEvaluate();
});

chrome.tabs.onCreated.addListener(() => {
  scheduleEvaluate();
});

chrome.tabs.onActivated.addListener(() => {
  scheduleEvaluate();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECOVERY_ALARM) scheduleEvaluate();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  // Senkron: ayar değişti
  if (message.type === Messages.SETTINGS_CHANGED) {
    scheduleEvaluate();
    return false;
  }

  // Asenkron: sanatçı bilgisi getir
  if (message.type === Messages.FETCH_ARTIST_INFO) {
    (async () => {
      const key = String(message.artist ?? "").toLowerCase().trim();
      if (!key) {
        sendResponse({ data: null });
        return;
      }
      // 1) Cache
      const cached = await readCachedArtist(key);
      if (cached) {
        sendResponse({ data: cached, source: "cache" });
        return;
      }
      // 2) LLM
      const result = await fetchArtistFromLLM(message.artist);
      if (result.data) {
        await writeCachedArtist(key, result.data);
        sendResponse({ data: result.data, source: "llm" });
        return;
      }
      sendResponse({ data: null, error: result.error });
    })();
    return true; // async response için
  }

  // Asenkron: API anahtarı testi
  if (message.type === Messages.TEST_API_KEY) {
    (async () => {
      const result = await testApiKey(String(message.apiKey || ""));
      sendResponse(result);
    })();
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get([
    StorageKeys.SMART_PAUSE,
    StorageKeys.SIDEBAR,
  ]);
  await chrome.storage.local.set({
    [StorageKeys.SMART_PAUSE]: current[StorageKeys.SMART_PAUSE] ?? true,
    [StorageKeys.SIDEBAR]: current[StorageKeys.SIDEBAR] ?? true,
  });
});

// SW her başladığında (install/update/uyanma) durumu bir kez değerlendir —
// kalıcı durum storage.session'dan okunur, kayıp resume'lar kurtarılır.
scheduleEvaluate();
