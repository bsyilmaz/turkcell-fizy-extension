// popup.js — açılır pencere mantığı.
//
// Sorumluluklar:
//   • Anahtar ayarları yükle/kaydet (Akıllı Duraklat, İçerik Köprüsü)
//   • Durum kartını ve "şu an çalıyor" önizlemesini canlı tut
//   • NVIDIA Build API anahtarını yönet (kaydet, test et, temizle)
//
// Güvenlik: tüm dinamik metin textContent ile yazılır (XSS yok).

"use strict";

const FIZY_URL_GLOB = "https://listen.fizy.com/*";

const Messages = Object.freeze({
  SETTINGS_CHANGED: "SETTINGS_CHANGED",
  SIDEBAR_TOGGLE: "SIDEBAR_TOGGLE",
  GET_STATE: "GET_STATE",
  TEST_API_KEY: "TEST_API_KEY",
});

const StorageKeys = Object.freeze({
  SMART_PAUSE: "smartPauseEnabled",
  SIDEBAR: "sidebarEnabled",
  API_KEY: "nvidiaApiKey",
});

const REFRESH_INTERVAL_MS = 2000;

const els = {
  smartPause: document.getElementById("smartPause"),
  sidebar: document.getElementById("sidebar"),
  statusCard: document.getElementById("statusCard"),
  statusText: document.getElementById("statusText"),
  nowPlaying: document.getElementById("nowPlaying"),
  nowArtist: document.getElementById("nowArtist"),
  nowTrack: document.getElementById("nowTrack"),
  aiSection: document.getElementById("aiSection"),
  aiToggle: document.getElementById("aiToggle"),
  aiPanel: document.getElementById("aiPanel"),
  aiStatus: document.getElementById("aiStatus"),
  apiKey: document.getElementById("apiKey"),
  showApiKey: document.getElementById("showApiKey"),
  saveApiKey: document.getElementById("saveApiKey"),
  clearApiKey: document.getElementById("clearApiKey"),
  aiFeedback: document.getElementById("aiFeedback"),
};

let refreshTimer = null;

// ===== Yardımcılar =====

const queryFizyTabs = () =>
  chrome.tabs.query({ url: FIZY_URL_GLOB });

function sendToTabSafe(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function sendToBackground(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function setStatus(state, text) {
  els.statusCard.dataset.state = state;
  els.statusText.textContent = text;
}

function setNowPlaying(artist, track) {
  if (!artist && !track) {
    els.nowPlaying.hidden = true;
    return;
  }
  els.nowArtist.textContent = artist || "—";
  els.nowTrack.textContent = track || "—";
  els.nowPlaying.hidden = false;
}

function setAiState(state, statusText) {
  els.aiSection.dataset.state = state;
  els.aiStatus.textContent = statusText;
}

function showFeedback(kind, text) {
  if (!text) {
    els.aiFeedback.hidden = true;
    els.aiFeedback.textContent = "";
    return;
  }
  els.aiFeedback.dataset.kind = kind;
  els.aiFeedback.textContent = text;
  els.aiFeedback.hidden = false;
}

// ===== Ayar yükleme =====

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    StorageKeys.SMART_PAUSE,
    StorageKeys.SIDEBAR,
    StorageKeys.API_KEY,
  ]);
  els.smartPause.checked = stored[StorageKeys.SMART_PAUSE] ?? true;
  els.sidebar.checked = stored[StorageKeys.SIDEBAR] ?? true;
  const apiKey = stored[StorageKeys.API_KEY];
  if (apiKey) {
    els.apiKey.value = apiKey;
    setAiState("connected", "Bağlı — AI üretimi içerik aktif");
  } else {
    setAiState("empty", "Bağlı değil — mock veri kullanılıyor");
  }
}

