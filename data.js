// 地域データセット（東京西南部・第1検証データセット）
// 将来の任意エリア動的読み込みに向けてゲームロジックから分離
window.RAIL_DATA = (() => {
  'use strict';
  // =========================================================================
  // 2. 実在データ（東京都統計2026・川崎市統計・実測WGS84座標）
  // =========================================================================
  const MUNICIPALITIES = [
    { id: 'shinjuku', name: '新宿区', pop: 359931, area: 18.22, lat: 35.6900, lng: 139.7005, commBase: 98, priceBase: 95 },
    { id: 'shibuya', name: '渋谷区', pop: 243865, area: 15.11, lat: 35.6586, lng: 139.7011, commBase: 95, priceBase: 92 },
    { id: 'suginami', name: '杉並区', pop: 599035, area: 34.06, lat: 35.6950, lng: 139.6360, commBase: 54, priceBase: 62 },
    { id: 'setagaya', name: '世田谷区', pop: 950073, area: 58.05, lat: 35.6420, lng: 139.6450, commBase: 66, priceBase: 72 },
    { id: 'musashino', name: '武蔵野市', pop: 150430, area: 10.98, lat: 35.7020, lng: 139.5660, commBase: 68, priceBase: 65 },
    { id: 'mitaka', name: '三鷹市', pop: 196412, area: 16.42, lat: 35.6830, lng: 139.5600, commBase: 48, priceBase: 55 },
    { id: 'chofu', name: '調布市', pop: 246052, area: 21.58, lat: 35.6510, lng: 139.5450, commBase: 55, priceBase: 52 },
    { id: 'komae', name: '狛江市', pop: 83670, area: 6.39, lat: 35.6340, lng: 139.5780, commBase: 36, priceBase: 46 },
    { id: 'fuchu', name: '府中市', pop: 264628, area: 29.43, lat: 35.6694, lng: 139.4775, commBase: 52, priceBase: 45 },
    { id: 'inagi', name: '稲城市', pop: 95561, area: 17.97, lat: 35.6360, lng: 139.4995, commBase: 28, priceBase: 32 },
    { id: 'tama', name: '多摩市', pop: 146593, area: 21.01, lat: 35.6240, lng: 139.4229, commBase: 44, priceBase: 34 },
    { id: 'machida', name: '町田市', pop: 432307, area: 71.55, lat: 35.5467, lng: 139.4386, commBase: 62, priceBase: 38 },
    { id: 'kw_tama', name: '川崎市多摩区', pop: 228812, area: 20.50, lat: 35.6160, lng: 139.5650, commBase: 45, priceBase: 44 },
    { id: 'kw_asao', name: '川崎市麻生区', pop: 180000, area: 23.25, lat: 35.6039, lng: 139.5078, commBase: 48, priceBase: 42 }
  ];

  // 実在の東京西南部 鉄道各線（全途中駅・実測WGS84座標ベース）
  const EXISTING_STATIONS = [
    // 京王線（新宿〜府中）
    { id: 'ex_shinjuku', name: '新宿', lat: 35.6896, lng: 139.7003, hub: true, major: true, hubCost: 0, lines: ['京王線', '小田急線'], directCost: 120, directFee: 6.0, directSlots: 10 },
    { id: 'ex_sasazuka', name: '笹塚', lat: 35.6737, lng: 139.6673, hub: false, major: false, hubCost: 6, lines: ['京王線'], directCost: 90, directFee: 4.5, directSlots: 6 },
    { id: 'ex_daitabashi', name: '代田橋', lat: 35.6710, lng: 139.6590, hub: false, major: false, hubCost: 8, lines: ['京王線'], directCost: 85, directFee: 4.2, directSlots: 6 },
    { id: 'ex_meidaimae', name: '明大前', lat: 35.6684, lng: 139.6505, hub: false, major: true, hubCost: 9, lines: ['京王線'], directCost: 85, directFee: 4.2, directSlots: 8 },
    { id: 'ex_shimotakaido', name: '下高井戸', lat: 35.6660, lng: 139.6412, hub: false, major: false, hubCost: 11, lines: ['京王線'], directCost: 80, directFee: 3.8, directSlots: 6 },
    { id: 'ex_sakurajosui', name: '桜上水', lat: 35.6675, lng: 139.6317, hub: false, major: false, hubCost: 12, lines: ['京王線'], directCost: 78, directFee: 3.8, directSlots: 6 },
    { id: 'ex_kamikitazawa', name: '上北沢', lat: 35.6690, lng: 139.6231, hub: false, major: false, hubCost: 13, lines: ['京王線'], directCost: 75, directFee: 3.6, directSlots: 6 },
    { id: 'ex_hachimanyama', name: '八幡山', lat: 35.6697, lng: 139.6156, hub: false, major: false, hubCost: 14, lines: ['京王線'], directCost: 75, directFee: 3.6, directSlots: 6 },
    { id: 'ex_rokakoen', name: '芦花公園', lat: 35.6704, lng: 139.6085, hub: false, major: false, hubCost: 15, lines: ['京王線'], directCost: 72, directFee: 3.5, directSlots: 6 },
    { id: 'ex_chitosekarasuyama', name: '千歳烏山', lat: 35.6681, lng: 139.6009, hub: false, major: true, hubCost: 15, lines: ['京王線'], directCost: 72, directFee: 3.5, directSlots: 8 },
    { id: 'ex_sengawa', name: '仙川', lat: 35.6623, lng: 139.5849, hub: false, major: false, hubCost: 18, lines: ['京王線'], directCost: 68, directFee: 3.3, directSlots: 6 },
    { id: 'ex_tsutsuji', name: 'つつじヶ丘', lat: 35.6580, lng: 139.5751, hub: false, major: true, hubCost: 19, lines: ['京王線'], directCost: 65, directFee: 3.2, directSlots: 6 },
    { id: 'ex_shibasaki', name: '柴崎', lat: 35.6540, lng: 139.5666, hub: false, major: false, hubCost: 20, lines: ['京王線'], directCost: 65, directFee: 3.2, directSlots: 6 },
    { id: 'ex_kokuryo', name: '国領', lat: 35.6502, lng: 139.5582, hub: false, major: false, hubCost: 21, lines: ['京王線'], directCost: 65, directFee: 3.2, directSlots: 6 },
    { id: 'ex_fuda', name: '布田', lat: 35.6499, lng: 139.5517, hub: false, major: false, hubCost: 22, lines: ['京王線'], directCost: 65, directFee: 3.2, directSlots: 6 },
    { id: 'ex_chofu', name: '調布', lat: 35.6519, lng: 139.5441, hub: false, major: true, hubCost: 21, lines: ['京王線', '京王相模原線'], directCost: 70, directFee: 3.5, directSlots: 8 },
    { id: 'ex_nishichofu', name: '西調布', lat: 35.6571, lng: 139.5297, hub: false, major: false, hubCost: 24, lines: ['京王線'], directCost: 60, directFee: 3.0, directSlots: 6 },
    { id: 'ex_tobitakyu', name: '飛田給', lat: 35.6602, lng: 139.5234, hub: false, major: false, hubCost: 25, lines: ['京王線'], directCost: 60, directFee: 3.0, directSlots: 6 },
    { id: 'ex_musashinodai', name: '武蔵野台', lat: 35.6643, lng: 139.5113, hub: false, major: false, hubCost: 26, lines: ['京王線'], directCost: 60, directFee: 3.0, directSlots: 6 },
    { id: 'ex_tamareien', name: '多磨霊園', lat: 35.6663, lng: 139.5029, hub: false, major: false, hubCost: 27, lines: ['京王線'], directCost: 60, directFee: 3.0, directSlots: 6 },
    { id: 'ex_higashifuchu', name: '東府中', lat: 35.6689, lng: 139.4953, hub: false, major: false, hubCost: 28, lines: ['京王線'], directCost: 60, directFee: 3.0, directSlots: 6 },
    { id: 'ex_fuchu', name: '府中', lat: 35.6721, lng: 139.4803, hub: false, major: true, hubCost: 28, lines: ['京王線'], directCost: 60, directFee: 3.0, directSlots: 6 },

    // 京王相模原線（調布〜多摩センター）
    { id: 'ex_keiotamagawa', name: '京王多摩川', lat: 35.6448, lng: 139.5370, hub: false, major: false, hubCost: 24, lines: ['京王相模原線'], directCost: 60, directFee: 3.0, directSlots: 6 },
    { id: 'ex_keioinadazutsumi', name: '京王稲田堤', lat: 35.6339, lng: 139.5313, hub: false, major: true, hubCost: 26, lines: ['京王相模原線'], directCost: 60, directFee: 3.0, directSlots: 6 },
    { id: 'ex_keioyomiuri', name: '京王よみうりランド', lat: 35.6327, lng: 139.5172, hub: false, major: false, hubCost: 28, lines: ['京王相模原線'], directCost: 58, directFee: 2.9, directSlots: 6 },
    { id: 'ex_inagi', name: '稲城', lat: 35.6359, lng: 139.4997, hub: false, major: true, hubCost: 30, lines: ['京王相模原線'], directCost: 55, directFee: 2.8, directSlots: 6 },
    { id: 'ex_wakabadai', name: '若葉台', lat: 35.6194, lng: 139.4725, hub: false, major: false, hubCost: 33, lines: ['京王相模原線'], directCost: 50, directFee: 2.5, directSlots: 6 },
    { id: 'ex_nagayama', name: '永山', lat: 35.6299, lng: 139.4479, hub: false, major: true, hubCost: 36, lines: ['京王相模原線', '小田急多摩線'], directCost: 55, directFee: 2.8, directSlots: 6 },
    { id: 'ex_tamacenter', name: '多摩センター', lat: 35.6250, lng: 139.4239, hub: false, major: true, hubCost: 38, lines: ['京王相模原線', '小田急多摩線'], directCost: 55, directFee: 2.8, directSlots: 6 },

    // 小田急小田原線（新宿〜町田）
    { id: 'ex_yoyogiuehara', name: '代々木上原', lat: 35.6690, lng: 139.6798, hub: false, major: true, hubCost: 6, lines: ['小田急線'], directCost: 95, directFee: 4.8, directSlots: 8 },
    { id: 'ex_shimokitazawa', name: '下北沢', lat: 35.6616, lng: 139.6667, hub: false, major: true, hubCost: 9, lines: ['小田急線'], directCost: 90, directFee: 4.5, directSlots: 8 },
    { id: 'ex_umegaoka', name: '梅ヶ丘', lat: 35.6557, lng: 139.6536, hub: false, major: false, hubCost: 11, lines: ['小田急線'], directCost: 82, directFee: 4.0, directSlots: 6 },
    { id: 'ex_gotokuji', name: '豪徳寺', lat: 35.6538, lng: 139.6474, hub: false, major: false, hubCost: 12, lines: ['小田急線'], directCost: 80, directFee: 3.9, directSlots: 6 },
    { id: 'ex_kyodo', name: '経堂', lat: 35.6511, lng: 139.6368, hub: false, major: true, hubCost: 13, lines: ['小田急線'], directCost: 78, directFee: 3.8, directSlots: 8 },
    { id: 'ex_chitosefunabashi', name: '千歳船橋', lat: 35.6473, lng: 139.6238, hub: false, major: false, hubCost: 15, lines: ['小田急線'], directCost: 74, directFee: 3.6, directSlots: 6 },
    { id: 'ex_soshigaya', name: '祖師ヶ谷大蔵', lat: 35.6431, lng: 139.6090, hub: false, major: false, hubCost: 16, lines: ['小田急線'], directCost: 72, directFee: 3.5, directSlots: 6 },
    { id: 'ex_seijo', name: '成城学園前', lat: 35.6401, lng: 139.5992, hub: false, major: true, hubCost: 17, lines: ['小田急線'], directCost: 72, directFee: 3.5, directSlots: 8 },
    { id: 'ex_kitami', name: '喜多見', lat: 35.6367, lng: 139.5877, hub: false, major: false, hubCost: 19, lines: ['小田急線'], directCost: 70, directFee: 3.4, directSlots: 6 },
    { id: 'ex_komae', name: '狛江', lat: 35.6349, lng: 139.5797, hub: false, major: false, hubCost: 20, lines: ['小田急線'], directCost: 70, directFee: 3.4, directSlots: 6 },
    { id: 'ex_izumitamagawa', name: '和泉多摩川', lat: 35.6295, lng: 139.5747, hub: false, major: false, hubCost: 21, lines: ['小田急線'], directCost: 70, directFee: 3.4, directSlots: 6 },
    { id: 'ex_noborito', name: '登戸', lat: 35.6208, lng: 139.5698, hub: false, major: true, hubCost: 20, lines: ['小田急線', 'JR南武線'], directCost: 70, directFee: 3.5, directSlots: 8 },
    { id: 'ex_mukogaoka', name: '向ヶ丘遊園', lat: 35.6173, lng: 139.5648, hub: false, major: false, hubCost: 22, lines: ['小田急線'], directCost: 68, directFee: 3.3, directSlots: 6 },
    { id: 'ex_ikuta', name: '生田', lat: 35.6152, lng: 139.5419, hub: false, major: false, hubCost: 24, lines: ['小田急線'], directCost: 65, directFee: 3.2, directSlots: 6 },
    { id: 'ex_yomiurilandmae', name: '読売ランド前', lat: 35.6145, lng: 139.5282, hub: false, major: false, hubCost: 25, lines: ['小田急線'], directCost: 65, directFee: 3.2, directSlots: 6 },
    { id: 'ex_yurigaoka', name: '百合ヶ丘', lat: 35.6087, lng: 139.5169, hub: false, major: false, hubCost: 26, lines: ['小田急線'], directCost: 65, directFee: 3.2, directSlots: 6 },
    { id: 'ex_shinyuri', name: '新百合ヶ丘', lat: 35.6039, lng: 139.5078, hub: false, major: true, hubCost: 26, lines: ['小田急線', '小田急多摩線'], directCost: 65, directFee: 3.2, directSlots: 8 },
    { id: 'ex_kakio', name: '柿生', lat: 35.5912, lng: 139.4979, hub: false, major: false, hubCost: 29, lines: ['小田急線'], directCost: 62, directFee: 3.0, directSlots: 6 },
    { id: 'ex_tsurukawa', name: '鶴川', lat: 35.5818, lng: 139.4820, hub: false, major: false, hubCost: 31, lines: ['小田急線'], directCost: 62, directFee: 3.0, directSlots: 6 },
    { id: 'ex_tamagawagakuen', name: '玉川学園前', lat: 35.5637, lng: 139.4633, hub: false, major: false, hubCost: 34, lines: ['小田急線'], directCost: 62, directFee: 3.0, directSlots: 6 },
    { id: 'ex_machida', name: '町田', lat: 35.5435, lng: 139.4455, hub: false, major: true, hubCost: 36, lines: ['小田急線'], directCost: 65, directFee: 3.0, directSlots: 8 },

    // 小田急多摩線途中駅
    { id: 'ex_satsukidai', name: '五月台', lat: 35.6020, lng: 139.4945, hub: false, major: false, hubCost: 29, lines: ['小田急多摩線'], directCost: 55, directFee: 2.7, directSlots: 6 },
    { id: 'ex_kurihira', name: '栗平', lat: 35.6054, lng: 139.4806, hub: false, major: false, hubCost: 31, lines: ['小田急多摩線'], directCost: 55, directFee: 2.7, directSlots: 6 },
    { id: 'ex_kurokawa', name: '黒川', lat: 35.6130, lng: 139.4682, hub: false, major: false, hubCost: 33, lines: ['小田急多摩線'], directCost: 52, directFee: 2.6, directSlots: 6 },
    { id: 'ex_haruhino', name: 'はるひ野', lat: 35.6184, lng: 139.4614, hub: false, major: false, hubCost: 34, lines: ['小田急多摩線'], directCost: 52, directFee: 2.6, directSlots: 6 },

    // 東急田園都市線（渋谷〜たまプラーザ）
    { id: 'ex_shibuya', name: '渋谷', lat: 35.6585, lng: 139.7013, hub: true, major: true, hubCost: 0, lines: ['東急田園都市線'], directCost: 110, directFee: 5.5, directSlots: 10 },
    { id: 'ex_ikejiri', name: '池尻大橋', lat: 35.6505, lng: 139.6845, hub: false, major: false, hubCost: 4, lines: ['東急田園都市線'], directCost: 95, directFee: 4.8, directSlots: 6 },
    { id: 'ex_sangenjaya', name: '三軒茶屋', lat: 35.6436, lng: 139.6710, hub: false, major: true, hubCost: 6, lines: ['東急田園都市線'], directCost: 90, directFee: 4.5, directSlots: 8 },
    { id: 'ex_komazawa', name: '駒沢大学', lat: 35.6330, lng: 139.6615, hub: false, major: false, hubCost: 9, lines: ['東急田園都市線'], directCost: 82, directFee: 4.2, directSlots: 6 },
    { id: 'ex_sakurashinmachi', name: '桜新町', lat: 35.6317, lng: 139.6445, hub: false, major: false, hubCost: 11, lines: ['東急田園都市線'], directCost: 78, directFee: 4.0, directSlots: 6 },
    { id: 'ex_yoga', name: '用賀', lat: 35.6264, lng: 139.6339, hub: false, major: true, hubCost: 13, lines: ['東急田園都市線'], directCost: 75, directFee: 4.0, directSlots: 8 },
    { id: 'ex_futako', name: '二子玉川', lat: 35.6114, lng: 139.6268, hub: false, major: true, hubCost: 15, lines: ['東急田園都市線'], directCost: 65, directFee: 3.5, directSlots: 8 },
    { id: 'ex_futakoshinchi', name: '二子新地', lat: 35.6072, lng: 139.6226, hub: false, major: false, hubCost: 17, lines: ['東急田園都市線'], directCost: 65, directFee: 3.4, directSlots: 6 },
    { id: 'ex_takatsu', name: '高津', lat: 35.6033, lng: 139.6170, hub: false, major: false, hubCost: 18, lines: ['東急田園都市線'], directCost: 65, directFee: 3.4, directSlots: 6 },
    { id: 'ex_mizonokuchi', name: '溝の口', lat: 35.5998, lng: 139.6105, hub: false, major: true, hubCost: 19, lines: ['東急田園都市線', 'JR南武線'], directCost: 68, directFee: 3.5, directSlots: 8 },
    { id: 'ex_kajigaya', name: '梶が谷', lat: 35.5934, lng: 139.6056, hub: false, major: false, hubCost: 21, lines: ['東急田園都市線'], directCost: 62, directFee: 3.2, directSlots: 6 },
    { id: 'ex_miyazakidai', name: '宮崎台', lat: 35.5872, lng: 139.5914, hub: false, major: false, hubCost: 23, lines: ['東急田園都市線'], directCost: 60, directFee: 3.0, directSlots: 6 },
    { id: 'ex_miyamaedaira', name: '宮前平', lat: 35.5846, lng: 139.5815, hub: false, major: false, hubCost: 24, lines: ['東急田園都市線'], directCost: 60, directFee: 3.0, directSlots: 6 },
    { id: 'ex_saginuma', name: '鷺沼', lat: 35.5797, lng: 139.5731, hub: false, major: true, hubCost: 24, lines: ['東急田園都市線'], directCost: 62, directFee: 3.1, directSlots: 8 },
    { id: 'ex_tamaplaza', name: 'たまプラーザ', lat: 35.5772, lng: 139.5584, hub: false, major: true, hubCost: 26, lines: ['東急田園都市線'], directCost: 62, directFee: 3.1, directSlots: 8 },

    // JR南武線（府中本町〜武蔵溝ノ口）
    { id: 'ex_fuchuhonmachi', name: '府中本町', lat: 35.6662, lng: 139.4772, hub: false, major: true, hubCost: 30, lines: ['JR南武線'], directCost: 60, directFee: 3.0, directSlots: 6 },
    { id: 'ex_minamitama', name: '南多摩', lat: 35.6499, lng: 139.4900, hub: false, major: false, hubCost: 31, lines: ['JR南武線'], directCost: 58, directFee: 2.9, directSlots: 6 },
    { id: 'ex_inaginaganuma', name: '稲城長沼', lat: 35.6414, lng: 139.5004, hub: false, major: false, hubCost: 30, lines: ['JR南武線'], directCost: 58, directFee: 2.9, directSlots: 6 },
    { id: 'ex_yanokuchi', name: '矢野口', lat: 35.6419, lng: 139.5194, hub: false, major: false, hubCost: 28, lines: ['JR南武線'], directCost: 58, directFee: 2.9, directSlots: 6 },
    { id: 'ex_inadazutsumi', name: '稲田堤', lat: 35.6335, lng: 139.5335, hub: false, major: false, hubCost: 26, lines: ['JR南武線'], directCost: 60, directFee: 3.0, directSlots: 6 },
    { id: 'ex_nakanoshima', name: '中野島', lat: 35.6305, lng: 139.5515, hub: false, major: false, hubCost: 24, lines: ['JR南武線'], directCost: 62, directFee: 3.1, directSlots: 6 },
    { id: 'ex_shukugawara', name: '宿河原', lat: 35.6147, lng: 139.5792, hub: false, major: false, hubCost: 22, lines: ['JR南武線'], directCost: 64, directFee: 3.2, directSlots: 6 },
    { id: 'ex_kuji', name: '久地', lat: 35.6122, lng: 139.5906, hub: false, major: false, hubCost: 22, lines: ['JR南武線'], directCost: 64, directFee: 3.2, directSlots: 6 },
    { id: 'ex_tsudayama', name: '津田山', lat: 35.6057, lng: 139.6010, hub: false, major: false, hubCost: 21, lines: ['JR南武線'], directCost: 65, directFee: 3.3, directSlots: 6 }
  ];

  const EXISTING_LINES = [
    {
      name: '京王線', color: '#db2777',
      stations: ['ex_shinjuku', 'ex_sasazuka', 'ex_daitabashi', 'ex_meidaimae', 'ex_shimotakaido', 'ex_sakurajosui', 'ex_kamikitazawa', 'ex_hachimanyama', 'ex_rokakoen', 'ex_chitosekarasuyama', 'ex_sengawa', 'ex_tsutsuji', 'ex_shibasaki', 'ex_kokuryo', 'ex_fuda', 'ex_chofu', 'ex_nishichofu', 'ex_tobitakyu', 'ex_musashinodai', 'ex_tamareien', 'ex_higashifuchu', 'ex_fuchu']
    },
    {
      name: '京王相模原線', color: '#ec4899',
      stations: ['ex_chofu', 'ex_keiotamagawa', 'ex_keioinadazutsumi', 'ex_keioyomiuri', 'ex_inagi', 'ex_wakabadai', 'ex_nagayama', 'ex_tamacenter']
    },
    {
      name: '小田急線', color: '#2563eb',
      stations: ['ex_shinjuku', 'ex_yoyogiuehara', 'ex_shimokitazawa', 'ex_umegaoka', 'ex_gotokuji', 'ex_kyodo', 'ex_chitosefunabashi', 'ex_soshigaya', 'ex_seijo', 'ex_kitami', 'ex_komae', 'ex_izumitamagawa', 'ex_noborito', 'ex_mukogaoka', 'ex_ikuta', 'ex_yomiurilandmae', 'ex_yurigaoka', 'ex_shinyuri', 'ex_kakio', 'ex_tsurukawa', 'ex_tamagawagakuen', 'ex_machida']
    },
    {
      name: '小田急多摩線', color: '#3b82f6',
      stations: ['ex_shinyuri', 'ex_satsukidai', 'ex_kurihira', 'ex_kurokawa', 'ex_haruhino', 'ex_nagayama', 'ex_tamacenter']
    },
    {
      name: '東急田園都市線', color: '#16a34a',
      stations: ['ex_shibuya', 'ex_ikejiri', 'ex_sangenjaya', 'ex_komazawa', 'ex_sakurashinmachi', 'ex_yoga', 'ex_futako', 'ex_futakoshinchi', 'ex_takatsu', 'ex_mizonokuchi', 'ex_kajigaya', 'ex_miyazakidai', 'ex_miyamaedaira', 'ex_saginuma', 'ex_tamaplaza']
    },
    {
      name: 'JR南武線', color: '#eab308',
      stations: ['ex_fuchuhonmachi', 'ex_minamitama', 'ex_inaginaganuma', 'ex_yanokuchi', 'ex_inadazutsumi', 'ex_nakanoshima', 'ex_noborito', 'ex_shukugawara', 'ex_kuji', 'ex_tsudayama', 'ex_mizonokuchi']
    }
  ];

  const STRUCTURES = {
    surface:     { id: 'surface',     name: '地上', tag: '地上', costMult: 1.0,  upkeepMult: 1.0,  desc: '最安。幹線道路交差で踏切発生・建物密集地は用地費増' },
    elevated:    { id: 'elevated',    name: '高架', tag: '高架', costMult: 1.48, upkeepMult: 1.25, desc: '連続立体交差で踏切ゼロ。建物密集地は用地買収が必要' },
    underground: { id: 'underground', name: '地下', tag: '地下', costMult: 2.15, upkeepMult: 1.55, desc: '用地買収不要＆踏切ゼロ。既存道路下を通すとシールド割引-20%' }
  };

  const ZONINGS = {
    residential: { id: 'residential', name: '住宅重視', color: '#f59e0b', desc: '人口流入+35% / 朝夕通勤需要UP', popMult: 1.35, commMult: 0.9 },
    commercial:  { id: 'commercial',  name: '商業重視', color: '#0ea5e9', desc: '魅力度+35% / 駅ナカ・商業収益UP', popMult: 1.0, commMult: 1.35 },
    office:      { id: 'office',      name: 'オフィス', color: '#6366f1', desc: '魅力度+40% / 都心逆方向需要UP', popMult: 0.85, commMult: 1.4 },
    tourism:     { id: 'tourism',     name: '観光・自然', color: '#10b981', desc: '休日下り需要UP / 住環境ボーナス', popMult: 1.1, commMult: 1.15 }
  };

  const LANDMARKS = [
    { id: 'dept', name: '駅直結商業ビル', tag: '商業', cost: 45, upkeep: 1.2, popAdd: 300, commAdd: 22, revAdd: 3.8, weekendBoost: 1.15, color: '#0ea5e9', desc: '商業魅力度と月間不動産収益を大きく底上げ' },
    { id: 'tower', name: 'タワーマンション群', tag: '住宅', cost: 55, upkeep: 1.0, popAdd: 4800, commAdd: 8, revAdd: 3.2, weekendBoost: 1.0, color: '#f59e0b', desc: '駅勢圏の居住人口を即座に大幅増加' },
    { id: 'univ', name: '私立大学キャンパス', tag: '大学', cost: 65, upkeep: 1.5, popAdd: 1800, commAdd: 26, revAdd: 2.5, weekendBoost: 1.1, color: '#a855f7', desc: '郊外でも安定した通学・下り需要を創出' },
    { id: 'park', name: '大型テーマパーク', tag: '観光', cost: 90, upkeep: 2.4, popAdd: 500, commAdd: 38, revAdd: 5.5, weekendBoost: 1.55, color: '#f43f5e', desc: '休日の下り特急・急行需要を爆発的に増加' },
    { id: 'outlet', name: 'アウトレットモール', tag: '買物', cost: 70, upkeep: 1.8, popAdd: 400, commAdd: 30, revAdd: 4.8, weekendBoost: 1.38, color: '#14b8a6', desc: '広域から買い物客を集め商業収益を拡大' },
    { id: 'stadium', name: '多目的スタジアム', tag: '集客', cost: 85, upkeep: 2.0, popAdd: 600, commAdd: 34, revAdd: 4.6, weekendBoost: 1.45, color: '#f97316', desc: 'イベント時の爆発的な乗降客と話題性を獲得' }
  ];

  // 東京西南部・川崎エリアの実在地名（町名・地域名・公園名）
  const LOCAL_PLACES = [
    // 世田谷区
    { name: '砧', lat: 35.6352, lng: 139.6122 },
    { name: '大蔵', lat: 35.6310, lng: 139.6185 },
    { name: '砧公園', lat: 35.6303, lng: 139.6203 },
    { name: '岡本', lat: 35.6228, lng: 139.6205 },
    { name: '瀬田', lat: 35.6195, lng: 139.6305 },
    { name: '玉川', lat: 35.6135, lng: 139.6275 },
    { name: '上野毛', lat: 35.6122, lng: 139.6388 },
    { name: '等々力', lat: 35.6085, lng: 139.6480 },
    { name: '尾山台', lat: 35.6072, lng: 139.6538 },
    { name: '深沢', lat: 35.6215, lng: 139.6525 },
    { name: '駒沢', lat: 35.6285, lng: 139.6605 },
    { name: '弦巻', lat: 35.6385, lng: 139.6465 },
    { name: '桜新町', lat: 35.6317, lng: 139.6445 },
    { name: '用賀', lat: 35.6264, lng: 139.6339 },
    { name: '上用賀', lat: 35.6340, lng: 139.6288 },
    { name: '馬事公苑', lat: 35.6365, lng: 139.6335 },
    { name: '宇奈根', lat: 35.6218, lng: 139.6050 },
    { name: '鎌田', lat: 35.6188, lng: 139.6142 },
    { name: '喜多見', lat: 35.6328, lng: 139.5915 },
    { name: '成城', lat: 35.6415, lng: 139.6005 },
    { name: '祖師谷', lat: 35.6478, lng: 139.6080 },
    { name: '千歳台', lat: 35.6522, lng: 139.6125 },
    { name: '船橋', lat: 35.6528, lng: 139.6225 },
    { name: '経堂', lat: 35.6511, lng: 139.6368 },
    { name: '宮坂', lat: 35.6510, lng: 139.6440 },
    { name: '豪徳寺', lat: 35.6538, lng: 139.6474 },
    { name: '桜丘', lat: 35.6435, lng: 139.6280 },
    { name: '松原', lat: 35.6645, lng: 139.6470 },
    { name: '赤堤', lat: 35.6615, lng: 139.6410 },
    { name: '上北沢', lat: 35.6690, lng: 139.6231 },
    { name: '八幡山', lat: 35.6697, lng: 139.6156 },
    { name: '粕谷', lat: 35.6625, lng: 139.6095 },
    { name: '烏山', lat: 35.6681, lng: 139.6009 },
    { name: '給田', lat: 35.6655, lng: 139.5930 },
    { name: '若林', lat: 35.6462, lng: 139.6595 },
    { name: '太子堂', lat: 35.6460, lng: 139.6715 },
    { name: '三宿', lat: 35.6485, lng: 139.6795 },
    { name: '池尻', lat: 35.6515, lng: 139.6855 },
    { name: '梅丘', lat: 35.6557, lng: 139.6536 },
    { name: '代沢', lat: 35.6565, lng: 139.6695 },
    { name: '世田谷', lat: 35.6445, lng: 139.6530 },
    { name: '奥沢', lat: 35.6050, lng: 139.6680 },
    // 狛江市
    { name: '和泉本町', lat: 35.6365, lng: 139.5750 },
    { name: '岩戸北', lat: 35.6350, lng: 139.5835 },
    { name: '岩戸南', lat: 35.6295, lng: 139.5845 },
    { name: '駒井町', lat: 35.6258, lng: 139.5840 },
    { name: '猪方', lat: 35.6265, lng: 139.5785 },
    { name: '中和泉', lat: 35.6345, lng: 139.5685 },
    { name: '西和泉', lat: 35.6375, lng: 139.5665 },
    { name: '東野川', lat: 35.6435, lng: 139.5825 },
    { name: '西野川', lat: 35.6445, lng: 139.5745 },
    { name: '元和泉', lat: 35.6320, lng: 139.5715 },
    // 調布市
    { name: '国領', lat: 35.6502, lng: 139.5582 },
    { name: '布田', lat: 35.6499, lng: 139.5517 },
    { name: '染地', lat: 35.6410, lng: 139.5540 },
    { name: '小島町', lat: 35.6495, lng: 139.5430 },
    { name: '富士見町', lat: 35.6585, lng: 139.5405 },
    { name: '佐須町', lat: 35.6590, lng: 139.5530 },
    { name: '深大寺', lat: 35.6675, lng: 139.5495 },
    { name: '柴崎', lat: 35.6540, lng: 139.5666 },
    { name: '菊野台', lat: 35.6545, lng: 139.5710 },
    { name: '仙川', lat: 35.6623, lng: 139.5849 },
    { name: '緑ヶ丘', lat: 35.6685, lng: 139.5835 },
    { name: '入間町', lat: 35.6515, lng: 139.5870 },
    { name: '若葉町', lat: 35.6575, lng: 139.5840 },
    { name: '上石原', lat: 35.6565, lng: 139.5280 },
    { name: '下石原', lat: 35.6515, lng: 139.5320 },
    { name: '飛田給', lat: 35.6602, lng: 139.5234 },
    { name: '野水', lat: 35.6750, lng: 139.5245 },
    // 三鷹市・府中市
    { name: '大沢', lat: 35.6775, lng: 139.5365 },
    { name: '新川', lat: 35.6795, lng: 139.5720 },
    { name: '中原', lat: 35.6730, lng: 139.5740 },
    { name: '白糸台', lat: 35.6635, lng: 139.5125 },
    { name: '押立町', lat: 35.6535, lng: 139.5145 },
    { name: '小柳町', lat: 35.6565, lng: 139.5030 },
    { name: '清水が丘', lat: 35.6645, lng: 139.4985 },
    { name: '若松町', lat: 35.6745, lng: 139.4980 },
    { name: '紅葉丘', lat: 35.6740, lng: 139.5110 },
    { name: '是政', lat: 35.6575, lng: 139.4895 },
    { name: '矢崎町', lat: 35.6605, lng: 139.4805 },
    { name: '分梅', lat: 35.6695, lng: 139.4685 },
    { name: '中河原', lat: 35.6595, lng: 139.4580 },
    // 稲城市
    { name: '矢野口', lat: 35.6419, lng: 139.5194 },
    { name: '押立', lat: 35.6470, lng: 139.5105 },
    { name: '東長沼', lat: 35.6410, lng: 139.5015 },
    { name: '大丸', lat: 35.6485, lng: 139.4910 },
    { name: '百村', lat: 35.6350, lng: 139.4970 },
    { name: '坂浜', lat: 35.6245, lng: 139.4840 },
    { name: '平尾', lat: 35.6115, lng: 139.4920 },
    { name: '若葉台', lat: 35.6194, lng: 139.4725 },
    { name: '長峰', lat: 35.6275, lng: 139.4745 },
    { name: '向陽台', lat: 35.6355, lng: 139.4845 },
    // 多摩市
    { name: '連光寺', lat: 35.6435, lng: 139.4650 },
    { name: '聖ヶ丘', lat: 35.6345, lng: 139.4630 },
    { name: '馬引沢', lat: 35.6335, lng: 139.4520 },
    { name: '諏訪', lat: 35.6245, lng: 139.4515 },
    { name: '永山', lat: 35.6299, lng: 139.4479 },
    { name: '貝取', lat: 35.6250, lng: 139.4395 },
    { name: '豊ヶ丘', lat: 35.6210, lng: 139.4340 },
    { name: '落合', lat: 35.6185, lng: 139.4235 },
    { name: '鶴牧', lat: 35.6205, lng: 139.4150 },
    { name: '唐木田', lat: 35.6115, lng: 139.4135 },
    { name: '関戸', lat: 35.6485, lng: 139.4475 },
    { name: '愛宕', lat: 35.6355, lng: 139.4305 },
    // 町田市
    { name: '鶴川', lat: 35.5818, lng: 139.4820 },
    { name: '能ヶ谷', lat: 35.5835, lng: 139.4865 },
    { name: '広袴', lat: 35.5915, lng: 139.4795 },
    { name: '真光寺', lat: 35.5985, lng: 139.4730 },
    { name: '野津田', lat: 35.5910, lng: 139.4535 },
    { name: '小野路', lat: 35.6025, lng: 139.4480 },
    { name: '薬師池', lat: 35.5815, lng: 139.4475 },
    { name: '金井', lat: 35.5755, lng: 139.4575 },
    { name: '玉川学園', lat: 35.5637, lng: 139.4633 },
    { name: '本町田', lat: 35.5625, lng: 139.4465 },
    { name: '森野', lat: 35.5495, lng: 139.4405 },
    { name: '原町田', lat: 35.5435, lng: 139.4495 },
    { name: '成瀬', lat: 35.5355, lng: 139.4735 },
    // 川崎市多摩区・麻生区・高津区・宮前区
    { name: '登戸', lat: 35.6208, lng: 139.5698 },
    { name: '宿河原', lat: 35.6147, lng: 139.5792 },
    { name: '堰', lat: 35.6120, lng: 139.5865 },
    { name: '久地', lat: 35.6122, lng: 139.5906 },
    { name: '中野島', lat: 35.6305, lng: 139.5515 },
    { name: '菅', lat: 35.6350, lng: 139.5355 },
    { name: '枡形', lat: 35.6125, lng: 139.5585 },
    { name: '生田', lat: 35.6152, lng: 139.5419 },
    { name: '三田', lat: 35.6115, lng: 139.5445 },
    { name: '長沢', lat: 35.6025, lng: 139.5460 },
    { name: '南生田', lat: 35.6065, lng: 139.5345 },
    { name: '西生田', lat: 35.6165, lng: 139.5260 },
    { name: '細山', lat: 35.6215, lng: 139.5145 },
    { name: '千代ヶ丘', lat: 35.6125, lng: 139.5130 },
    { name: '高石', lat: 35.6135, lng: 139.5190 },
    { name: '百合丘', lat: 35.6087, lng: 139.5169 },
    { name: '万福寺', lat: 35.6075, lng: 139.5065 },
    { name: '上麻生', lat: 35.6005, lng: 139.5065 },
    { name: '王禅寺', lat: 35.5915, lng: 139.5165 },
    { name: '虹ヶ丘', lat: 35.5885, lng: 139.5270 },
    { name: '片平', lat: 35.5990, lng: 139.4895 },
    { name: '栗平', lat: 35.6054, lng: 139.4806 },
    { name: '黒川', lat: 35.6130, lng: 139.4682 },
    { name: '溝口', lat: 35.5998, lng: 139.6105 },
    { name: '二子', lat: 35.6072, lng: 139.6226 },
    { name: '久本', lat: 35.5955, lng: 139.6165 },
    { name: '末長', lat: 35.5915, lng: 139.6135 },
    { name: '梶ヶ谷', lat: 35.5934, lng: 139.6056 },
    { name: '宮崎台', lat: 35.5872, lng: 139.5914 },
    { name: '宮前平', lat: 35.5846, lng: 139.5815 },
    { name: '鷺沼', lat: 35.5797, lng: 139.5731 },
    { name: '犬蔵', lat: 35.5865, lng: 139.5620 },
    { name: '菅生', lat: 35.5965, lng: 139.5580 },
    { name: '土橋', lat: 35.5815, lng: 139.5785 }
  ];

  // 日本全国エリアプリセット（任意地点へ移動して実在路線を動的読込可能）
  const JAPAN_PRESETS = [
    { id: 'tokyo_west', name: '東京西南部（軽量）', lat: 35.626, lng: 139.555, zoom: 12.2, useBuiltin: true },
    { id: 'kanto_all',  name: '関東全域（首都圏一括）', lat: 35.6812, lng: 139.7671, zoom: 10.6, bbox: [35.12, 138.95, 36.38, 140.85] },
    { id: 'kansai_all', name: '関西全域（京阪神一括）', lat: 34.7025, lng: 135.4959, zoom: 10.6, bbox: [34.25, 134.85, 35.18, 136.15] },
    { id: 'chubu_all',  name: '中京圏（名古屋周辺）', lat: 35.1709, lng: 136.8815, zoom: 10.8, bbox: [34.65, 136.35, 35.60, 137.45] },
    { id: 'fukuoka',    name: '北部九州（福岡・北九州）', lat: 33.5902, lng: 130.4017, zoom: 10.8, bbox: [33.20, 130.00, 33.98, 131.05] },
    { id: 'sapporo',    name: '札幌圏', lat: 43.0687, lng: 141.3508, zoom: 11.2, bbox: [42.75, 140.85, 43.35, 141.80] },
    { id: 'sendai',     name: '仙台圏', lat: 38.2601, lng: 140.8824, zoom: 11.2, bbox: [37.90, 140.50, 38.55, 141.35] }
  ];

  // 鉄道事業者・路線名キーワード別の標準カラー
  const OPERATOR_COLORS = [
    { kw: 'JR', color: '#16a34a' },
    { kw: '東日本旅客鉄道', color: '#16a34a' },
    { kw: '東海旅客鉄道', color: '#f97316' },
    { kw: '西日本旅客鉄道', color: '#2563eb' },
    { kw: '九州旅客鉄道', color: '#dc2626' },
    { kw: '北海道旅客鉄道', color: '#22c55e' },
    { kw: '京王', color: '#db2777' },
    { kw: '小田急', color: '#2563eb' },
    { kw: '東急', color: '#dc2626' },
    { kw: '東京急行', color: '#dc2626' },
    { kw: '西武', color: '#0284c7' },
    { kw: '東武', color: '#1d4ed8' },
    { kw: '京急', color: '#e11d48' },
    { kw: '京成', color: '#1e40af' },
    { kw: 'メトロ', color: '#06b6d4' },
    { kw: '都営', color: '#10b981' },
    { kw: '相鉄', color: '#1e3a8a' },
    { kw: '阪急', color: '#7f1d1d' },
    { kw: '阪神', color: '#ea580c' },
    { kw: '京阪', color: '#15803d' },
    { kw: '近鉄', color: '#b91c1c' },
    { kw: '南海', color: '#0369a1' },
    { kw: '名鉄', color: '#dc2626' },
    { kw: '西鉄', color: '#2563eb' },
    { kw: '地下鉄', color: '#0ea5e9' }
  ];
  return {
    MUNICIPALITIES,
    EXISTING_STATIONS,
    EXISTING_LINES,
    LOCAL_PLACES,
    JAPAN_PRESETS,
    OPERATOR_COLORS,
    STRUCTURES,
    ZONINGS,
    LANDMARKS
  };
})();
