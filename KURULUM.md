# fizy Yardımcı — Kurulum ve Test

`listen.fizy.com` üzerine iki özellik ekleyen MV3 Chrome eklentisi:
**Akıllı Duraklat** + **AI Destekli İçerik Köprüsü**.

> **v3 — "Obsidian & Glass".** Görsel kimlik tamamen yenilendi: derin
> obsidyen siyahı zemin (#09090B), **frosted-glass** panel, tek modern
> sans-serif tipografi ve monokrom dil. Tek renk kaynağı çalan **albüm
> kapağıdır** — arkasından sızan dinamik glow. Kapak büyük bir kare olarak
> en üstte; altında **incecik, zarif bir ses dalgası** (Lucide minimal
> SVG ikonlar, hap etiketler, çizgi değil boşlukla ayrılmış bölümler,
> modern etkinlik kartı). Mühendislik tarafında: service worker uyusa
> bile **kalıcı duraklama bug'ı giderildi** (`chrome.alarms` +
> `storage.session`), pause/resume için ayrı buton seçicileri, hızlı
> sanatçı değişiminde `reqId` koruması ve çalar barına `MutationObserver`
> ile anlık tespit.

---

## 1. Eklentiyi Yükle

1. Chrome'da `chrome://extensions` adresini aç.
2. Sağ üstten **Geliştirici modu**'nu aç.
3. **Paketlenmemiş yükle** → bu klasörü (`fizy-yardimci/`) seç.
4. Listede "fizy Yardımcı" görünür.

---

## 2. AI Bağlantısını Aç (Ücretsiz)

Mock veri yerine her sanatçı için **canlı AI üretimi** içerik almak için:

1. [build.nvidia.com](https://build.nvidia.com) adresine git.
2. Üye ol (Google/GitHub ile tek tık).
3. Herhangi bir modeli aç (örn. **Llama 3.1 70B Instruct**).
4. Sağ üstten **"Get API Key"** → ücretsiz anahtarı kopyala
   (`nvapi-...` ile başlar; ilk hesapta 1000 ücretsiz kredi).
5. Eklenti popup'ını aç → **"AI Bağlantısı"** kartını genişlet
   → anahtarı yapıştır → **"Kaydet ve Test Et"** bas.
6. "✓ Anahtar geçerli ve kaydedildi" mesajı görünmeli.

Artık fizy'de bir şarkı çalmaya başladığında sağ paneldeki bio,
benzer sanatçılar ve öne çıkan parçalar **LLM tarafından** üretilir
ve **7 gün cache'lenir** (her sanatçı için tek API çağrısı).

API anahtarı **yalnızca service worker context'inde** kullanılır;
content script veya sayfa DOM'una sızmaz.

---

## 3. Test Senaryoları

### Akıllı Duraklat

| Adım | Beklenen |
|------|----------|
| fizy'de bir şarkı çal | fizy çalıyor |
| Başka sekmede YouTube/Spotify video aç | fizy otomatik duraklar |
| Diğer sekmeyi kapat | fizy ~1 sn sonra devam eder |
| fizy'i elle duraklat, başka sekmede ses çık-kapa yap | fizy başlamaz (niyete saygı) |
| Popup'tan Akıllı Duraklat'ı kapat | Eklentinin durdurduğu varsa devam eder |

### İçerik Köprüsü (AI bağlı)

| Adım | Beklenen |
|------|----------|
| fizy'de bir şarkı çal | Sağ kenar panel açılır |
| **İlk kez**: panel ~2-3 sn boş kalır | LLM yanıtı gelir |
| **Aynı sanatçı tekrar**: anında dolar | Cache'den geliyor |
| Yeni sanatçıya geç | Panel yeni bilgilerle güncellenir |
| Popup'tan İçerik Köprüsü'nü kapat | Panel kaybolur |

### İçerik Köprüsü (AI bağlı değil)

API anahtarı girilmediyse panel yerel mock veriyi gösterir
(Sezen Aksu, Tarkan, Duman, Athena, Sertab Erener, Müslüm Gürses).
Listede olmayan sanatçılar için "içerik hazırlanıyor" mesajı.

---

## 4. Mimari Özet

```
fizy-yardimci/
├── manifest.json     # MV3, izinler: tabs/storage/alarms; host: fizy + NVIDIA
├── background.js     # Servis çalışanı: dayanıklı pause/resume + NVIDIA + cache
├── content.js        # fizy DOM'unda: algılama + panel
├── sidebar.css       # Panel stili
├── data/artists.js   # Çevrimdışı mock veri (AI yokken fallback)
├── popup.html        # Popup yapısı
├── popup.css         # Popup stili
├── popup.js          # Popup mantığı + API key yönetimi
└── KURULUM.md        # Bu dosya
```

### Mesaj akışı

```
popup.js ─── TEST_API_KEY ────────────► background.js (NVIDIA API)
popup.js ─── SETTINGS_CHANGED ────────► background.js
popup.js ─── SIDEBAR_TOGGLE ──────────► content.js
popup.js ─── GET_STATE ───────────────► content.js  (şu an çalıyor)

content.js ── FETCH_ARTIST_INFO ──────► background.js
                                              │
                                              ├── cache hit  ─► dön
                                              └── cache miss ─► NVIDIA API
                                                                 └── cache yaz, dön

background.js ── FIZY_PAUSE ──────────► content.js
background.js ── FIZY_RESUME ─────────► content.js
```

### Cache stratejisi

- Anahtar: sanatçı adı (lowercased)
- TTL: 7 gün
- Maks. boyut: 50 sanatçı (FIFO budama)
- Storage: `chrome.storage.local.artistCache`
- API key değişince cache temizlenir

---

## 5. Güvenlik

- **API anahtarı**: yalnız `chrome.storage.local`'da; service worker
  okur, content script ya da sayfa erişemez.
- **CSP**: harici CDN/Google Fonts yok; tüm fontlar sistem fontları.
- **CSS izolasyonu**: panel `#fizy-yardimci-sidebar` id prefix'i ile
  fizy CSS'inden tamamen yalıtık.
- **XSS koruması**: tüm dinamik içerik (sanatçı/şarkı/bio) DOM API
  (`createElement` + `textContent`) ile inşa edilir; `innerHTML` yalnız
  sabit SVG ikon şablonları için.
- **Mesaj doğrulama**: tüm `chrome.runtime.onMessage` handler'ları
  şekil-doğrulamadan geçer; tanınmayan tipler atılır.
- **Çalar düğme seçicileri**: dar ve **niyet-ayrımlı** — `pause()` yalnız
  "Duraklat", `resume()` yalnız "Oynat" butonunu hedefler; pause niyetiyle
  yanlışlıkla "Oynat"a basıp müziği ters yönde tetikleme riski yok.
- **Albüm kapağı**: URL `<img>.src` ile (DOM API) atanır — CSS string'e
  enjekte edilmez; yalnız görüntü yüklenir, canvas okunmaz (dinamik glow
  blur'lu görüntüden gelir, piksel örnekleme yok).

---

## 6. Sorun Giderme

- **"Errors" kırmızı**: `chrome://extensions` → "Errors" → mesajları bana yolla
- **Service worker susmuş**: kart üzerinde "service worker" linkine tıkla → Console'da hata var mı bak
- **API "Geçersiz anahtar"**: build.nvidia.com'da anahtarın aktif olduğunu doğrula
- **Panel hep mock'a düşüyor**: API anahtarını gir, "Kaydet ve Test Et" başarılı mı?
- **Yeni sanatçı sürekli mock**: cache'i temizlemek için API key alanında "Temizle" + "Kaydet ve Test Et"
