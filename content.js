// content.js — fizy Yardımcı içerik scripti (v3 · "Obsidian & Glass").
//
// Modüler yapı:
//   • Player    — sayfadaki çaları kontrol eder (pause/resume)
//   • Detector  — çalan sanatçı/şarkı + albüm kapağı algılaması
//   • Sidebar   — premium "Obsidian & Glass" yan panel (güvenli DOM API)
//   • Bridge    — background ve popup ile mesajlaşma
//
// Tasarım dili: derin obsidyen siyahı, camımsı yüzeyler (ince ışık kenarları),
// tek modern sans-serif tipografi, çalan albümün kapağından sızan dinamik
// glow, kapak altında incecik zarif ses dalgası. Monokrom — tek renk kaynağı
// albüm kapağıdır.
//
// Mühendislik (denetim sonrası, korunur):
//   • pause() yalnız "Duraklat", resume() yalnız "Oynat" butonunu kullanır.
//   • render() reqId token'ı ile bayat içeriğe karşı korunur.
//   • İki-fazlı render: await öncesi iskelet, sonrası gerçek içerik.
//   • Çalar barına debounce'lu MutationObserver ile anlık tespit.
//
// Güvenlik:
//   • Veri kaynaklı hiçbir alan innerHTML ile yazılmaz; tüm dinamik içerik
//     createElement + textContent ile inşa edilir → XSS yok.
//   • innerHTML yalnız eklenti-kontrollü, sabit SVG ikon şablonları için.
//   • Albüm kapağı URL'i <img>.src ile (DOM API) atanır — CSS string'e
//     enjekte edilmez; yalnızca görüntü yüklenir, canvas okunmaz.

