// data/artists.js — Mock sanatçı verisi (prototip için).
//
// TODO: gerçek senaryoda bu veri bir müzik metadata API'sine
//       (Last.fm, Spotify, MusicBrainz veya kurum içi bir servis)
//       bağlanacak. Veri katmanı bu modülde soyutlandığı için
//       content.js içindeki fetchArtistInfo() fonksiyonunu API çağrısına
//       çevirmek tek dokunuş işidir.
//
// Not: content scripts izole dünyada çalışır; aynı manifest girişinde
// listelenen scripts global "var" bildirimlerini paylaşır. Bu yüzden
// ARTIST_DATA'yı "var" olarak tanımlıyoruz.

var ARTIST_DATA = {
  "sezen aksu": {
    bio:
      "Türk pop müziğinin yönünü belirleyen, kuşaklar boyu söz yazarlığı " +
      "ve sahne ışığıyla 'Minik Serçe' olarak anılan isim.",
    similar: ["Sertab Erener", "Nilüfer", "Aşkın Nur Yengi"],
    topTracks: ["Firuze", "Vurgun", "Kahpe Kader"],
    concert: {
      city: "İstanbul",
      date: "2026-07-12",
      venue: "Harbiye Cemil Topuzlu Açıkhava",
    },
  },
  "tarkan": {
    bio:
      "Türkiye'nin uluslararası alanda en bilinen pop ihracı; 90'lardan " +
      "bu yana sahne enerjisi ve geniş diskografisi ile tanınıyor.",
    similar: ["Mustafa Sandal", "Kenan Doğulu", "Serdar Ortaç"],
    topTracks: ["Şımarık", "Kuzu Kuzu", "Kış Güneşi"],
    concert: {
      city: "Ankara",
      date: "2026-08-03",
      venue: "MTM Ankara Arena",
    },
  },
  "müslüm gürses": {
    bio:
      "Arabesk müziğin baba figürü; 'İtirazım Var' albümü ile yeni nesle " +
      "uzanan bir etki bıraktı.",
    similar: ["Orhan Gencebay", "Ferdi Tayfur", "İbrahim Tatlıses"],
    topTracks: ["Affet", "Nilüfer", "İtirazım Var"],
    concert: null,
  },
  "athena": {
    bio:
      "Türkçe ska/punk'ın simgesi; Gökhan ve Hakan Özoğuz kardeşlerin " +
      "kurduğu, sahne enerjisiyle bilinen grup.",
    similar: ["Mor ve Ötesi", "Duman", "Şebnem Ferah"],
    topTracks: ["Senden Daha Güzel", "Arsız Gönül", "Yaşadıkça"],
    concert: {
      city: "İzmir",
      date: "2026-06-21",
      venue: "Kültürpark Açıkhava",
    },
  },
  "duman": {
    bio:
      "2000'lerin başında Türkçe rock'ın yönünü değiştiren üçlü; " +
      "melankolik sözleri ve sade sahne tavrı ile öne çıktı.",
    similar: ["Mor ve Ötesi", "Şebnem Ferah", "Pinhani"],
    topTracks: ["Eski Köprünün Altında", "Bal", "Senin Marşların"],
    concert: {
      city: "İstanbul",
      date: "2026-09-05",
      venue: "Volkswagen Arena",
    },
  },
  "sertab erener": {
    bio:
      "2003 Eurovision birincisi; geniş vokal aralığı ve caz/pop " +
      "kesişimindeki üretimleriyle tanınıyor.",
    similar: ["Sezen Aksu", "Yıldız Tilbe", "Candan Erçetin"],
    topTracks: ["Everyway That I Can", "Aşk", "Olsun"],
    concert: null,
  },
};
