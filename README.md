# 🎵 fizy Yardımcı — Turkcell fizy Chrome Eklentisi

> `listen.fizy.com` için **akıllı duraklat** ve **yapay zekâ destekli sanatçı bilgi köprüsü** sunan bir Chrome eklentisi.

[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-blue)]()
[![Sürüm](https://img.shields.io/badge/sürüm-3.0.0-black)]()
[![Lisans](https://img.shields.io/badge/lisans-MIT-green)]()

---

## 📖 Hikâye — Bu kodu neden yayınladım?

Bu projeyi **Turkcell mülakatım için** geliştirdim.

Turkcell'in müzik servisi **fizy**'i her gün kullanıyordum ve onu bir kullanıcı
olarak gerçekten önemsiyordum. Mülakata "sadece CV ile" gitmek yerine,
**ürünü gerçekten anladığımı ve onu daha iyi hâle getirebileceğimi** somut bir
şekilde göstermek istedim. Bir slayt anlatmak yerine — **çalışan bir şey** koymak
istedim masaya.

Böylece fizy deneyimini iki yerde iyileştiren bu eklentiyi yazdım:

- **Günlük kullanımdaki gerçek bir sürtünmeyi çözdüm** → başka sekmede video
  açınca müzik üstüne biniyordu; eklenti bunu akıllıca duraklatıp devam ettiriyor.
- **Yeni bir değer kattım** → çalan sanatçı hakkında, yapay zekâ ile üretilen
  şık bir bilgi paneli getirdim.

Bu repoyu herkese açık yayınladım çünkü:

1. 🧑‍💼 **Mülakatta gösterebilmek için** — yazdığım kodu, mimari kararları ve
   mühendislik titizliğimi açıkça sergiliyor.
2. 🛠️ **Mühendislik yaklaşımımı kanıtlamak için** — sadece "çalışıyor" değil;
   güvenlik, dayanıklılık (MV3 service worker ömrü), yarış koşulları ve XSS gibi
   konuları kod yorumlarına kadar düşündüm.
3. 💙 **fizy'e ve Turkcell'e olan ilgimi göstermek için** — bu, bir ürüne
   gerçekten inanan birinin işi.

> ⚠️ **Not:** Bu bağımsız, kişisel bir projedir. Turkcell ve fizy ile resmî bir
> bağı yoktur; tüm marka adları sahiplerine aittir.

---

## ✨ Özellikler

### 1. 🎯 Akıllı Duraklat
Başka bir sekmede (YouTube, bir video, başka bir çalar) ses çıkmaya başladığında
fizy **otomatik olarak duraklar**; o ses bitince **kaldığı yerden devam eder**.
Artık iki sesin üst üste binmesiyle uğraşmak yok.

### 2. 🤖 Yapay Zekâ Sanatçı Paneli
O an çalan sanatçıyı algılar ve hakkında **NVIDIA Build (Llama 3.1 70B)** ile
üretilmiş bir özet sunar. Tasarım dili "Obsidian & Glass": derin obsidyen siyahı,
camımsı yüzeyler ve **çalan albümün kapağından sızan dinamik renk/glow**.

### 3. ⚙️ Sade Ayar Popup'ı
Akıllı Duraklat'ı ve yan paneli aç/kapat; kendi NVIDIA API anahtarını gir.

---

## 🏗️ Mimari

```
popup.js ── TEST_API_KEY ──►  background.js  ◄── FETCH_ARTIST_INFO ── content.js
   (ayarlar)                  (service worker)                          (sayfa)
                                    │
                                    ├─ Akıllı Duraklat motoru (sekme sesi takibi)
                                    └─ NVIDIA Llama 3.1 API + 7 günlük cache
```

| Dosya | Sorumluluk |
|-------|-----------|
| `manifest.json` | MV3 yapılandırması, izinler, host izinleri |
| `background.js` | Service worker — akıllı duraklat + NVIDIA API köprüsü + cache |
| `content.js` | Sayfa scripti — çalar kontrolü, sanatçı algılama, yan panel |
| `popup.html/.js/.css` | Ayar arayüzü |
| `sidebar.css` | "Obsidian & Glass" yan panel stilleri |
| `data/artists.js` | Statik sanatçı verisi |

---

## 🔒 Güvenlik

Bu repoda **hiçbir API anahtarı veya gizli bilgi yoktur.**

- 🔑 **API anahtarı koda gömülü değildir.** Her kullanıcı kendi NVIDIA anahtarını
  girer; anahtar yalnızca kullanıcının tarayıcısında `chrome.storage.local`
  içinde tutulur ve **sadece** service worker bağlamında okunur — content script'e
  ya da sayfa DOM'una asla sızmaz.
- 🛡️ **XSS'e karşı korumalı:** veri kaynaklı hiçbir alan `innerHTML` ile basılmaz;
  tüm dinamik içerik `createElement` + `textContent` ile inşa edilir. `innerHTML`
  yalnızca eklenti-kontrollü sabit SVG ikonlar için kullanılır.
- ♻️ **MV3 dayanıklılığı:** service worker ~30 sn'de uykuya daldığı için duraklatma
  durumu `chrome.storage.session`'a kalıcılaştırılır + `chrome.alarms` güvenlik ağı.

---

## 🚀 Kurulum

1. Bu repoyu indir veya klonla:
   ```bash
   git clone https://github.com/bsyilmaz/turkcell-fizy-extension.git
   ```
2. Chrome'da `chrome://extensions` adresini aç.
3. Sağ üstten **Geliştirici modu**'nu etkinleştir.
4. **"Paketlenmemiş öğe yükle"** → bu klasörü seç.
5. `listen.fizy.com`'u aç, eklenti simgesine tıkla, NVIDIA API anahtarını gir.

> Sanatçı paneli için ücretsiz bir NVIDIA Build anahtarı gerekir:
> https://build.nvidia.com — Akıllı Duraklat ise anahtarsız çalışır.

Daha ayrıntılı adımlar için: [`KURULUM.md`](./KURULUM.md)

---

## 🧰 Teknik Detaylar

- **Manifest V3** (service worker tabanlı)
- Saf **Vanilla JavaScript** — çerçeve yok, derleme adımı yok
- İzinler: `tabs`, `storage`, `alarms`
- Host izinleri: `listen.fizy.com`, `integrate.api.nvidia.com`
- Model: `meta/llama-3.1-70b-instruct`

---

## 📄 Lisans

MIT — dilediğin gibi kullan, öğren, geliştir.
