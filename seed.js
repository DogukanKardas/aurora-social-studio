// İlk açılışta takvime yüklenen 30 günlük plan (19 Ekim – 14 Kasım 2026).
'use strict';
const crypto = require('crypto');

const IGFB = ['Instagram', 'Facebook'];
const plan = [
  ['2026-10-19', IGFB, 'Carousel', 'Güven ve hikâye', 'Kuruluş hikâyesi', "It started with a friend blamed for an accident he didn't cause. No footage, no proof. 8 years and 3,000+ installs later, that's still why we do this."],
  ['2026-10-20', ['YouTube'], 'Short', 'Kurulum işçiliği', '30 sn kurulum timelapse', 'From box to hidden install in 30 seconds. No dangling wires.'],
  ['2026-10-21', ['LinkedIn'], 'Metin + görsel', 'Güven ve hikâye', 'Şirket tanıtımı, 50+ bayi', "8+ years of dash cam installs across Vancouver, now with 50+ dealer partners. We're bringing that work online."],
  ['2026-10-22', IGFB, 'Reel', 'Kurulum işçiliği', 'Önce/sonra kablo yolu', 'Before / after. Every cable behind the trim. All you see is the camera.'],
  ['2026-10-23', ['YouTube'], 'Short', 'Görüntü kalitesi', 'Gece kaydı örneği', 'Same street, 10 PM. Sony Starvis sensor, f/1.8. This is what your camera should see.'],
  ['2026-10-24', IGFB, 'Carousel', 'Ürün', 'Falcon Vision', 'Falcon Vision: 4K front, Full HD rear, 1080p cabin. Three angles, one system.'],
  ['2026-10-26', IGFB, 'Carousel', 'Bilgi ve eğitim', 'Park modu aküyü bitirir mi?', "Short answer: not when it's installed right. A low-voltage cutoff protects your battery. Swipe to see how."],
  ['2026-10-27', ['YouTube'], 'Short', 'Bilgi ve eğitim', 'Hardwire vs. çakmak girişi', "Plug-in or hardwired? Here's the difference you'll notice every day."],
  ['2026-10-28', ['LinkedIn'], 'Metin + görsel', 'Güven ve hikâye', 'Bayi tanıtımı (izinli)', 'Meet one of our dealer partners. Same install standard, every location.'],
  ['2026-10-29', IGFB, 'Reel', 'Kurulum işçiliği', 'A-pillar detay çekimi', 'The part nobody sees is the part we care about most.'],
  ['2026-10-30', ['YouTube'], 'Short', 'Görüntü kalitesi', 'Hawk Vision park modu kaydı', 'Parked, engine off, still recording. Hawk Vision in parking mode.'],
  ['2026-10-31', IGFB, 'Görsel', 'Bilgi ve eğitim', 'Saatler geri alınıyor', 'Clocks go back tonight. Darker drives home start Monday. Is your camera ready?'],
  ['2026-11-02', IGFB, 'Reel', 'Görüntü kalitesi', 'Akşam işe dönüş, karanlık kayıt', '5:30 PM, already dark. Plates readable, road clear.'],
  ['2026-11-03', ['YouTube'], 'Uzun video', 'Kurulum işçiliği', 'Baştan sona tam kurulum (8-12 dk)', 'A complete dash cam install, start to finish. No cuts, no shortcuts.'],
  ['2026-11-04', ['LinkedIn'], 'Metin + görsel', 'Güven ve hikâye', 'Filo ve galeri çözümleri', 'For fleets and dealerships: one installer, one standard, every vehicle.'],
  ['2026-11-05', IGFB, 'Carousel', 'Bilgi ve eğitim', 'Olay sonrası kaydı kaydetme', "Had an incident? Here's how to save your footage before it's overwritten."],
  ['2026-11-06', ['YouTube'], 'Short', 'Bilgi ve eğitim', 'Klip kaydetme adımları', "Saving a clip takes 10 seconds. Here's how."],
  ['2026-11-07', IGFB, 'Görsel', 'Güven ve hikâye', 'Gerçek müşteri yorumu (izinli)', "In our customer's words."],
  ['2026-11-09', IGFB, 'Reel', 'Ürün', 'Nova', "Nova: 4K Ultra HD in a body you'll forget is there."],
  ['2026-11-10', ['YouTube'], 'Short', 'Görüntü kalitesi', 'Yağmurlu gece kaydı', 'Vancouver rain, night, wipers on. Still clear.'],
  ['2026-11-11', [], '-', '', 'Remembrance Day: tanıtım paylaşımı yok', ''],
  ['2026-11-12', ['LinkedIn', 'Instagram', 'Facebook'], 'Reel', 'Güven ve hikâye', 'Ekip tanıtımı', 'The technicians behind every install.'],
  ['2026-11-13', ['YouTube'], 'Short', 'Ürün', 'AuroraCam', 'AuroraCam, explained in 30 seconds.'],
  ['2026-11-14', IGFB, 'Carousel', 'Bilgi ve eğitim', 'En sık 5 soru', 'The five questions we hear most, answered.'],
];

exports.posts = () => plan.map(([date, platforms, format, pillar, topic, caption]) => ({
  id: crypto.randomBytes(6).toString('hex'),
  date, time: '18:00', platforms, format, pillar, topic, caption,
  status: platforms.length ? 'Taslak' : 'Atla',
  mediaIds: [], notes: '', createdAt: new Date().toISOString(),
}));