async function refreshStatus() {
  const tabs = await queryFizyTabs();
  if (tabs.length === 0) {
    setStatus("warn", "fizy sekmesi bulunamadı. listen.fizy.com'u açın.");
    setNowPlaying("", "");
    return;
  }
  setStatus(
    "active",
    tabs.length === 1
      ? "Aktif — 1 fizy sekmesi izleniyor"
      : `Aktif — ${tabs.length} fizy sekmesi izleniyor`
  );

  const state = await sendToTabSafe(tabs[0].id, { type: Messages.GET_STATE });
  if (state && (state.artist || state.track)) {
    setNowPlaying(state.artist, state.track);
  } else {
    setNowPlaying("", "");
  }
}

// ===== Sidebar yayını =====

async function broadcastSidebarToggle(enabled) {
  const tabs = await queryFizyTabs();
  for (const tab of tabs) {
    sendToTabSafe(tab.id, { type: Messages.SIDEBAR_TOGGLE, enabled });
  }
}

// ===== API anahtarı yönetimi =====

async function saveAndTestApiKey() {
  const key = els.apiKey.value.trim();
  if (!key) {
    showFeedback("error", "Anahtar boş olamaz.");
    return;
  }
  els.saveApiKey.disabled = true;
  showFeedback("loading", "Test ediliyor…");

  const result = await sendToBackground({
    type: Messages.TEST_API_KEY,
    apiKey: key,
  });

  if (result?.ok) {
    await chrome.storage.local.set({ [StorageKeys.API_KEY]: key });
    // Cache'i temizle ki yeni API key ile taze veri gelsin
    await chrome.storage.local.remove("artistCache");
    setAiState("connected", "Bağlı — AI üretimi içerik aktif");
    showFeedback("ok", "✓ Anahtar geçerli ve kaydedildi.");
  } else {
    setAiState("error", "Geçersiz anahtar");
    showFeedback("error", result?.reason || "Anahtar test edilemedi.");
  }
  els.saveApiKey.disabled = false;
}

async function clearApiKey() {
  els.apiKey.value = "";
  await chrome.storage.local.remove([StorageKeys.API_KEY, "artistCache"]);
  setAiState("empty", "Bağlı değil — mock veri kullanılıyor");
  showFeedback("ok", "Anahtar temizlendi.");
}

function toggleApiKeyVisibility() {
  const show = els.apiKey.type === "password";
  els.apiKey.type = show ? "text" : "password";
  els.showApiKey.setAttribute("aria-pressed", String(show));
  els.showApiKey.setAttribute(
    "aria-label",
    show ? "Anahtarı gizle" : "Anahtarı göster"
  );
}

function toggleAiPanel() {
  const expanded = els.aiToggle.getAttribute("aria-expanded") === "true";
  els.aiToggle.setAttribute("aria-expanded", String(!expanded));
  els.aiPanel.hidden = expanded;
  if (!expanded) {
    showFeedback(null, "");
  }
}

// ===== Olay dinleyicileri =====

els.smartPause.addEventListener("change", async () => {
  await chrome.storage.local.set({
    [StorageKeys.SMART_PAUSE]: els.smartPause.checked,
  });
  sendToBackground({ type: Messages.SETTINGS_CHANGED });
});

els.sidebar.addEventListener("change", async () => {
  await chrome.storage.local.set({
    [StorageKeys.SIDEBAR]: els.sidebar.checked,
  });
  await broadcastSidebarToggle(els.sidebar.checked);
});

els.aiToggle.addEventListener("click", toggleAiPanel);
els.saveApiKey.addEventListener("click", saveAndTestApiKey);
els.clearApiKey.addEventListener("click", clearApiKey);
els.showApiKey.addEventListener("click", toggleApiKeyVisibility);

// ===== Başlatma =====

async function init() {
  await loadSettings();
  await refreshStatus();
  refreshTimer = setInterval(refreshStatus, REFRESH_INTERVAL_MS);
}

window.addEventListener("unload", () => {
  if (refreshTimer !== null) clearInterval(refreshTimer);
});

init();