(() => {
  "use strict";

  // ===================================================================
  // Sabitler
  // ===================================================================

  const Messages = Object.freeze({
    PAUSE: "FIZY_PAUSE",
    RESUME: "FIZY_RESUME",
    SIDEBAR_TOGGLE: "SIDEBAR_TOGGLE",
    GET_STATE: "GET_STATE",
    FETCH_ARTIST_INFO: "FETCH_ARTIST_INFO",
  });

  const Config = Object.freeze({
    POLL_FALLBACK_MS: 3000,
    INITIAL_DETECTION_DELAY_MS: 400,
    OBSERVER_DEBOUNCE_MS: 120,
    SIDEBAR_ID: "fizy-yardimci-sidebar",
    PANEL_ID: "fizy-yardimci-panel",
    PLAYER_BAR_SELECTOR: '[class*="Audio_audioPlayerSection"]',
    SIDEBAR_STORAGE_KEY: "sidebarEnabled",
    VIS_BARS: 36,
  });

  // ===================================================================
  // Durum
  // ===================================================================

  const state = {
    pausedByExtension: false,
    artistKey: null,
    artistDisplay: "",
    track: "",
    cover: "",
    sidebarEnabled: true,
    playing: true,
  };

  function normalizeKey(s) {
    return (s ?? "")
      .replace(/ /g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }
  function cleanText(s) {
    return (s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
  }

  // ===================================================================
  // Player
  // ===================================================================

  const Player = {
    _mediaCache: null,

    getMediaElement() {
      if (this._mediaCache && document.contains(this._mediaCache)) {
        return this._mediaCache;
      }
      const all = document.querySelectorAll("audio, video");
      let found = null;
      for (const elx of all) {
        if (!elx.paused) {
          found = elx;
          break;
        }
      }
      if (!found) found = all[0] ?? null;
      this._mediaCache = found;
      return found;
    },

    isPlaying() {
      const media = this.getMediaElement();
      return Boolean(media && !media.paused);
    },

    // Yalnız "Duraklat" niyetli butonlar.
    findPauseButton() {
      const selectors = [
        'button[aria-label="Duraklat"]',
        'button[aria-label="Pause"]',
        'button[data-testid="pause-button"]',
        'button[data-testid="play-pause-button"]',
      ];
      for (const sel of selectors) {
        const elx = document.querySelector(sel);
        if (elx) return elx;
      }
      return null;
    },

    // Yalnız "Oynat" niyetli butonlar.
    findPlayButton() {
      const selectors = [
        'button[aria-label="Oynat"]',
        'button[aria-label="Play"]',
        'button[data-testid="play-button"]',
        'button[data-testid="play-pause-button"]',
      ];
      for (const sel of selectors) {
        const elx = document.querySelector(sel);
        if (elx) return elx;
      }
      return null;
    },

    pause() {
      const media = this.getMediaElement();
      if (media && !media.paused) {
        media.pause();
        state.pausedByExtension = true;
        Sidebar.setPlaying(false);
        return;
      }
      const btn = this.findPauseButton();
      if (btn) {
        btn.click();
        state.pausedByExtension = true;
        Sidebar.setPlaying(false);
      }
    },

    resume() {
      if (!state.pausedByExtension) return;
      const media = this.getMediaElement();
      if (media && media.paused) {
        media.play().catch(() => {});
        state.pausedByExtension = false;
        Sidebar.setPlaying(true);
        return;
      }
      const btn = this.findPlayButton();
      if (btn) {
        btn.click();
        state.pausedByExtension = false;
        Sidebar.setPlaying(true);
      }
    },
  };

  // ===================================================================
  // Detector — sanatçı / şarkı / albüm kapağı
  // ===================================================================

  const Detector = {
    coverFromMediaSession() {
      const art = navigator.mediaSession?.metadata?.artwork;
      if (Array.isArray(art) && art.length) {
        // En büyük boyutlu görseli seç.
        let best = "";
        let bestArea = -1;
        for (const a of art) {
          const src = a?.src || "";
          if (!src) continue;
          const m = String(a.sizes || "").match(/(\d+)x(\d+)/);
          const area = m ? Number(m[1]) * Number(m[2]) : 0;
          if (area >= bestArea) {
            bestArea = area;
            best = src;
          }
        }
        return best;
      }
      return "";
    },

    coverFromBar(bar) {
      if (!bar) return "";
      const img = bar.querySelector("img");
      const src = img?.currentSrc || img?.src || "";
      if (src && !src.startsWith("data:")) return src;
      return "";
    },

    fromFizyPlayer() {
      const bar = document.querySelector(Config.PLAYER_BAR_SELECTOR);
      if (!bar) return null;

      const artistLink = bar.querySelector('a[href*="/artist/"]');
      const songLink = bar.querySelector(
        'a[href*="/song/"], a[href*="/album/"]'
      );
      let artist = cleanText(artistLink?.textContent);
      let track = cleanText(songLink?.textContent);

      if (!artist) {
        const elx = bar.querySelector('[class*="artist" i]');
        artist = cleanText(elx?.textContent);
      }
      if (!track) {
        const elx = bar.querySelector(
          '[class*="song" i]:not([class*="time" i]):not([class*="duration" i]),' +
            '[class*="title" i]:not([class*="time" i])'
        );
        track = cleanText(elx?.textContent);
      }

      if (!artist || !track) {
        const leaves = [];
        const walker = document.createTreeWalker(bar, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const t = cleanText(node.textContent);
          if (!t || t.length > 80) continue;
          if (/^\d{1,2}:\d{2}$/.test(t)) continue;
          if (/^-?\d+$/.test(t)) continue;
          leaves.push(t);
          if (leaves.length >= 2) break;
        }
        if (!track && leaves[0]) track = leaves[0];
        if (!artist && leaves[1]) artist = leaves[1];
      }

      const cover = this.coverFromBar(bar);
      return artist || track ? { artist, track, cover } : null;
    },

    fromMediaSession() {
      const md = navigator.mediaSession?.metadata;
      if (md && (md.artist || md.title)) {
        return {
          artist: cleanText(md.artist),
          track: cleanText(md.title),
          cover: this.coverFromMediaSession(),
        };
      }
      return null;
    },

    fromDocumentTitle() {
      const raw = cleanText(document.title);
      const cleaned = raw.replace(/\s*[|·•]\s*fizy.*$/i, "").trim();
      const m = cleaned.match(/^(.+?)\s+[-–—]\s+(.+)$/);
      return m
        ? { artist: cleanText(m[1]), track: cleanText(m[2]), cover: "" }
        : null;
    },

    fromDom() {
      const artistSelectors = [
        '[class*="now-playing" i] [class*="artist" i]',
        '[class*="player" i] [class*="artist" i]',
        '[class*="current-track" i] [class*="artist" i]',
        '[data-testid="artist-name"]',
      ];
      const trackSelectors = [
        '[class*="now-playing" i] [class*="title" i]',
        '[class*="now-playing" i] [class*="track" i]',
        '[class*="player" i] [class*="title" i]',
        '[class*="current-track" i] [class*="title" i]',
        '[data-testid="track-name"]',
      ];
      const pickText = (selectors) => {
        for (const sel of selectors) {
          try {
            const elx = document.querySelector(sel);
            const text = cleanText(elx?.textContent);
            if (text) return text;
          } catch (_) {
            // geçersiz seçici — atla
          }
        }
        return "";
      };
      const artist = pickText(artistSelectors);
      const track = pickText(trackSelectors);
      return artist || track ? { artist, track, cover: "" } : null;
    },

    detect() {
      const sources = [
        this.fromFizyPlayer(),
        this.fromMediaSession(),
        this.fromDom(),
        this.fromDocumentTitle(),
      ];
      let artist = "";
      let track = "";
      let cover = "";
      for (const s of sources) {
        if (!s) continue;
        if (!artist && s.artist) artist = s.artist;
        if (!track && s.track) track = s.track;
        if (!cover && s.cover) cover = s.cover;
      }
      return artist || track ? { artist, track, cover } : null;
    },
  };

  // ===================================================================
  // Veri katmanı
  // ===================================================================

  function queryBackgroundForArtist(artist) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: Messages.FETCH_ARTIST_INFO, artist },
          (response) => {
            if (chrome.runtime.lastError) resolve(null);
            else resolve(response);
          }
        );
      } catch (_) {
        resolve(null);
      }
    });
  }

  function readMockArtist(key) {
    if (typeof ARTIST_DATA !== "undefined" && ARTIST_DATA[key]) {
      return ARTIST_DATA[key];
    }
    return null;
  }

  async function fetchArtistInfo(artistKey) {
    const key = normalizeKey(artistKey);
    if (!key) return null;
    const response = await queryBackgroundForArtist(artistKey);
    if (response?.data) return response.data;
    return readMockArtist(key);
  }

  // ===================================================================
  // DOM yardımcıları
  // ===================================================================

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== "") {
      node.textContent = String(text);
    }
    return node;
  }

  // Lucide tarzı minimal SVG ikonlar — currentColor (metin rengiyle aynı),
  // ince stroke. Eklenti-kontrollü, dinamik veri YOK.
  const S = (d) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const Icons = Object.freeze({
    info: S('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
    users: S(
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'
    ),
    music: S('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
    calendar: S(
      '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>'
    ),
    disc: S('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/>'),
    chevron: S('<path d="m15 18-6-6 6-6"/>'),
    // audio-lines (marka)
    logo: S(
      '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>'
    ),
  });

  function iconNode(svgString, className) {
    const wrap = document.createElement("span");
    wrap.className = className ? `fy-icon ${className}` : "fy-icon";
    wrap.setAttribute("aria-hidden", "true");
    wrap.innerHTML = svgString; // güvenli: yalnız sabit Icons.*
    return wrap;
  }

  function formatDate(iso) {
    if (!iso || typeof iso !== "string") return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("tr-TR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  // ===================================================================
  // Sidebar — Obsidian & Glass
  // ===================================================================

  const Sidebar = {
    root: null,
    panel: null,
    content: null,
    _reqId: 0,
    _trackNode: null,
    _toggle: null,

    isCreated() {
      return this.root && document.body.contains(this.root);
    },

    create() {
      if (this.isCreated()) return;

      const root = document.createElement("div");
      root.id = Config.SIDEBAR_ID;
      root.className = "fy-sidebar fy-collapsed";

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "fy-toggle";
      toggle.setAttribute("aria-label", "İçerik köprüsü panelini aç/kapa");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", Config.PANEL_ID);
      toggle.appendChild(iconNode(Icons.chevron));
      toggle.addEventListener("click", () => {
        const willOpen = root.classList.contains("fy-collapsed");
        this.setExpanded(willOpen, true);
      });
      this._toggle = toggle;

      const panel = el("div", "fy-panel");
      panel.id = Config.PANEL_ID;
      panel.setAttribute("role", "complementary");
      panel.setAttribute("aria-label", "fizy Yardımcı içerik köprüsü");
      panel.tabIndex = -1;
      panel.addEventListener("keydown", (e) => {
        if (e.key === "Escape") this.setExpanded(false, true);
      });

      const header = el("header", "fy-header");
      const brand = el("div", "fy-brand");
      brand.appendChild(iconNode(Icons.logo, "fy-logo"));
      const brandText = el("div", "fy-brand-text");
      brandText.appendChild(el("h2", "fy-title", "fizy Yardımcı"));
      brandText.appendChild(el("p", "fy-subtitle", "İçerik Köprüsü"));
      brand.appendChild(brandText);
      header.appendChild(brand);

      const content = el("div", "fy-content");

      panel.appendChild(header);
      panel.appendChild(content);

      root.appendChild(toggle);
      root.appendChild(panel);
      document.body.appendChild(root);

      this.root = root;
      this.panel = panel;
      this.content = content;

      this.renderEmpty("Bir şarkı çalmaya başlayın.");
    },

    destroy() {
      if (this.root?.parentNode) this.root.parentNode.removeChild(this.root);
      this.root = null;
      this.panel = null;
      this.content = null;
      this._trackNode = null;
    },

    setExpanded(open, focusPanel) {
      if (!this.root) return;
      this.root.classList.toggle("fy-collapsed", !open);
      this._toggle?.setAttribute("aria-expanded", String(open));
      if (open && focusPanel) this.panel?.focus();
      else if (!open && focusPanel) this._toggle?.focus();
    },

    expand() {
      this.setExpanded(true, false);
    },

    setPlaying(isPlaying) {
      state.playing = Boolean(isPlaying);
      this.root?.classList.toggle("fy-paused", !isPlaying);
    },

    setContent(nodes) {
      if (!this.content) return;
      this.content.replaceChildren(...(Array.isArray(nodes) ? nodes : [nodes]));
    },

    renderEmpty(message) {
      const empty = el("div", "fy-empty");
      empty.appendChild(iconNode(Icons.disc, "fy-empty-icon"));
      empty.appendChild(el("p", "fy-empty-text", message));
      this.setContent(empty);
    },

    // --- İmza alanı: büyük kapak + glow + zarif dalga ---

    buildGlow(cover) {
      const glow = el("div", "fy-now-glow");
      glow.setAttribute("aria-hidden", "true");
      if (cover) {
        const img = document.createElement("img");
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        img.decoding = "async";
        img.src = cover; // DOM API — CSS string'e enjekte edilmez
        glow.appendChild(img);
      }
      return glow;
    },

    buildArt(cover) {
      const frame = el("div", "fy-art-frame");
      if (cover) {
        const img = document.createElement("img");
        img.className = "fy-art";
        img.alt = "";
        img.setAttribute("aria-hidden", "true");
        img.referrerPolicy = "no-referrer";
        img.decoding = "async";
        img.addEventListener("error", () => {
          frame.classList.add("fy-art-empty");
          frame.replaceChildren(iconNode(Icons.disc, "fy-art-icon"));
        });
        img.src = cover;
        frame.appendChild(img);
      } else {
        frame.classList.add("fy-art-empty");
        frame.appendChild(iconNode(Icons.disc, "fy-art-icon"));
      }
      return frame;
    },

    buildVisualizer() {
      const v = el("div", "fy-visualizer");
      v.setAttribute("aria-hidden", "true");
      for (let i = 0; i < Config.VIS_BARS; i++) {
        const b = el("span", "fy-vis-bar");
        b.style.animationDelay = (i * -0.07).toFixed(2) + "s";
        v.appendChild(b);
      }
      return v;
    },

    buildNowPlaying(artistDisplay, track, cover) {
      const now = el("div", "fy-now");
      now.appendChild(this.buildGlow(cover));
      now.appendChild(this.buildArt(cover));
      now.appendChild(this.buildVisualizer());
      const tn = el("div", "fy-track-name", track || "—");
      this._trackNode = tn;
      now.appendChild(tn);
      now.appendChild(el("p", "fy-artist-name", artistDisplay));
      return now;
    },

    buildSkeleton() {
      const wrap = el("div", "fy-skel");
      wrap.setAttribute("aria-hidden", "true");
      wrap.appendChild(el("div", "fy-skel-line fy-skel-w50"));
      wrap.appendChild(el("div", "fy-skel-line fy-skel-w80"));
      wrap.appendChild(el("div", "fy-skel-line fy-skel-w65"));
      const row = el("div", "fy-skel-row");
      for (let i = 0; i < 3; i++) row.appendChild(el("div", "fy-skel-pill"));
      wrap.appendChild(row);
      return wrap;
    },

    // --- Bölümler: çizgi/numara yok, boşlukla ayrılır ---

    buildSection(title, iconSvg, bodyNode) {
      const section = el("section", "fy-section");
      const heading = el("h4", "fy-section-title");
      heading.appendChild(iconNode(iconSvg));
      heading.appendChild(el("span", "fy-section-label", title));
      section.appendChild(heading);
      section.appendChild(bodyNode);
      return section;
    },

    buildBio(text) {
      return el("p", "fy-bio", text);
    },

    // Benzer sanatçılar — minimal hap etiketler (nokta yok).
    buildPills(items) {
      const list = el("ul", "fy-pills");
      for (const name of items) {
        const li = el("li", "fy-pill", name);
        list.appendChild(li);
      }
      return list;
    },

    // Öne çıkan parçalar — monokrom, sönük numara + ad.
    buildTrackList(items) {
      const list = el("ol", "fy-track-list");
      items.forEach((t, i) => {
        const li = el("li", "fy-track-item");
        li.appendChild(
          el("span", "fy-track-index", String(i + 1).padStart(2, "0"))
        );
        li.appendChild(el("span", "fy-track-title", t));
        list.appendChild(li);
      });
      return list;
    },

    // Yaklaşan konser — modern etkinlik kartı.
    buildConcert(c) {
      const card = el("div", "fy-event");
      const date = formatDate(c.date);
      if (date) card.appendChild(el("div", "fy-event-date", date));
      const info = el("div", "fy-event-info");
      if (c.city) info.appendChild(el("div", "fy-event-city", c.city));
      if (c.venue) info.appendChild(el("div", "fy-event-venue", c.venue));
      card.appendChild(info);
      return card;
    },

    async render(artistKey, artistDisplay, track) {
      if (!state.sidebarEnabled) return;
      this.create();
      this.expand();
      this.setPlaying(Player.isPlaying());

      const reqId = ++this._reqId;
      const cover = state.cover;

      // Faz 1: anında kapak/now-playing + iskelet.
      this.setContent([
        this.buildNowPlaying(artistDisplay, track, cover),
        this.buildSkeleton(),
      ]);

      const info = await fetchArtistInfo(artistKey);
      if (reqId !== this._reqId) return;

      const nodes = [this.buildNowPlaying(artistDisplay, track, state.cover)];

      if (!info) {
        const empty = el("div", "fy-empty fy-empty-compact");
        empty.appendChild(iconNode(Icons.disc, "fy-empty-icon"));
        empty.appendChild(
          el("p", "fy-empty-text", "Bu sanatçı için içerik hazırlanıyor.")
        );
        nodes.push(empty);
        this.setContent(nodes);
        return;
      }

      if (info.bio) {
        nodes.push(this.buildSection("Hakkında", Icons.info, this.buildBio(info.bio)));
      }
      if (info.similar?.length) {
        nodes.push(
          this.buildSection("Benzer sanatçılar", Icons.users, this.buildPills(info.similar))
        );
      }
      if (info.topTracks?.length) {
        nodes.push(
          this.buildSection(
            "Öne çıkan parçalar",
            Icons.music,
            this.buildTrackList(info.topTracks)
          )
        );
      }
      if (info.concert) {
        nodes.push(
          this.buildSection("Yaklaşan konser", Icons.calendar, this.buildConcert(info.concert))
        );
      }

      if (reqId !== this._reqId) return;
      this.setContent(nodes);
    },

    updateTrack(track) {
      const node = this._trackNode;
      if (!node) return;
      node.textContent = track || "—";
      node.classList.remove("fy-flash");
      void node.offsetWidth;
      node.classList.add("fy-flash");
    },

    updateCover(cover) {
      const now = this.root?.querySelector(".fy-now");
      if (!now) return;
      const oldGlow = now.querySelector(".fy-now-glow");
      const oldArt = now.querySelector(".fy-art-frame");
      if (oldGlow) oldGlow.replaceWith(this.buildGlow(cover));
      if (oldArt) oldArt.replaceWith(this.buildArt(cover));
    },
  };

  // ===================================================================
  // Bridge
  // ===================================================================

  function isValidMessage(m) {
    return m && typeof m === "object" && typeof m.type === "string";
  }

  function handleSidebarToggle(enabled) {
    state.sidebarEnabled = Boolean(enabled);
    if (state.sidebarEnabled) {
      Sidebar.create();
      if (state.artistKey) {
        Sidebar.render(state.artistKey, state.artistDisplay, state.track);
      } else {
        Sidebar.renderEmpty("Bir şarkı çalmaya başlayın.");
      }
    } else {
      Sidebar.destroy();
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isValidMessage(message)) return false;
    switch (message.type) {
      case Messages.PAUSE:
        Player.pause();
        return false;
      case Messages.RESUME:
        Player.resume();
        return false;
      case Messages.SIDEBAR_TOGGLE:
        handleSidebarToggle(message.enabled);
        return false;
      case Messages.GET_STATE:
        sendResponse({ artist: state.artistDisplay, track: state.track });
        return false;
      default:
        return false;
    }
  });

  // ===================================================================
  // Algılama döngüsü
  // ===================================================================

  function poll() {
    Sidebar.setPlaying(Player.isPlaying());

    const info = Detector.detect();
    if (!info) return;

    const newKey = normalizeKey(info.artist);
    if (!newKey) return;

    if (newKey !== state.artistKey) {
      state.artistKey = newKey;
      state.artistDisplay = cleanText(info.artist);
      state.track = cleanText(info.track);
      state.cover = info.cover || "";
      Sidebar.render(state.artistKey, state.artistDisplay, state.track);
      return;
    }

    const nt = cleanText(info.track);
    if (nt && nt !== state.track) {
      state.track = nt;
      Sidebar.updateTrack(state.track);
    }
    if (info.cover && info.cover !== state.cover) {
      state.cover = info.cover;
      Sidebar.updateCover(state.cover);
    }
  }

  let pollTimer = null;
  let barObserver = null;
  let bodyObserver = null;
  let titleObserver = null;
  let debounceTimer = null;

  function schedulePoll() {
    if (debounceTimer !== null) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      requestAnimationFrame(poll);
    }, Config.OBSERVER_DEBOUNCE_MS);
  }

  function attachBarObserver() {
    const bar = document.querySelector(Config.PLAYER_BAR_SELECTOR);
    if (!bar) return false;
    if (barObserver) barObserver.disconnect();
    barObserver = new MutationObserver(schedulePoll);
    barObserver.observe(bar, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });
    schedulePoll();
    return true;
  }

  function startDetection() {
    if (!attachBarObserver()) {
      bodyObserver = new MutationObserver(() => {
        if (attachBarObserver()) {
          bodyObserver?.disconnect();
          bodyObserver = null;
        }
      });
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    }

    const titleEl = document.querySelector("title");
    if (titleEl && "MutationObserver" in window) {
      titleObserver = new MutationObserver(schedulePoll);
      titleObserver.observe(titleEl, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    pollTimer = setInterval(poll, Config.POLL_FALLBACK_MS);
    setTimeout(poll, Config.INITIAL_DETECTION_DELAY_MS);
  }

  function stopDetection() {
    if (pollTimer !== null) clearInterval(pollTimer);
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    barObserver?.disconnect();
    bodyObserver?.disconnect();
    titleObserver?.disconnect();
    pollTimer = null;
    debounceTimer = null;
    barObserver = null;
    bodyObserver = null;
    titleObserver = null;
  }

  window.addEventListener("pagehide", stopDetection, { once: true });

  // ===================================================================
  // Başlatma
  // ===================================================================

  async function init() {
    try {
      const stored = await chrome.storage.local.get(Config.SIDEBAR_STORAGE_KEY);
      state.sidebarEnabled = stored[Config.SIDEBAR_STORAGE_KEY] ?? true;
    } catch (_) {
      state.sidebarEnabled = true;
    }
    if (state.sidebarEnabled) Sidebar.create();
    startDetection();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
