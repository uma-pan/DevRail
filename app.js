(() => {
  'use strict';
  // =========================================================================
  // 1. 効果音（Web Audio API）
  // =========================================================================
  const IS_MOBILE = window.innerWidth < 900;
  const IS_TOUCH = (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window && IS_MOBILE);
  let audioCtx = null;
  let isMuted = false;

  function ensureAudio() {
    if (isMuted) return null;
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playSfx(type) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'tap') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(680, now + 0.05);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.start(now);
      osc.stop(now + 0.065);
    } else if (type === 'build') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(360, now);
      osc.frequency.setValueAtTime(540, now + 0.06);
      osc.frequency.setValueAtTime(720, now + 0.12);
      gain.gain.setValueAtTime(0.11, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'direct') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(554.37, now + 0.08);
      osc.frequency.setValueAtTime(659.25, now + 0.16);
      osc.frequency.setValueAtTime(880, now + 0.24);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
      osc.start(now);
      osc.stop(now + 0.44);
    } else if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.linearRampToValueAtTime(130, now + 0.14);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.start(now);
      osc.stop(now + 0.17);
    } else if (type === 'month') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(620, now);
      osc.frequency.setValueAtTime(780, now + 0.05);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.13);
    }
  }

  const {
    MUNICIPALITIES,
    EXISTING_STATIONS: BUILTIN_STATIONS,
    EXISTING_LINES: BUILTIN_LINES,
    LOCAL_PLACES,
    JAPAN_PRESETS,
    OPERATOR_COLORS,
    STRUCTURES,
    ZONINGS,
    LANDMARKS,
    ROAD_TYPES,
    REDEV_TOOLS
  } = window.RAIL_DATA;

  const {
    haversineKm,
    toLocalMeters,
    fromLocalMeters,
    calcRadiusMeters,
    buildTangentArc,
    speedLimitForRadius,
    makeBuildingPolygon,
    makeRotatedRect,
    makeCirclePolygon,
    makeEllipsePolygon,
    makeBufferPolygonAroundPolyline,
    isPointInRing,
    projectPointToSegmentLocal,
    buildDevelopmentFeatures
  } = window.RAIL_GEO;

  // 動的差し替え可能な既存駅・既存路線データ（初期値は東京西南部、全国どこでもOSMから全路線読込可能）
  let EXISTING_STATIONS = BUILTIN_STATIONS.slice();
  let EXISTING_LINES = BUILTIN_LINES.slice();
  let customExistingLinesGeoJSON = null;
  let loadedOsmWayIds = new Set();
  let osmLoading = false;
  let cachedPlaceLabelLayers = [];
  let cachedRoadLayers = [];

  // =========================================================================
  // 3. 地理計算ユーティリティ
  // =========================================================================
  function getNearestMunicipality(lat, lng) {
    let best = MUNICIPALITIES[0];
    let bestDist = Infinity;
    for (const m of MUNICIPALITIES) {
      const d = haversineKm(lat, lng, m.lat, m.lng);
      if (d < bestDist) {
        bestDist = d;
        best = m;
      }
    }
    if (bestDist <= 14) return best;
    // 東京西南部エリア外：周辺の既存駅密度から都市規模を自動推定（高速BBox枝刈り付き）
    let nearbyStations = 0;
    const dLat35 = 0.035, dLng35 = 0.045;
    for (const ex of EXISTING_STATIONS) {
      if (Math.abs(ex.lat - lat) > dLat35 || Math.abs(ex.lng - lng) > dLng35) continue;
      if (haversineKm(lat, lng, ex.lat, ex.lng) <= 3.5) nearbyStations += 1;
    }
    const density = Math.min(18000, Math.max(2200, 2800 + nearbyStations * 1350));
    const commBase = Math.min(92, Math.max(30, 32 + nearbyStations * 6));
    const priceBase = Math.min(88, Math.max(24, 26 + nearbyStations * 5));
    const mapPlace = getPlaceNameFromMapTiles(lat, lng);
    return {
      id: 'dyn_area',
      name: mapPlace || '選択エリア',
      pop: Math.round(density * 20),
      area: 20,
      lat,
      lng,
      commBase,
      priceBase
    };
  }

  function getNearestExistingStation(lat, lng, maxKm = 0.65) {
    let best = null;
    let bestDist = maxKm;
    const dLatMax = maxKm / 110.5;
    const dLngMax = maxKm / 85.0;
    for (const ex of EXISTING_STATIONS) {
      if (Math.abs(ex.lat - lat) > dLatMax || Math.abs(ex.lng - lng) > dLngMax) continue;
      const d = haversineKm(lat, lng, ex.lat, ex.lng);
      if (d < bestDist) {
        bestDist = d;
        best = ex;
      }
    }
    return best;
  }

  function getNearestLocalPlace(lat, lng, maxKm = 3.0) {
    if (!LOCAL_PLACES || LOCAL_PLACES.length === 0) return null;
    let best = null;
    let bestDist = maxKm;
    for (const lp of LOCAL_PLACES) {
      const d = haversineKm(lat, lng, lp.lat, lp.lng);
      if (d < bestDist) {
        bestDist = d;
        best = lp;
      }
    }
    return best;
  }

  // 既存駅との物理距離に応じた乗り換え快適性・ペナルティ（分）
  function getTransferInfo(distM) {
    if (distM == null || !isFinite(distM)) {
      return { penaltyMin: 12, label: '徒歩乗換', canDirect: false, grade: 'far' };
    }
    const penaltyMin = Math.max(2, Math.min(14, Math.round(1.5 + distM / 55)));
    if (distM <= 120) return { penaltyMin, label: '直結級', canDirect: true, grade: 'best' };
    if (distM <= 260) return { penaltyMin, label: '連絡快適', canDirect: true, grade: 'good' };
    if (distM <= 380) return { penaltyMin, label: '徒歩連絡', canDirect: true, grade: 'ok' };
    return { penaltyMin, label: '徒歩長め', canDirect: false, grade: 'far' };
  }

  // 表示中の OpenFreeMap ベクトルタイルから全国の実在日本語地名を取得
  function getPlaceNameFromMapTiles(lat, lng) {
    if (!map || !mapReady || cachedPlaceLabelLayers.length === 0) return null;
    try {
      const pt = map.project([lng, lat]);
      const cw = map.getCanvas().clientWidth;
      const ch = map.getCanvas().clientHeight;
      if (pt.x < 0 || pt.y < 0 || pt.x > cw || pt.y > ch) return null;
      const r = 70;
      const feats = map.queryRenderedFeatures([[pt.x - r, pt.y - r], [pt.x + r, pt.y + r]], {
        layers: cachedPlaceLabelLayers
      });
      let bestName = null;
      let bestDist = Infinity;
      for (const f of feats) {
        const p = f.properties || {};
        const raw = p['name:ja'] || p.name || '';
        if (!raw || raw.length > 12 || /^[0-9A-Za-z\s\-]+$/.test(raw)) continue;
        if (raw.endsWith('都') || raw.endsWith('府') || raw.endsWith('県') || raw === '日本') continue;
        let d = 999;
        if (f.geometry && f.geometry.type === 'Point') {
          const [flng, flat] = f.geometry.coordinates;
          d = haversineKm(lat, lng, flat, flng);
        } else {
          d = 0.8;
        }
        if (d < bestDist) {
          bestDist = d;
          bestName = raw.replace(/駅$/, '');
        }
      }
      return bestName;
    } catch (_) {
      return null;
    }
  }

  // 実在の地域地名から重複しない駅名を決定（全国OpenFreeMap地名＋ローカル辞書）
  function pickStationName(lat, lng, nearEx, transferDistM, muni) {
    const used = new Set(state.myStations.map(s => s.name));
    if (nearEx && transferDistM != null && transferDistM <= 160) {
      if (!used.has(nearEx.name)) return nearEx.name;
      if (!used.has(`新${nearEx.name}`)) return `新${nearEx.name}`;
    }
    const mapPlace = getPlaceNameFromMapTiles(lat, lng);
    if (mapPlace && !used.has(mapPlace)) return mapPlace;
    if (LOCAL_PLACES && LOCAL_PLACES.length > 0) {
      const ranked = LOCAL_PLACES
        .map(lp => ({ name: lp.name, d: haversineKm(lat, lng, lp.lat, lp.lng) }))
        .filter(x => x.d <= 3.0)
        .sort((a, b) => a.d - b.d);
      for (const cand of ranked) {
        if (cand.d <= 1.6 && !used.has(cand.name)) return cand.name;
      }
      if (ranked.length > 0) {
        const base = ranked[0].name;
        if (!used.has(base)) return base;
        for (const suf of ['新', '公園', '台', '中央', '本町', '前']) {
          const nm = suf === '新' ? `新${base}` : `${base}${suf}`;
          if (!used.has(nm)) return nm;
        }
      }
    }
    const fallbackBase = (muni ? muni.name : '新線').replace(/[区市]/g, '');
    for (const suf of ['中央', '本町', '公園', '台', '新町', '丘']) {
      const nm = `${fallbackBase}${suf}`;
      if (!used.has(nm)) return nm;
    }
    return `${fallbackBase}${state.myStations.length + 1}`;
  }

  // 局所平面メートル座標変換（基準緯度）
  function analyzeAlignmentOnMap(coords, structure, muniPriceBase, fastPreview = false) {
    let lengthKm = 0;
    for (let i = 1; i < coords.length; i++) {
      lengthKm += haversineKm(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    }
    let minR = 9999;
    for (let k = 2; k < coords.length - 2; k += 2) {
      const r = calcRadiusMeters(coords[k - 2], coords[k], coords[k + 2]);
      if (r < minR) minR = r;
    }
    const minRadiusM = Math.round(Math.min(2000, minR));

    let majorRoadCrossings = 0;
    let roadSamples = 0;
    let waterSamples = 0;
    let buildingSamples = 0;
    const step = Math.max(1, Math.floor((coords.length - 2) / 6));
    let sampledCount = 0;

    // プレビュー（mousemove）中は queryRenderedFeatures を一切呼ばず完全軽量化
    if (!fastPreview && map && mapReady && cachedInfraLayers.length > 0) {
      try {
        const cw = map.getCanvas().clientWidth;
        const ch = map.getCanvas().clientHeight;
        let inMajorRoad = false;
        for (let i = 1; i < coords.length - 1; i += step) {
          const pt = map.project(coords[i]);
          if (pt.x < -10 || pt.y < -10 || pt.x > cw + 10 || pt.y > ch + 10) continue;
          sampledCount += 1;
          const bbox = [[pt.x - 4, pt.y - 4], [pt.x + 4, pt.y + 4]];
          const feats = map.queryRenderedFeatures(bbox, { layers: cachedInfraLayers });
          let hitMajor = false;
          let hitAnyRoad = false;
          let hitWater = false;
          let hitBuilding = false;
          for (const f of feats) {
            const sl = f.sourceLayer || '';
            const lid = (f.layer && f.layer.id) || '';
            if (sl === 'transportation' || lid.includes('road') || lid.includes('highway') || lid.includes('motorway')) {
              const cls = (f.properties && f.properties.class) || '';
              if (['motorway', 'trunk', 'primary', 'secondary'].includes(cls)) {
                hitMajor = true;
                hitAnyRoad = true;
              } else if (['tertiary', 'minor', 'residential', 'service', 'track'].includes(cls)) {
                hitAnyRoad = true;
              }
            } else if (sl === 'water' || sl === 'waterway' || lid.includes('water') || lid.includes('river')) {
              hitWater = true;
            } else if (sl === 'building' || lid.includes('building')) {
              hitBuilding = true;
            }
          }
          if (hitMajor && !inMajorRoad) majorRoadCrossings += 1;
          inMajorRoad = hitMajor;
          if (hitAnyRoad) roadSamples += 1;
          if (hitWater) waterSamples += 1;
          if (hitBuilding) buildingSamples += 1;
        }
      } catch (_) {}
    }

    const denom = Math.max(1, sampledCount);
    const roadFollowRatio = roadSamples / denom;
    const buildingDensity = buildingSamples / denom;
    const hasRiver = waterSamples > 0;
    const levelCrossings = structure === 'surface' ? majorRoadCrossings : 0;
    const roadUndergroundDiscount = structure === 'underground' && roadFollowRatio >= 0.30;

    // 構造別の現実的な線路敷設コスト算出（億円・短区間でも距離比例で適正化）
    const stDef = STRUCTURES[structure] || STRUCTURES.surface;
    const baseTrackCost = (lengthKm * 10.5) * stDef.costMult;
    const landAcqCost = structure === 'underground'
      ? lengthKm * muniPriceBase * 0.08
      : lengthKm * (muniPriceBase * 0.20 + buildingDensity * 8.0);
    const riverCost = hasRiver ? (structure === 'underground' ? 24 : 18) : 0;
    const curveCost = minRadiusM < 200 ? Math.min(6, lengthKm * 6) : 0;
    let totalCost = baseTrackCost + landAcqCost + riverCost + curveCost;
    if (roadUndergroundDiscount) totalCost *= 0.80;
    totalCost = Math.max(0.5, Math.round(totalCost * 10) / 10);

    // 曲線半径＋地上踏切による区間実効制限速度
    const curveCap = speedLimitForRadius(minRadiusM);
    const crossingPenaltyKmh = levelCrossings * 7;
    const maxSpeedKmh = Math.max(30, curveCap - crossingPenaltyKmh);

    return {
      lengthKm,
      minRadiusM,
      majorRoadCrossings,
      levelCrossings,
      hasRiver,
      buildingDensity,
      roadFollowRatio,
      roadUndergroundDiscount,
      landAcqCost: Math.round(landAcqCost),
      riverCost,
      totalCost,
      maxSpeedKmh,
      structure
    };
  }

  // =========================================================================
  // 4. ゲーム状態（State）
  // =========================================================================
  const state = {
    year: 2026,
    month: 4,
    tickInMonth: 0,
    speed: 1,
    funds: 2000.0,
    activeTab: 'route',
    buildMode: 'track', // 'track' | 'station' | 'road' | 'rotary' | 'redev' | 'landmark' | null
    selectedPoint: null, // { lat, lng, muni }
    selectedStationId: null,
    is25D: true,
    showSpeedHeat: true,
    tutorialVisible: true,
    tutorialSkippedDirect: false,
    buildStructure: 'elevated',
    activeEnd: 'end',
    hoverPreview: null,
    pendingTap: null, // タッチ環境での2ステップ確認用 { lat, lng, mode }
    panelCollapsed: false,
    undoStack: [],

    // 沿線開発・土地区画整理・道路再編の状態
    roadType: 'avenue', // 'avenue' | 'street' | 'erase'
    activeRoadChainId: null,
    activeRoadNodes: [], // 現在敷設中の道路チェーン制御点 [{ lng, lat }]
    redevTool: 'grid_block', // 'grid_block' | 'clear_lot'
    devAngleDeg: 0,
    devRoadSnap: true,
    selectedLandmarkId: 'mid_retail',
    redevZones: [],   // [{ id, type, polygon, centerLng, centerLat, costPaid }]
    customRoads: [],  // [{ id, chainId, roadType, coords, widthM, clearHalfM, clearPolygon, lengthKm, costPaid }]
    rotaries: [],     // [{ id, lat, lng, radiusM, clearRadiusM, stationId, clearPolygon, approachRoadIds, costPaid }]
    developments: [], // [{ id, landmarkId, stationId, lat, lng, angleRad, roadAligned, roadSource, costPaid }]

    trackNodes: [], // [{ id, lat, lng, costPaid }]
    myStations: [], // [{ ..., routeKm }] (線路上に設置した駅・routeKm昇順)
    segments: [], // [{ fromId, toId, structure, coords, lengthKm, startKm, endKm, minRadiusM, levelCrossings, hasRiver, maxSpeedKmh, roadUndergroundDiscount }]
    routePolyline: [], // 列車走行用の連続曲線座標 [{ lng, lat, cumKm }]
    directAgreements: {},
    services: [
      { id: 'local',   name: '各停', color: '#38bdf8', speed: 42, freq: 6, enabled: true,  direct: false, surcharge: 0,   stops: {} },
      { id: 'semi',    name: '準急', color: '#22c55e', speed: 55, freq: 4, enabled: false, direct: false, surcharge: 0,   stops: {} },
      { id: 'express', name: '急行', color: '#f97316', speed: 70, freq: 4, enabled: false, direct: false, surcharge: 0,   stops: {} },
      { id: 'limited', name: '特急', color: '#a855f7', speed: 88, freq: 2, enabled: false, direct: false, surcharge: 450, stops: {} }
    ],
    trains: [],
    finance: {
      fareRev: 0,
      expressRev: 0,
      estateRev: 0,
      trackCost: 0,
      opCost: 0,
      directCost: 0,
      landmarkCost: 0,
      netProfit: 0
    },
    history: {
      labels: [],
      corridorPop: [],
      profit: []
    },
    initialCorridorPop: 0
  };

  function createStationState({ id, name, lat, lng, hasPassing, existingId, transferDistM, zoning, routeKm }) {
    const muni = getNearestMunicipality(lat, lng);
    const density = muni.pop / muni.area; // 人/km²
    // 駅勢圏（半径約1km ≈ 3.14km²）の実在人口ベース初期値
    const areaPop = Math.round(density * 2.65);
    const exBoost = existingId ? 16 : 0;
    return {
      id,
      name,
      lat,
      lng,
      muniId: muni.id,
      muniName: muni.name,
      hasPassing: !!hasPassing,
      existingId: existingId || null,
      transferDistM: transferDistM != null ? transferDistM : null,
      zoning: zoning || (muni.commBase > 58 ? 'commercial' : 'residential'),
      landmark: null,
      areaPop,
      initialPop: areaPop,
      comm: Math.min(100, Math.round(muni.commBase * 0.8 + exBoost)),
      landPrice: Math.round(muni.priceBase * (existingId ? 1.2 : 0.95)),
      ridership: 0,
      hubTime: 48,
      congestion: 80,
      accessScore: 55,
      devLevel: 0,
      routeKm: routeKm || 0
    };
  }

  function initWorld() {
    state.trackNodes = [];
    state.activeEnd = 'end';
    state.undoStack = [];
    state.myStations = [];
    state.activeRoadChainId = null;
    state.activeRoadNodes = [];
    state.redevZones = [];
    state.customRoads = [];
    state.rotaries = [];
    state.developments = [];
    state.segments = [];
    state.routePolyline = [];
    state.directAgreements = {};
    state.services.forEach(sv => { sv.stops = {}; sv.direct = false; });
    state.selectedStationId = null;
    state.selectedPoint = { lat: 35.623, lng: 139.572, muni: getNearestMunicipality(35.623, 139.572) };
    state.buildMode = 'track';

    recalculateSimulation(false);
    state.initialCorridorPop = 0;
    recordHistory();
    rebuildTrainActors();
  }

  // =========================================================================
  // 5. シミュレーション計算エンジン
  // =========================================================================
  function getCorridorPop() {
    return state.myStations.reduce((acc, st) => acc + st.areaPop, 0);
  }

  function getConnectedDirectStations() {
    return state.myStations.filter(st => st.existingId && state.directAgreements[st.existingId]);
  }

  function hasIntermediatePassingTrack() {
    if (state.myStations.length <= 2) return true;
    for (let i = 1; i < state.myStations.length - 1; i++) {
      if (state.myStations[i].hasPassing) return true;
    }
    return false;
  }

  function projectPointToPolyline(lat, lng) {
    const poly = state.routePolyline;
    if (!poly || poly.length < 2) return null;
    let bestDist = Infinity;
    let bestPt = null;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const d = haversineKm(lat, lng, p.lat, p.lng);
      if (d < bestDist) {
        bestDist = d;
        bestPt = { lat: p.lat, lng: p.lng, routeKm: p.cumKm, distKm: d };
      }
    }
    return bestPt;
  }

  function rebuildRoutePolyline() {
    const polyline = [];
    let totalKm = 0;
    for (let i = 0; i < state.segments.length; i++) {
      const sg = state.segments[i];
      sg.startKm = totalKm;
      sg.coords.forEach((pt, idx) => {
        if (i > 0 && idx === 0) return;
        if (polyline.length > 0) {
          const lp = polyline[polyline.length - 1];
          totalKm += haversineKm(lp.lat, lp.lng, pt[1], pt[0]);
        }
        polyline.push({ lng: pt[0], lat: pt[1], cumKm: totalKm });
      });
      sg.endKm = totalKm;
      sg.lengthKm = sg.endKm - sg.startKm;
    }
    state.routePolyline = polyline;

    state.myStations.forEach(st => {
      const proj = projectPointToPolyline(st.lat, st.lng);
      if (proj) st.routeKm = proj.routeKm;
    });
    state.myStations.sort((a, b) => a.routeKm - b.routeKm);
  }

  function getLineLengthKm() {
    if (state.segments.length > 0) {
      return state.segments.reduce((acc, sg) => acc + sg.lengthKm, 0);
    }
    let km = 0;
    for (let i = 0; i < state.myStations.length - 1; i++) {
      const a = state.myStations[i];
      const b = state.myStations[i + 1];
      km += haversineKm(a.lat, a.lng, b.lat, b.lng);
    }
    return km;
  }

  function recalculateSimulation(advanceGrowth) {
    const n = state.myStations.length;
    if (n < 2) {
      state.myStations.forEach(st => {
        st.ridership = 0;
        st.congestion = 0;
      });
      state.finance = {
        fareRev: 0,
        expressRev: 0,
        estateRev: 0,
        trackCost: 0,
        opCost: 0,
        directCost: 0,
        landmarkCost: 0,
        netProfit: 0
      };
      return;
    }

    const hasPassing = hasIntermediatePassingTrack();
    const activeServices = state.services.filter(s => s.enabled && s.freq > 0);
    const hasAnyDirectAgreement = getConnectedDirectStations().length > 0;

    const cumKm = state.myStations.map(st => st.routeKm || 0);

    const gateways = [];
    state.myStations.forEach((st, idx) => {
      if (st.existingId) {
        const ex = EXISTING_STATIONS.find(e => e.id === st.existingId);
        if (ex) {
          gateways.push({
            idx,
            st,
            ex,
            isDirect: !!state.directAgreements[ex.id]
          });
        }
      }
    });

    let totalFareRev = 0;
    let totalExpressRev = 0;
    let totalEstateRev = 0;
    let totalLandmarkUpkeep = 0;
    let totalWeekendAttr = 0;

    // 駅ごとの沿道開発施設＆駅前ロータリー集計
    const stationDevMap = {};
    const stationRotaryMap = {};
    state.myStations.forEach(st => {
      stationDevMap[st.id] = { revAdd: 0, weekendBoost: 1.0, count: 0 };
      stationRotaryMap[st.id] = false;
    });
    state.rotaries.forEach(rot => {
      let bestSt = null, bestD = 0.30;
      state.myStations.forEach(st => {
        const d = haversineKm(st.lat, st.lng, rot.lat, rot.lng);
        if (d < bestD) { bestD = d; bestSt = st; }
      });
      if (bestSt) stationRotaryMap[bestSt.id] = true;
    });
    state.developments.forEach(dev => {
      const lm = LANDMARKS.find(l => l.id === dev.landmarkId);
      if (!lm) return;
      totalLandmarkUpkeep += lm.upkeep;
      const roadMult = dev.roadSource === 'rotary' ? 1.15 : (dev.roadAligned ? 1.0 : 0.80);
      totalWeekendAttr += lm.commAdd * lm.weekendBoost * roadMult;
      let bestSt = null, bestD = 1.25;
      state.myStations.forEach(st => {
        const d = haversineKm(st.lat, st.lng, dev.lat, dev.lng);
        if (d < bestD) { bestD = d; bestSt = st; }
      });
      if (bestSt && stationDevMap[bestSt.id]) {
        stationDevMap[bestSt.id].revAdd += lm.revAdd * roadMult;
        stationDevMap[bestSt.id].weekendBoost = Math.max(stationDevMap[bestSt.id].weekendBoost, lm.weekendBoost);
        stationDevMap[bestSt.id].count += 1;
      } else {
        totalEstateRev += lm.revAdd * roadMult * 0.55;
      }
    });
    state.myStations.forEach(st => {
      if (st.landmark) {
        const lm = LANDMARKS.find(l => l.id === st.landmark);
        if (lm) {
          totalWeekendAttr += lm.commAdd * lm.weekendBoost;
          totalLandmarkUpkeep += lm.upkeep;
        }
      }
    });

    state.myStations.forEach((st, i) => {
      let freqAtSt = 0;
      let expressFreqAtSt = 0;
      activeServices.forEach(sv => {
        if (sv.stops[st.id]) {
          freqAtSt += sv.freq;
          if (sv.surcharge > 0) expressFreqAtSt += sv.freq;
        }
      });

      const waitMin = freqAtSt > 0 ? Math.min(25, 30 / freqAtSt) : 35;
      let bestHubTime = 78;

      if (gateways.length > 0 && freqAtSt > 0) {
        for (const gw of gateways) {
          const distKm = Math.abs(cumKm[i] - cumKm[gw.idx]);
          let bestRunMin = Infinity;
          let canDirectHere = false;

          const loKm = Math.min(cumKm[i], cumKm[gw.idx]);
          const hiKm = Math.max(cumKm[i], cumKm[gw.idx]);
          activeServices.forEach(sv => {
            if (sv.stops[st.id] && sv.stops[gw.st.id]) {
              const isFast = sv.speed > 45;
              const baseEffSpeed = isFast && !hasPassing
                ? 42 + (sv.speed - 42) * 0.35
                : sv.speed;
              let runMin = 0;
              if (hiKm > loKm && state.segments.length > 0) {
                for (const sg of state.segments) {
                  const ovLo = Math.max(loKm, sg.startKm);
                  const ovHi = Math.min(hiKm, sg.endKm);
                  if (ovHi > ovLo) {
                    const segSpeed = Math.min(baseEffSpeed, sg.maxSpeedKmh);
                    runMin += ((ovHi - ovLo) / segSpeed) * 60;
                  }
                }
              } else {
                runMin = (distKm / baseEffSpeed) * 60;
              }
              if (runMin < bestRunMin) bestRunMin = runMin;
              if (gw.isDirect && sv.direct) canDirectHere = true;
            }
          });

          if (!isFinite(bestRunMin)) {
            bestRunMin = (distKm / 42) * 60 + 5;
          }

          const tInfo = getTransferInfo(gw.st.transferDistM);
          const transferPenalty = gw.ex.hub ? 0 : (canDirectHere ? 0 : tInfo.penaltyMin);
          const totalMin = gw.ex.hubCost + bestRunMin + waitMin + transferPenalty;
          if (totalMin < bestHubTime) bestHubTime = totalMin;
        }
      }

      const lm = st.landmark ? LANDMARKS.find(l => l.id === st.landmark) : null;
      const devAgg = stationDevMap[st.id] || { revAdd: 0, weekendBoost: 1.0, count: 0 };
      const hasRotary = !!stationRotaryMap[st.id];
      const lmRev = (lm ? lm.revAdd : 0) + devAgg.revAdd;
      const lmWeekend = Math.max(lm ? lm.weekendBoost : 1.0, devAgg.weekendBoost);
      if (hasRotary) bestHubTime = Math.max(6, bestHubTime - 2);
      const effectiveComm = Math.min(100, st.comm + (hasRotary ? 8 : 0));

      const rawAccess = Math.max(5, Math.min(100, 108 - (bestHubTime - 12) * 1.45));
      const commutingDemand = st.areaPop * (rawAccess / 100) * 0.32;
      const incomingDemand = (effectiveComm * 160) * (rawAccess / 100) * lmWeekend + (totalWeekendAttr * 18);
      const serviceFactor = freqAtSt > 0 ? Math.min(1.25, 0.55 + freqAtSt * 0.05) : 0.05;
      const ridership = Math.round((commutingDemand + incomingDemand) * serviceFactor);

      const hourlyCapacity = Math.max(1200, freqAtSt * 1450);
      const peakDemand = ridership * 0.14;
      const congestion = Math.min(220, Math.round((peakDemand / hourlyCapacity) * 100));
      const congPenalty = congestion > 120 ? (congestion - 120) * 0.12 : 0;

      const finalHubTime = Math.round(bestHubTime + congPenalty);
      const finalAccess = Math.max(5, Math.min(100, Math.round(108 - (finalHubTime - 12) * 1.45)));

      st.ridership = ridership;
      st.hubTime = finalHubTime;
      st.congestion = congestion;
      st.accessScore = finalAccess;

      totalFareRev += (ridership * 240 * 30) / 1e8;
      if (expressFreqAtSt > 0) {
        const expRiders = ridership * Math.min(0.24, expressFreqAtSt * 0.045) * lmWeekend;
        totalExpressRev += (expRiders * 450 * 30) / 1e8;
      }
      totalEstateRev += (st.comm * 0.025) + (st.devLevel * 0.04) + lmRev;

      if (advanceGrowth) {
        const z = ZONINGS[st.zoning] || ZONINGS.residential;
        const growthDrive = (finalAccess - 44) / 100;
        const congDrag = congestion > 155 ? -0.15 : 0;
        const cap = 125000;
        const headroom = Math.max(0.06, 1 - st.areaPop / cap);
        const deltaRate = (growthDrive + congDrag) * 0.011 * z.popMult * headroom;
        const popDelta = Math.round(st.areaPop * deltaRate);
        st.areaPop = Math.max(3000, st.areaPop + popDelta);

        const commDelta = growthDrive > 0 ? growthDrive * 0.8 * z.commMult : -0.05;
        st.comm = Math.max(12, Math.min(100, st.comm + commDelta));
        st.landPrice = Math.max(18, Math.min(120, st.landPrice + (popDelta > 0 ? 0.18 : 0)));

        // 沿線開発レベル（3D新規ビル群の高さ成長）
        if (growthDrive > 0) {
          st.devLevel = Math.min(100, st.devLevel + growthDrive * 3.2 * (lm ? 1.35 : 1.0));
        }
      }
    });

    const lineKm = getLineLengthKm();
    const passingCount = state.myStations.filter(s => s.hasPassing).length;
    const structTrackCost = state.segments.reduce((acc, sg) => {
      const m = (STRUCTURES[sg.structure] || STRUCTURES.surface).upkeepMult;
      return acc + sg.lengthKm * 0.22 * m + sg.levelCrossings * 0.12;
    }, 0);
    const trackCost = structTrackCost + state.myStations.length * 0.45 + passingCount * 0.35;

    let totalFreq = 0;
    let directFreq = 0;
    activeServices.forEach(sv => {
      totalFreq += sv.freq;
      if (sv.direct && hasAnyDirectAgreement) directFreq += sv.freq;
    });
    const opCost = totalFreq * (0.28 + lineKm * 0.025);

    let directFee = 0;
    getConnectedDirectStations().forEach(st => {
      const ex = EXISTING_STATIONS.find(e => e.id === st.existingId);
      if (ex) directFee += ex.directFee * (directFreq > 0 ? 1 : 0.35);
    });

    const totalRev = totalFareRev + totalExpressRev + totalEstateRev;
    const totalExp = trackCost + opCost + directFee + totalLandmarkUpkeep;
    const netProfit = totalRev - totalExp;

    state.finance = {
      fareRev: totalFareRev,
      expressRev: totalExpressRev,
      estateRev: totalEstateRev,
      trackCost,
      opCost,
      directCost: directFee,
      landmarkCost: totalLandmarkUpkeep,
      netProfit
    };

    if (advanceGrowth) {
      state.funds = Math.round((state.funds + netProfit) * 10) / 10;
    }
  }

  function recordHistory() {
    state.history.labels.push(`${state.year}/${state.month}`);
    state.history.corridorPop.push(getCorridorPop());
    state.history.profit.push(Math.round(state.finance.netProfit * 10) / 10);
    if (state.history.labels.length > 36) {
      state.history.labels.shift();
      state.history.corridorPop.shift();
      state.history.profit.shift();
    }
  }

  function rebuildTrainActors() {
    const actors = [];
    if (state.myStations.length < 2) {
      state.trains = [];
      return;
    }
    state.services.forEach(sv => {
      if (!sv.enabled || sv.freq <= 0) return;
      const count = Math.max(1, Math.min(4, Math.ceil(sv.freq / 3)));
      for (let i = 0; i < count; i++) {
        actors.push({
          serviceId: sv.id,
          color: sv.color,
          speed: sv.speed,
          progress: (i / count) * (state.myStations.length - 1),
          dir: i % 2 === 0 ? 1 : -1
        });
      }
    });
    state.trains = actors;
  }

  // =========================================================================
  // 6. MapLibre GL JS 実在2.5Dマップ（Subway Builder風スタイル）
  // =========================================================================
  let map = null;
  let mapReady = false;
  let stationMarkers = [];
  let cachedInfraLayers = [];
  let realBuildingLayerIds = [];
  let lastTrainRenderTs = 0;

  const FALLBACK_RASTER_STYLE = {
    version: 8,
    sources: {
      'arcgis-gray': {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}.jpg'],
        tileSize: 256,
        attribution: 'Esri'
      }
    },
    layers: [{ id: 'arcgis-gray-layer', type: 'raster', source: 'arcgis-gray' }]
  };

  function initMap() {
    if (typeof maplibregl === 'undefined') {
      showToast('地図ライブラリの読み込みに失敗しました');
      return;
    }

    map = new maplibregl.Map({
      container: 'map',
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [139.555, 35.626],
      zoom: IS_MOBILE ? 11.8 : 12.2,
      pitch: IS_MOBILE ? 20 : 35,
      bearing: IS_MOBILE ? 0 : -14,
      antialias: false,
      pixelRatio: 1,
      fadeDuration: 0,
      maxTileCacheSize: IS_MOBILE ? 16 : 32,
      maxPitch: IS_MOBILE ? 45 : 52
    });

    let fallbackTriggered = false;
    function triggerFallback() {
      if (mapReady || fallbackTriggered) return;
      fallbackTriggered = true;
      try { map.setStyle(FALLBACK_RASTER_STYLE); } catch (_) {}
    }

    const fallbackTimer = setTimeout(triggerFallback, 3500);
    map.on('error', () => {
      if (!mapReady) triggerFallback();
    });

    map.on('style.load', () => {
      clearTimeout(fallbackTimer);
      // Subway Builder風のクリーンな建築模型トーンに実在3D建物を調整
      try {
        const styleObj = map.getStyle();
        const layers = (styleObj && styleObj.layers) || [];
        let has3D = false;
        cachedInfraLayers = [];
        cachedRoadLayers = [];
        realBuildingLayerIds = [];
        cachedPlaceLabelLayers = [];
        layers.forEach(l => {
          const sl = l['source-layer'] || '';
          const lid = l.id || '';
          // 重い装飾・ラベル系レイヤーを非表示化して描画負荷を大幅削減
          if (
            sl === 'poi' || sl === 'housenumber' ||
            lid.includes('poi') || lid.includes('housenumber') ||
            lid.includes('aeroway') || lid.includes('waterway_label')
          ) {
            try { map.setLayoutProperty(lid, 'visibility', 'none'); } catch (_) {}
            return;
          }
          if (l.type === 'symbol' && (sl === 'place' || lid.includes('place') || lid.includes('label_city') || lid.includes('label_town') || lid.includes('label_village') || lid.includes('label_suburb') || lid.includes('label_neighbourhood'))) {
            cachedPlaceLabelLayers.push(lid);
          }
          // queryRenderedFeatures対象は主要な線・面レイヤーのみに絞る（casing/label/3D除外）
          if (
            (sl === 'transportation' || sl === 'water' || sl === 'waterway' || sl === 'building') &&
            l.type !== 'symbol' && l.type !== 'fill-extrusion' &&
            !lid.includes('casing') && !lid.includes('outline') && !lid.includes('label')
          ) {
            cachedInfraLayers.push(lid);
            if (sl === 'transportation' && l.type === 'line' && !lid.includes('rail') && !lid.includes('ferry') && !lid.includes('aeroway')) {
              cachedRoadLayers.push(lid);
            }
          }
          if (l.type === 'fill-extrusion') {
            has3D = true;
            realBuildingLayerIds.push(lid);
            map.setLayerZoomRange(lid, IS_MOBILE ? 16.0 : 15.2, 24);
            map.setPaintProperty(lid, 'fill-extrusion-color', '#e2e8f0');
            map.setPaintProperty(lid, 'fill-extrusion-opacity', 0.82);
          }
        });
        if (!has3D && styleObj && styleObj.sources && styleObj.sources.openmaptiles) {
          map.addLayer({
            id: 'custom-real-buildings-3d',
            type: 'fill-extrusion',
            source: 'openmaptiles',
            'source-layer': 'building',
            minzoom: IS_MOBILE ? 16.0 : 15.2,
            paint: {
              'fill-extrusion-color': '#e2e8f0',
              'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
              'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
              'fill-extrusion-opacity': 0.82
            }
          });
          realBuildingLayerIds.push('custom-real-buildings-3d');
        }
      } catch (_) {}

      setupGameMapLayers();
      mapReady = true;
      syncMapGeoJSON();
      syncStationMarkers();
    });

    let lastPreviewTs = 0;
    map.on('mousemove', (e) => {
      if (IS_TOUCH) return;
      if (!state.buildMode) {
        if (state.hoverPreview) clearPreviewTrack();
        return;
      }
      if (map.isMoving()) return;
      const now = performance.now();
      if (now - lastPreviewTs < 65) return;
      lastPreviewTs = now;
      showPreviewForCurrentMode(e.lngLat.lat, e.lngLat.lng);
    });

    map.on('click', (e) => {
      if (map.isMoving()) return;
      const lat = e.lngLat.lat;
      const lng = e.lngLat.lng;
      if (state.buildMode) {
        if (IS_TOUCH) {
          // タッチ環境: 1回目タップでプレビュー表示、同地点付近の再タップまたは「ここに確定」ボタンで建設（誤爆防止）
          if (state.pendingTap && state.pendingTap.mode === state.buildMode && state.hoverPreview && state.hoverPreview.valid !== false) {
            const p1 = map.project([state.pendingTap.lng, state.pendingTap.lat]);
            const p2 = map.project([lng, lat]);
            if (Math.hypot(p1.x - p2.x, p1.y - p2.y) <= 34) {
              executePlacementForCurrentMode(state.pendingTap.lat, state.pendingTap.lng);
              return;
            }
          }
          state.pendingTap = { lat, lng, mode: state.buildMode };
          showPreviewForCurrentMode(lat, lng);
          syncTouchConfirmButton();
          playSfx('tap');
          return;
        }
        executePlacementForCurrentMode(lat, lng);
      } else {
        // 近い自社駅があればそれを選択
        let hitMy = null;
        let bestD = 0.65;
        state.myStations.forEach(st => {
          const d = haversineKm(lat, lng, st.lat, st.lng);
          if (d < bestD) { bestD = d; hitMy = st; }
        });
        if (hitMy) {
          state.selectedStationId = hitMy.id;
          state.selectedPoint = { lat: hitMy.lat, lng: hitMy.lng, muni: getNearestMunicipality(hitMy.lat, hitMy.lng) };
        } else {
          state.selectedPoint = { lat, lng, muni: getNearestMunicipality(lat, lng) };
        }
        playSfx('tap');
        updateHUD();
        renderPanel();
        syncStationMarkers();
      }
    });
  }

  function setupGameMapLayers() { window.RAIL_LAYERS.setupGameMapLayers(map, buildExistingLinesGeoJSON, buildExistingStationsGeoJSON); }

  function pickOperatorColor(name, operator) {
    const src = `${operator || ''} ${name || ''}`;
    for (const item of OPERATOR_COLORS) {
      if (src.includes(item.kw)) return item.color;
    }
    return '#6366f1';
  }

  function buildExistingLinesGeoJSON() {
    if (customExistingLinesGeoJSON) return customExistingLinesGeoJSON;
    return {
      type: 'FeatureCollection',
      features: EXISTING_LINES.map(line => ({
        type: 'Feature',
        properties: { name: line.name, color: line.color },
        geometry: {
          type: 'LineString',
          coordinates: line.stations.map(id => {
            const ex = EXISTING_STATIONS.find(e => e.id === id);
            return ex ? [ex.lng, ex.lat] : null;
          }).filter(Boolean)
        }
      }))
    };
  }

  // OpenStreetMap Overpass API から広域（関東全域 150x180km 級）の全駅ノードのみを超軽量一括取得
  // ※線路ジオメトリ自体は OpenFreeMap ベクトルタイル（GPU直描画）で全国常時表示するため通信量・描画負荷を劇的に削減
  function parseOverpassStationsOnly(osmJson) {
    const rawStations = [];
    for (const el of (osmJson.elements || [])) {
      if (el.type !== 'node' || !el.tags) continue;
      if (el.tags.railway !== 'station' && el.tags.railway !== 'halt') continue;
      const nm = (el.tags['name:ja'] || el.tags.name || '').replace(/駅$/, '').trim();
      if (!nm) continue;
      rawStations.push({
        id: 'osm_' + el.id,
        name: nm,
        lat: el.lat,
        lng: el.lon,
        operator: el.tags.operator || el.tags.network || '',
        line: el.tags.line || el.tags.operator || '既存線'
      });
    }

    // 名前ごとに高速バケット化して近接同名駅（400m以内）を O(N) で統合
    const byName = new Map();
    const merged = [];
    for (const st of rawStations) {
      let list = byName.get(st.name);
      if (!list) { list = []; byName.set(st.name, list); }
      let found = null;
      for (const m of list) {
        if (Math.abs(m.lat - st.lat) < 0.004 && Math.abs(m.lng - st.lng) < 0.005 && haversineKm(m.lat, m.lng, st.lat, st.lng) < 0.40) {
          found = m;
          break;
        }
      }
      if (found) {
        if (st.line && !found.lines.includes(st.line)) found.lines.push(st.line);
        if (st.operator && !found.operators.includes(st.operator)) found.operators.push(st.operator);
        found.count += 1;
      } else {
        const entry = {
          id: st.id,
          name: st.name,
          lat: st.lat,
          lng: st.lng,
          lines: [st.line || '既存線'],
          operators: st.operator ? [st.operator] : [],
          count: 1
        };
        list.push(entry);
        merged.push(entry);
      }
    }

    // 複数事業者・複数路線が乗り入れる主要ターミナルを自動ハブ判定（広域では上位最大12駅）
    merged.forEach(m => {
      m.score = m.operators.length * 3 + m.lines.length * 2 + m.count;
    });
    const sorted = merged.slice().sort((a, b) => b.score - a.score);
    const hubCount = Math.min(12, Math.max(2, Math.floor(merged.length / 120)));
    const hubs = sorted.slice(0, hubCount);
    const hubIds = new Set(hubs.map(h => h.id));

    return merged.map(m => {
      const isHub = hubIds.has(m.id);
      const isMajor = isHub || m.operators.length >= 2 || m.lines.length >= 2 || m.count >= 2;
      let minHubKm = 0;
      if (!isHub && hubs.length > 0) {
        minHubKm = Math.min(...hubs.map(h => haversineKm(m.lat, m.lng, h.lat, h.lng)));
      }
      const hubCost = isHub ? 0 : Math.min(55, Math.round(4 + minHubKm * 1.45));
      return {
        id: m.id,
        name: m.name,
        lat: m.lat,
        lng: m.lng,
        hub: isHub,
        major: isMajor,
        hubCost,
        lines: m.lines.length ? m.lines : ['既存線'],
        directCost: isHub ? 100 : (isMajor ? 70 : 58),
        directFee: isHub ? 5.0 : (isMajor ? 3.5 : 2.8),
        directSlots: isMajor ? 8 : 6
      };
    });
  }

  async function loadOsmRailForCurrentView(replaceExisting = false, explicitBbox = null, cacheKey = null) {
    if (!map || !mapReady || osmLoading) return;
    const btn = document.getElementById('btn-load-osm-rail');
    let s, w, n, e;
    if (explicitBbox) {
      [s, w, n, e] = explicitBbox;
    } else {
      const c = map.getCenter();
      const b = map.getBounds();
      // 画面範囲に余白を加え、最低約70km四方〜最大約200km四方（関東全域クラス）まで一括読込
      const halfLat = Math.max(0.32, Math.min(0.85, (b.getNorth() - b.getSouth()) * 0.65));
      const halfLng = Math.max(0.40, Math.min(1.10, (b.getEast() - b.getWest()) * 0.65));
      s = c.lat - halfLat;
      n = c.lat + halfLat;
      w = c.lng - halfLng;
      e = c.lng + halfLng;
    }

    // セッションキャッシュがあれば即座に反映
    if (cacheKey) {
      try {
        const cached = sessionStorage.getItem('devrail_st_' + cacheKey);
        if (cached) {
          const parsedStations = JSON.parse(cached);
          if (Array.isArray(parsedStations) && parsedStations.length > 0) {
            EXISTING_STATIONS = parsedStations;
            customExistingLinesGeoJSON = { type: 'FeatureCollection', features: [] };
            if (map.getSource('existing-lines')) map.getSource('existing-lines').setData(customExistingLinesGeoJSON);
            if (map.getSource('existing-stations')) map.getSource('existing-stations').setData(buildExistingStationsGeoJSON());
            showToast(`キャッシュから読込完了（全${EXISTING_STATIONS.length}駅・線路は全国ベクトル表示）`);
            recalculateSimulation(false);
            updateHUD();
            renderPanel();
            return;
          }
        }
      } catch (_) {}
    }

    // 駅ノードのみ取得（wayジオメトリ不要のため関東全域2,000駅でも1〜2秒で完了）
    const query = `[out:json][timeout:25];node["railway"="station"](${s.toFixed(3)},${w.toFixed(3)},${n.toFixed(3)},${e.toFixed(3)});out;`;
    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
    ];

    osmLoading = true;
    if (btn) { btn.textContent = '広域読込中...'; btn.disabled = true; }
    try {
      let json = null;
      for (const url of endpoints) {
        try {
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(query)
          });
          if (resp.ok) {
            json = await resp.json();
            break;
          }
        } catch (_) {}
      }
      if (!json || !json.elements) {
        showToast('駅データの取得に失敗しました（少し待って再試行してください）');
        return;
      }
      const parsedStations = parseOverpassStationsOnly(json);
      if (parsedStations.length === 0) {
        showToast('この範囲に既存駅が見つかりませんでした');
        return;
      }

      if (replaceExisting || !customExistingLinesGeoJSON) {
        EXISTING_STATIONS = parsedStations;
      } else {
        const nameIndex = new Map();
        EXISTING_STATIONS.forEach(ex => {
          let arr = nameIndex.get(ex.name);
          if (!arr) { arr = []; nameIndex.set(ex.name, arr); }
          arr.push(ex);
        });
        for (const st of parsedStations) {
          const arr = nameIndex.get(st.name);
          const dup = arr && arr.some(ex => Math.abs(ex.lat - st.lat) < 0.004 && Math.abs(ex.lng - st.lng) < 0.005);
          if (!dup) {
            EXISTING_STATIONS.push(st);
            if (arr) arr.push(st);
            else nameIndex.set(st.name, [st]);
          }
        }
      }

      // 路線描画は全国対応のGPUベクトルタイル（nationwide-rail-vector）へ一本化し、重複GeoJSONを空にして超軽量化
      customExistingLinesGeoJSON = { type: 'FeatureCollection', features: [] };
      if (map.getSource('existing-lines')) {
        map.getSource('existing-lines').setData(customExistingLinesGeoJSON);
      }
      if (map.getSource('existing-stations')) {
        map.getSource('existing-stations').setData(buildExistingStationsGeoJSON());
      }
      if (cacheKey) {
        try { sessionStorage.setItem('devrail_st_' + cacheKey, JSON.stringify(EXISTING_STATIONS)); } catch (_) {}
      }
      playSfx('build');
      showToast(`広域の既存駅を読み込みました（累計 ${EXISTING_STATIONS.length}駅・全路線表示中）`);
      recalculateSimulation(false);
      updateHUD();
      renderPanel();
    } finally {
      osmLoading = false;
      if (btn) { btn.textContent = '広域の駅を読込'; btn.disabled = false; }
    }
  }

  function buildExistingStationsGeoJSON() {
    return {
      type: 'FeatureCollection',
      features: EXISTING_STATIONS.map(ex => ({
        type: 'Feature',
        properties: { id: ex.id, name: ex.name, hub: !!ex.hub, major: !!ex.major },
        geometry: { type: 'Point', coordinates: [ex.lng, ex.lat] }
      }))
    };
  }

  function syncMapGeoJSON(opts = {}) {
    if (!mapReady || !map) return;
    const updateTracks = opts.tracks !== false;

    // 駅勢圏サークル
    const zoneFeatures = state.myStations.map(st => {
      const zColor = st.congestion > 130 ? '#ef4444' : (ZONINGS[st.zoning] ? ZONINGS[st.zoning].color : '#0ea5e9');
      return {
        type: 'Feature',
        properties: { id: st.id, color: zColor },
        geometry: { type: 'Point', coordinates: [st.lng, st.lat] }
      };
    });
    if (map.getSource('station-zones')) {
      map.getSource('station-zones').setData({ type: 'FeatureCollection', features: zoneFeatures });
    }

    // 自社路線（月次更新時は線路・ノードの再送信を省略して軽量化）
    if (updateTracks) {
      const trackFeatures = [];
      const maxSpeed = Math.max(...state.services.filter(s => s.enabled).map(s => s.speed), 42);
      const hasPassing = hasIntermediatePassingTrack();

      for (let i = 0; i < state.segments.length; i++) {
        const sg = state.segments[i];
        let segColor = sg.structure === 'underground' ? '#38bdf8' : (sg.structure === 'elevated' ? '#0ea5e9' : '#06b6d4');
        if (state.showSpeedHeat) {
          const baseEff = maxSpeed > 45 && !hasPassing ? 42 + (maxSpeed - 42) * 0.35 : maxSpeed;
          const effSpeed = Math.min(baseEff, sg.maxSpeedKmh);
          if (effSpeed < 45) segColor = '#ef4444';
          else if (effSpeed >= 70) segColor = '#22c55e';
          else if (effSpeed >= 55) segColor = '#84cc16';
          else segColor = '#f59e0b';
        }
        trackFeatures.push({
          type: 'Feature',
          properties: { color: segColor, structure: sg.structure },
          geometry: { type: 'LineString', coordinates: sg.coords }
        });
      }
      if (map.getSource('my-track')) {
        map.getSource('my-track').setData({ type: 'FeatureCollection', features: trackFeatures });
      }
      if (map.getSource('my-track-nodes')) {
        const activeIdx = state.activeEnd === 'start' ? 0 : state.trackNodes.length - 1;
        map.getSource('my-track-nodes').setData({
          type: 'FeatureCollection',
          features: state.trackNodes.map((nd, idx) => ({
            type: 'Feature',
            properties: { id: nd.id, active: state.buildMode === 'track' && idx === activeIdx },
            geometry: { type: 'Point', coordinates: [nd.lng, nd.lat] }
          }))
        });
      }
    }

    // 区画整理・新設道路・駅前ロータリー・沿道開発3D建物群の同期
    if (opts.dev !== false) {
      const redevFeatures = [];
      state.redevZones.forEach(z => {
        if (z.polygon) {
          redevFeatures.push({
            type: 'Feature',
            properties: { id: z.id, type: z.type },
            geometry: { type: 'Polygon', coordinates: z.polygon }
          });
        }
      });
      state.customRoads.forEach(rd => {
        if (rd.clearPolygon) {
          redevFeatures.push({
            type: 'Feature',
            properties: { id: rd.id + '_clr', type: 'road_clear' },
            geometry: { type: 'Polygon', coordinates: rd.clearPolygon }
          });
        }
      });
      state.rotaries.forEach(rot => {
        if (rot.clearPolygon) {
          redevFeatures.push({
            type: 'Feature',
            properties: { id: rot.id + '_clr', type: 'rotary_clear' },
            geometry: { type: 'Polygon', coordinates: rot.clearPolygon }
          });
        }
      });
      if (map.getSource('redev-zones')) {
        map.getSource('redev-zones').setData({ type: 'FeatureCollection', features: redevFeatures });
      }

      const roadFeatures = state.customRoads
        .filter(rd => rd.widthM > 0 && rd.coords && rd.coords.length >= 2)
        .map(rd => ({
          type: 'Feature',
          properties: { id: rd.id, roadType: rd.roadType },
          geometry: { type: 'LineString', coordinates: rd.coords }
        }));
      if (map.getSource('custom-roads')) {
        map.getSource('custom-roads').setData({ type: 'FeatureCollection', features: roadFeatures });
      }

      const rotaryFeatures = [];
      state.rotaries.forEach(rot => {
        const r = rot.radiusM || 20;
        rotaryFeatures.push({
          type: 'Feature',
          properties: { id: rot.id, part: 'plaza' },
          geometry: { type: 'Polygon', coordinates: makeCirclePolygon(rot.lng, rot.lat, r + 4, 28) }
        });
        rotaryFeatures.push({
          type: 'Feature',
          properties: { id: rot.id, part: 'road' },
          geometry: { type: 'Polygon', coordinates: makeCirclePolygon(rot.lng, rot.lat, r, 28) }
        });
        const laneRing = makeCirclePolygon(rot.lng, rot.lat, r * 0.70, 28)[0];
        rotaryFeatures.push({
          type: 'Feature',
          properties: { id: rot.id, part: 'lane' },
          geometry: { type: 'LineString', coordinates: laneRing }
        });
        rotaryFeatures.push({
          type: 'Feature',
          properties: { id: rot.id, part: 'island' },
          geometry: { type: 'Polygon', coordinates: makeCirclePolygon(rot.lng, rot.lat, r * 0.42, 24) }
        });
      });
      if (map.getSource('custom-rotaries')) {
        map.getSource('custom-rotaries').setData({ type: 'FeatureCollection', features: rotaryFeatures });
      }

      const lotFeatures = [];
      const bldgFeatures = [];
      state.developments.forEach(dev => {
        const lm = LANDMARKS.find(l => l.id === dev.landmarkId);
        if (!lm) return;
        const st = dev.stationId ? state.myStations.find(s => s.id === dev.stationId) : null;
        const built = buildDevelopmentFeatures(dev, lm, st ? st.devLevel : 0);
        lotFeatures.push(built.lotFeature);
        built.buildings.forEach(b => bldgFeatures.push(b));
      });
      // 旧互換（st.landmark）
      state.myStations.forEach(st => {
        if (st.landmark) {
          const lm = LANDMARKS.find(l => l.id === st.landmark);
          if (lm) {
            bldgFeatures.push({
              type: 'Feature',
              properties: { color: lm.color, height: Math.round(115 + st.devLevel * 0.9) },
              geometry: { type: 'Polygon', coordinates: makeBuildingPolygon(st.lng, st.lat, 55, 55, 0, 110) }
            });
          }
        }
      });
      if (map.getSource('dev-lots')) {
        map.getSource('dev-lots').setData({ type: 'FeatureCollection', features: lotFeatures });
      }
      if (map.getSource('dev-buildings')) {
        map.getSource('dev-buildings').setData({ type: 'FeatureCollection', features: bldgFeatures });
      }
    }
  }

  function syncStationMarkers() {
    if (!map) return;
    stationMarkers.forEach(m => m.remove());
    stationMarkers = [];

    state.myStations.forEach(st => {
      const el = document.createElement('div');
      const isSelected = state.selectedStationId === st.id;
      const isDirect = st.existingId && state.directAgreements[st.existingId];
      const lm = st.landmark ? LANDMARKS.find(l => l.id === st.landmark) : null;
      el.className = `station-pill-marker ${isSelected ? 'selected' : ''} ${isDirect ? 'direct' : ''}`;
      el.innerHTML = `<span>${st.name}${isDirect ? ' [直通]' : ''}${st.hasPassing ? ' [4線]' : ''}${lm ? ` [${lm.tag}]` : ''}</span>`;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        state.selectedStationId = st.id;
        state.selectedPoint = { lat: st.lat, lng: st.lng, muni: getNearestMunicipality(st.lat, st.lng) };
        playSfx('tap');
        updateHUD();
        renderPanel();
        syncStationMarkers();
      });

      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] })
        .setLngLat([st.lng, st.lat])
        .addTo(map);
      stationMarkers.push(marker);
    });
  }

  function updateTrainGeoJSON() {
    if (!mapReady || !map || !map.getSource('my-trains')) return;
    if (state.myStations.length < 2) {
      map.getSource('my-trains').setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const poly = state.routePolyline;
    if (!poly || poly.length < 2) return;
    const maxSeg = Math.max(1, state.myStations.length - 1);
    const startKm = state.myStations[0].routeKm || 0;
    const endKm = state.myStations[state.myStations.length - 1].routeKm || (poly[poly.length - 1].cumKm || 1);
    const spanKm = Math.max(0.1, endKm - startKm);
    const features = state.trains.map(tr => {
      const targetKm = startKm + (Math.max(0, Math.min(maxSeg, tr.progress)) / maxSeg) * spanKm;
      let lo = 0, hi = poly.length - 1;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (poly[mid].cumKm <= targetKm) lo = mid;
        else hi = mid;
      }
      const pA = poly[lo], pB = poly[hi];
      const span = Math.max(1e-6, pB.cumKm - pA.cumKm);
      const frac = Math.max(0, Math.min(1, (targetKm - pA.cumKm) / span));
      const lng = pA.lng + (pB.lng - pA.lng) * frac;
      const lat = pA.lat + (pB.lat - pA.lat) * frac;
      return {
        type: 'Feature',
        properties: { color: tr.color },
        geometry: { type: 'Point', coordinates: [lng, lat] }
      };
    });
    map.getSource('my-trains').setData({ type: 'FeatureCollection', features });
  }

  // =========================================================================
  // 7. UI レンダリング（HUD & 下部4タブパネル）
  // =========================================================================
  function showToast(msg) {
    const box = document.getElementById('toast-box');
    const el = document.createElement('div');
    el.className = 'toast-item';
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2400);
  }

  function updateHUD() {
    document.getElementById('hud-date').textContent = `${state.year}年${state.month}月`;
    const fundsEl = document.getElementById('hud-funds');
    fundsEl.textContent = `${state.funds.toFixed(1)}億円`;
    fundsEl.className = `text-sm md:text-lg font-extrabold tabular-nums ${state.funds >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    const pop = getCorridorPop();
    const growthDiff = state.myStations.reduce((acc, st) => acc + (st.areaPop - st.initialPop), 0);
    if (state.myStations.length === 0) {
      document.getElementById('hud-pop').textContent = '沿線 0.0万人（未開業）';
    } else {
      const diffStr = growthDiff >= 0 ? `+${(growthDiff / 10000).toFixed(2)}` : `${(growthDiff / 10000).toFixed(2)}`;
      document.getElementById('hud-pop').textContent = `沿線 ${(pop / 10000).toFixed(1)}万人 (${diffStr})`;
    }

    const banner = document.getElementById('mode-banner');
    const bannerText = document.getElementById('mode-banner-text');
    const structBar = document.getElementById('struct-bar');
    const devModeBar = document.getElementById('dev-mode-bar');
    const undoBtn = document.getElementById('btn-undo-node');
    const switchEndBtn = document.getElementById('btn-switch-end');
    const mapWrap = document.getElementById('map-wrapper');
    if (devModeBar) {
      devModeBar.classList.add('hidden');
      devModeBar.innerHTML = '';
    }
    if (state.buildMode === 'track') {
      banner.classList.remove('hidden');
      if (structBar) structBar.classList.remove('hidden');
      if (switchEndBtn) {
        switchEndBtn.classList.toggle('hidden', state.trackNodes.length < 2);
        switchEndBtn.textContent = state.activeEnd === 'start' ? '延伸端: 始点側' : '延伸端: 終点側';
      }
      if (undoBtn) undoBtn.classList.toggle('hidden', state.undoStack.length === 0);
      if (mapWrap) mapWrap.classList.add('extend-cursor');
      if (state.trackNodes.length === 0) {
        bannerText.textContent = '始点をクリックして線路敷設を開始';
      } else {
        bannerText.textContent = '次の地点をクリックして曲線／直線を延伸（反対端クリックで延伸端切替）';
      }
    } else if (state.buildMode === 'station') {
      banner.classList.remove('hidden');
      if (structBar) structBar.classList.add('hidden');
      if (switchEndBtn) switchEndBtn.classList.add('hidden');
      if (undoBtn) undoBtn.classList.toggle('hidden', state.undoStack.length === 0);
      if (mapWrap) mapWrap.classList.add('extend-cursor');
      bannerText.textContent = '線路上の好きな場所をクリックして駅を設置';
    } else if (state.buildMode === 'road') {
      banner.classList.remove('hidden');
      if (structBar) structBar.classList.add('hidden');
      if (switchEndBtn) switchEndBtn.classList.add('hidden');
      if (undoBtn) undoBtn.classList.toggle('hidden', state.undoStack.length === 0);
      if (mapWrap) mapWrap.classList.add('extend-cursor');
      bannerText.textContent = state.activeRoadNodes.length === 0
        ? '道路の始点をクリック（既存道路を自動で付け替え・整地）'
        : '次の地点をクリックして道路を延伸（Nキーで別の起点から開始）';
      if (devModeBar) {
        devModeBar.classList.remove('hidden');
        devModeBar.innerHTML = `
          <span class="text-[10px] md:text-xs text-slate-400">種別:</span>
          ${Object.values(ROAD_TYPES).map(rt => `
            <button data-dev-act="set-road-type" data-val="${rt.id}" class="px-2 py-0.5 rounded-md text-[10px] md:text-xs font-bold border cursor-pointer ${state.roadType === rt.id ? 'bg-sky-500 text-slate-950 border-sky-300' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'}">${rt.name}</button>
          `).join('')}
          ${state.activeRoadNodes.length > 0 ? `<button data-dev-act="new-road-chain" class="px-2 py-0.5 rounded-md text-[10px] md:text-xs font-bold border border-emerald-400/60 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 cursor-pointer">新しい起点 (N)</button>` : ''}
        `;
      }
    } else if (state.buildMode === 'rotary') {
      banner.classList.remove('hidden');
      if (structBar) structBar.classList.add('hidden');
      if (switchEndBtn) switchEndBtn.classList.add('hidden');
      if (undoBtn) undoBtn.classList.toggle('hidden', state.undoStack.length === 0);
      if (mapWrap) mapWrap.classList.add('extend-cursor');
      bannerText.textContent = '駅前など任意の地点をクリックして駅前ロータリーを整備（既存道路も自動接続）';
    } else if (state.buildMode === 'redev') {
      banner.classList.remove('hidden');
      if (structBar) structBar.classList.add('hidden');
      if (switchEndBtn) switchEndBtn.classList.add('hidden');
      if (undoBtn) undoBtn.classList.toggle('hidden', state.undoStack.length === 0);
      if (mapWrap) mapWrap.classList.add('extend-cursor');
      bannerText.textContent = state.redevTool === 'grid_block'
        ? 'クリックで既存道路を更地化し整形グリッド街路を一括整備（Rキーで回転）'
        : 'クリックで既存道路・密集地を更地化（自由に道路を引き直せます）';
      if (devModeBar) {
        devModeBar.classList.remove('hidden');
        devModeBar.innerHTML = `
          <button data-dev-act="set-redev-tool" data-val="grid_block" class="px-2 py-0.5 rounded-md text-[10px] md:text-xs font-bold border cursor-pointer ${state.redevTool === 'grid_block' ? 'bg-sky-500 text-slate-950 border-sky-300' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'}">グリッド街区(28億)</button>
          <button data-dev-act="set-redev-tool" data-val="clear_lot" class="px-2 py-0.5 rounded-md text-[10px] md:text-xs font-bold border cursor-pointer ${state.redevTool === 'clear_lot' ? 'bg-sky-500 text-slate-950 border-sky-300' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'}">更地化のみ(12億)</button>
          ${state.redevTool === 'grid_block' ? `<button data-dev-act="rotate-dev" class="px-2 py-0.5 rounded-md text-[10px] md:text-xs font-bold border border-slate-500 bg-slate-800 hover:bg-slate-700 text-sky-300 cursor-pointer">回転 ${state.devAngleDeg}° (R)</button>` : ''}
        `;
      }
    } else if (state.buildMode === 'landmark') {
      banner.classList.remove('hidden');
      if (structBar) structBar.classList.add('hidden');
      if (switchEndBtn) switchEndBtn.classList.add('hidden');
      if (undoBtn) undoBtn.classList.toggle('hidden', state.undoStack.length === 0);
      if (mapWrap) mapWrap.classList.add('extend-cursor');
      const lm = LANDMARKS.find(l => l.id === state.selectedLandmarkId) || LANDMARKS[0];
      bannerText.textContent = `「${lm.name}」を実在道路・新設道路・ロータリー沿いにクリック配置`;
      if (devModeBar) {
        devModeBar.classList.remove('hidden');
        devModeBar.innerHTML = `
          <button data-dev-act="toggle-road-snap" class="px-2 py-0.5 rounded-md text-[10px] md:text-xs font-bold border cursor-pointer ${state.devRoadSnap ? 'bg-emerald-500 text-slate-950 border-emerald-300' : 'bg-slate-800 text-slate-300 border-slate-600'}">道路沿い自動整列: ${state.devRoadSnap ? 'ON' : 'OFF'}</button>
          <button data-dev-act="rotate-dev" class="px-2 py-0.5 rounded-md text-[10px] md:text-xs font-bold border border-slate-500 bg-slate-800 hover:bg-slate-700 text-sky-300 cursor-pointer">手動回転 ${state.devAngleDeg}° (R)</button>
        `;
      }
    } else {
      banner.classList.add('hidden');
      if (mapWrap) mapWrap.classList.remove('extend-cursor');
      clearPreviewTrack();
    }
    document.querySelectorAll('.struct-pill').forEach(btn => {
      const active = btn.dataset.struct === state.buildStructure;
      btn.className = `struct-pill px-2 py-0.5 rounded-md text-[10px] md:text-xs font-bold border cursor-pointer ${active ? 'bg-sky-500 text-slate-950 border-sky-300' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600'}`;
    });

    updateMapChip();
    renderTutorial();
  }

  function updateMapChip() {
    const titleEl = document.getElementById('chip-title');
    const subEl = document.getElementById('chip-sub');
    if (state.myStations.length === 0) {
      if (state.selectedPoint) {
        const m = state.selectedPoint.muni;
        titleEl.textContent = '新規路線を敷設しよう';
        subEl.textContent = `マップをタップして1駅目を建設（例: 二子玉川・調布・登戸付近）`;
      }
      return;
    }
    const st = state.myStations.find(s => s.id === state.selectedStationId);
    if (st && state.selectedPoint && haversineKm(st.lat, st.lng, state.selectedPoint.lat, state.selectedPoint.lng) < 0.3) {
      const directTag = st.existingId && state.directAgreements[st.existingId] ? ' [直通中]' : '';
      titleEl.textContent = `${st.name}駅${directTag} (${st.muniName})`;
      subEl.textContent = state.myStations.length < 2
        ? '2駅目を建設すると運行が開始されます'
        : `都心体感 ${st.hubTime}分 / 乗降 ${(st.ridership / 1000).toFixed(1)}千人/日 / 混雑 ${st.congestion}%`;
      return;
    }
    if (state.selectedPoint) {
      const m = state.selectedPoint.muni;
      const lp = getNearestLocalPlace(state.selectedPoint.lat, state.selectedPoint.lng, 2.0);
      const nearEx = getNearestExistingStation(state.selectedPoint.lat, state.selectedPoint.lng, 0.65);
      const placeStr = lp ? `・${lp.name}` : '';
      const exStr = nearEx ? ` (${nearEx.name}駅 ${Math.round(haversineKm(state.selectedPoint.lat, state.selectedPoint.lng, nearEx.lat, nearEx.lng) * 1000)}m)` : '';
      titleEl.textContent = `${m.name}${placeStr}${exStr}`;
      subEl.textContent = `自治体人口 ${m.pop.toLocaleString()}人 / 密度 ${Math.round(m.pop / m.area).toLocaleString()}人/km²`;
    }
  }

  // --- インタラクティブ・チュートリアル ---
  function getCurrentTutorialStep() {
    const nodes = state.trackNodes.length;
    const n = state.myStations.length;
    const hasDirect = Object.keys(state.directAgreements).length > 0;
    const hasFastService = state.services.some(sv => sv.id !== 'local' && sv.enabled);
    const hasPassing = n >= 3 && hasIntermediatePassingTrack();
    const hasLandmark = state.myStations.some(st => !!st.landmark) || state.developments.length > 0;

    if (nodes < 2) {
      return {
        step: 1, total: 6,
        title: 'まずは線路（線形）を引こう',
        desc: 'マップ上で始点と経由点を次々クリックして自由な線形を引けます。地上／高架／地下を切り替えながら、道路や河川に合わせて敷設してみよう！',
        ctaLabel: state.buildMode === 'track' ? null : '線路を引く',
        ctaAction: 'tut-start-track'
      };
    }
    if (n < 2) {
      return {
        step: 2, total: 6,
        title: '線路上に駅を2つ以上設置しよう',
        desc: '「駅を設置」モードに切り替えて、引いた線路の上をクリック！2駅以上置くと列車が走り始めます（既存駅付近は自動接続）。',
        ctaLabel: state.buildMode === 'station' ? null : '駅を設置する',
        ctaAction: 'tut-start-station'
      };
    }
    if (n === 2) {
      return {
        step: 3, total: 6,
        title: '3駅目を設置して沿線を広げよう',
        desc: 'さらに線路を伸ばすか、途中に3駅目を設置してみよう。中間駅ができると待避線や急行の追い越しが活きてきます！',
        ctaLabel: state.buildMode === 'station' ? null : '3駅目を設置',
        ctaAction: 'tut-start-station'
      };
    }
    if (!hasDirect && !state.tutorialSkippedDirect) {
      const hasConn = state.myStations.some(s => s.existingId);
      return {
        step: 4, total: 6,
        title: '既存路線と直通運転協定を結ぼう',
        desc: hasConn
          ? '「路線・駅」タブの「協定締結」ボタンを押すと、都心への乗換ペナルティ（10分）が0分になり乗客が急増します！'
          : '既存駅（白丸）の近くに延伸すると直通運転協定を結べます。今はスキップして次へ進むこともできます。',
        ctaLabel: hasConn ? '路線・駅タブを開く' : 'このステップをスキップ',
        ctaAction: hasConn ? 'tut-go-route' : 'tut-skip-direct'
      };
    }
    if (!hasFastService || !hasPassing) {
      return {
        step: 5, total: 6,
        title: '待避線＆急行でスピードアップ',
        desc: !hasPassing
          ? '中間駅を選んで「待避線拡張 (35億)」を行うと、急行・特急が各停を追い抜いて100%の速度を発揮できます。'
          : '「種別・直通」タブで準急・急行・特急をONにして、通過駅（｜）を設定してみよう！',
        ctaLabel: !hasPassing ? '路線・駅タブを開く' : '種別・直通タブを開く',
        ctaAction: !hasPassing ? 'tut-go-route' : 'tut-go-service'
      };
    }
    if (!hasLandmark) {
      return {
        step: 6, total: 6,
        title: '沿線開発＆大型ランドマーク建設',
        desc: '「沿線開発」タブで駅ごとの開発方針を選び、商業ビルやタワマンなどの大型ランドマークを1つ建てて街を育てよう！',
        ctaLabel: state.activeTab === 'dev' ? null : '沿線開発タブを開く',
        ctaAction: 'tut-go-dev'
      };
    }
    return {
      step: 7, total: 6, done: true,
      title: 'チュートリアル完了',
      desc: '基本操作をマスターしました！自由に路線を延伸し、黒字経営と沿線人口の拡大を目指そう。'
    };
  }

  function renderTutorial() {
    const box = document.getElementById('tutorial-box');
    if (!box) return;
    if (!state.tutorialVisible) {
      box.innerHTML = '';
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    const t = getCurrentTutorialStep();
    const pct = t.done ? 100 : Math.round(((t.step - 1) / t.total) * 100);
    box.innerHTML = `
      <div class="bg-sky-950/75 border border-sky-500/40 rounded-xl p-2.5 md:p-3.5 shadow-sm">
        <div class="flex items-center justify-between gap-2 mb-1">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="text-[10px] md:text-xs font-extrabold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-400/30 shrink-0">
              ${t.done ? 'COMPLETE' : `STEP ${t.step}/${t.total}`}
            </span>
            <span class="text-xs md:text-sm font-extrabold text-white truncate">${t.title}</span>
          </div>
          <button data-tut-action="tut-close" class="text-slate-400 hover:text-white text-xs md:text-sm px-1 shrink-0 cursor-pointer" title="ガイドを閉じる">✕</button>
        </div>
        <div class="w-full h-1 bg-slate-800 rounded-full overflow-hidden mb-1.5">
          <div class="h-full bg-sky-400 transition-all duration-300" style="width:${pct}%"></div>
        </div>
        <p class="text-[11px] md:text-xs text-slate-200 leading-relaxed">${t.desc}</p>
        ${t.ctaLabel ? `
          <div class="mt-2 flex justify-end">
            <button data-tut-action="${t.ctaAction}" class="px-2.5 md:px-3 py-1 md:py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-extrabold text-[11px] md:text-xs cursor-pointer">
              ${t.ctaLabel}
            </button>
          </div>` : ''}
      </div>
    `;
  }

  function renderPanel() {
    const container = document.getElementById('panel-content');
    if (state.activeTab === 'route') renderRouteTab(container);
    else if (state.activeTab === 'service') renderServiceTab(container);
    else if (state.activeTab === 'dev') renderDevTab(container);
    else if (state.activeTab === 'finance') renderFinanceTab(container);
  }

  // --- タブ1: 路線・駅 ---
  function renderRouteTab(container) {
    const n = state.myStations.length;
    const st = state.myStations.find(s => s.id === state.selectedStationId) || state.myStations[0];
    const passingOk = hasIntermediatePassingTrack();
    const canDirectStations = state.myStations.filter(s => s.existingId && getTransferInfo(s.transferDistM).canDirect);

    if (n === 0) {
      const km = getLineLengthKm();
      container.innerHTML = `
        <div class="mb-3">
          <div class="text-xs md:text-base font-extrabold text-white">新線建設プロジェクト（線路 ${km.toFixed(1)}km）</div>
          <div class="text-[10px] md:text-xs text-slate-400 mt-0.5">① 線路を引く → ② 線路上に駅を設置する</div>
        </div>
        <div class="grid grid-cols-2 gap-2 mb-3">
          <button data-action="mode-track" class="py-2 px-3 rounded-xl text-xs md:text-sm font-bold cursor-pointer border ${state.buildMode === 'track' ? 'bg-sky-600 border-sky-300 text-white shadow' : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200'}">
            線路を引く
          </button>
          <button data-action="mode-station" class="py-2 px-3 rounded-xl text-xs md:text-sm font-bold cursor-pointer border ${state.buildMode === 'station' ? 'bg-emerald-600 border-emerald-300 text-white shadow' : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200'} ${state.trackNodes.length < 2 ? 'opacity-50' : ''}">
            駅を設置
          </button>
        </div>
        <div class="mb-3">
          <div class="text-[10px] md:text-xs font-bold text-slate-400 mb-1.5">敷設構造（道路・河川との兼ね合い）</div>
          <div class="grid grid-cols-3 gap-1.5">
            ${Object.values(STRUCTURES).map(stf => {
              const active = state.buildStructure === stf.id;
              return `
                <button data-action="set-structure" data-struct="${stf.id}" class="py-1.5 px-2 rounded-lg text-[10px] md:text-xs font-bold border cursor-pointer ${active ? 'bg-sky-600/25 border-sky-400 text-white' : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'}">
                  ${stf.name}
                </button>`;
            }).join('')}
          </div>
          <div class="text-[10px] md:text-xs text-slate-400 mt-1">${STRUCTURES[state.buildStructure].desc}</div>
        </div>
        <div class="bg-slate-800/80 border border-slate-700 rounded-xl p-3 text-xs md:text-sm text-slate-300 space-y-1.5 leading-relaxed">
          <p>${state.trackNodes.length < 2 ? 'マップ上で始点と経由点をクリックして自由な線形を引いてください。' : '線路が敷設されました！「駅を設置」を押して線路上に駅を2つ以上置くと開通します。'}</p>
          <p class="text-[11px] md:text-xs text-amber-300">既存駅（白丸）の近くを通るように線路を引き、駅を置くと直通運転協定を結べます。</p>
        </div>
      `;
      return;
    }

    let directHtml = '';
    if (canDirectStations.length > 0) {
      directHtml = `<div class="mt-3">
        <div class="text-[11px] md:text-xs font-bold text-amber-300 mb-1.5">既存路線との直通運転協定</div>
        <div class="space-y-2">
          ${canDirectStations.map(cs => {
            const ex = EXISTING_STATIONS.find(e => e.id === cs.existingId);
            const active = !!state.directAgreements[ex.id];
            return `
              <div class="flex items-center justify-between bg-slate-800/80 border ${active ? 'border-amber-400/70' : 'border-slate-700'} rounded-lg px-2.5 md:px-3 py-2">
                <div class="min-w-0 pr-2">
                  <div class="text-xs md:text-sm font-bold text-white">${cs.name} ⇔ ${ex.lines[0]}</div>
                  <div class="text-[10px] md:text-xs text-slate-400">${active ? `直通中 (線路使用料 ${ex.directFee}億/月・乗換0分)` : `協定費 ${ex.directCost}億 / 距離${cs.transferDistM ?? '-'}mの乗換ペナルティを0分へ`}</div>
                </div>
                ${active
                  ? `<span class="text-[10px] md:text-xs font-bold px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-400/40 shrink-0">締結済</span>`
                  : `<button data-action="sign-direct" data-exid="${ex.id}" class="text-[11px] md:text-xs font-bold px-2.5 md:px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 shrink-0 cursor-pointer">協定締結</button>`
                }
              </div>`;
          }).join('')}
        </div>
      </div>`;
    }

    container.innerHTML = `
      <div class="mb-2.5">
        <div class="flex items-center justify-between gap-2 mb-2">
          <div>
            <div class="text-xs md:text-base font-extrabold text-white">自社新線（全${n}駅・${getLineLengthKm().toFixed(1)}km）</div>
            <div class="text-[10px] md:text-xs text-slate-400 mt-0.5">${n < 2 ? 'あと1駅設置すると運行開始' : `待避線: ${passingOk ? '<span class="text-emerald-400">追い越し可能</span>' : '<span class="text-amber-300">中間駅に未設置（急行減速）</span>'}`}</div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-1.5">
          <button data-action="mode-track" class="py-1.5 md:py-2 px-2.5 rounded-lg text-xs md:text-sm font-bold cursor-pointer border ${state.buildMode === 'track' ? 'bg-sky-600 border-sky-300 text-white shadow' : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200'}">
            ${state.buildMode === 'track' ? '線路敷設中' : '線路を延伸'}
          </button>
          <button data-action="mode-station" class="py-1.5 md:py-2 px-2.5 rounded-lg text-xs md:text-sm font-bold cursor-pointer border ${state.buildMode === 'station' ? 'bg-emerald-600 border-emerald-300 text-white shadow' : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200'}">
            ${state.buildMode === 'station' ? '駅設置中' : '駅を設置'}
          </button>
        </div>
      </div>

      ${st ? `
      <div class="bg-slate-800/90 border border-slate-700 rounded-xl p-2.5 md:p-3.5">
        <div class="flex items-center justify-between gap-2">
          <div>
            <div class="text-xs md:text-sm font-bold text-sky-300">選択駅: ${st.name}駅${st.existingId ? (() => { const ex = EXISTING_STATIONS.find(e => e.id === st.existingId); const ti = getTransferInfo(st.transferDistM); return ex ? ` <span class="text-[10px] text-amber-300 font-normal">(${ex.name} ${st.transferDistM}m・${ti.label} ${ti.penaltyMin}分)</span>` : ''; })() : ''}</div>
            <div class="text-[10px] md:text-xs text-slate-300 mt-1">${n < 2 ? '開業準備中（2駅目を建設してください）' : `都心体感 <strong class="text-white">${st.hubTime}分</strong> ・乗降 ${(st.ridership / 1000).toFixed(1)}千人/日 ・混雑 ${st.congestion}%`}</div>
          </div>
          ${st.hasPassing
            ? `<span class="text-[10px] md:text-xs font-bold px-2.5 py-1 rounded bg-sky-500/20 text-sky-300 border border-sky-400/40 shrink-0">2面4線 済</span>`
            : `<button data-action="upgrade-passing" data-stid="${st.id}" class="text-[11px] md:text-xs font-bold px-2.5 md:px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white shrink-0 cursor-pointer">待避線拡張 (35億)</button>`
          }
        </div>
      </div>` : ''}

      ${directHtml}

      <div class="mt-3">
        <div class="text-[10px] md:text-xs font-bold text-slate-400 mb-1.5">延伸時の線路構造（道路・河川との兼ね合い）</div>
        <div class="grid grid-cols-3 gap-1.5">
          ${Object.values(STRUCTURES).map(stf => {
            const active = state.buildStructure === stf.id;
            return `
              <button data-action="set-structure" data-struct="${stf.id}" class="py-1.5 px-2 rounded-lg text-[10px] md:text-xs font-bold border cursor-pointer ${active ? 'bg-sky-600/25 border-sky-400 text-white' : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'}">
                ${stf.name}
              </button>`;
          }).join('')}
        </div>
        <div class="text-[10px] md:text-xs text-slate-400 mt-1">${STRUCTURES[state.buildStructure].desc}</div>
      </div>

      ${state.segments.length > 0 ? `
      <div class="mt-3">
        <div class="text-[10px] md:text-xs font-bold text-slate-400 mb-1.5">区間別 線形・インフラ状況</div>
        <div class="space-y-1">
          ${state.segments.map((sg, idx) => {
            const stf = STRUCTURES[sg.structure] || STRUCTURES.surface;
            return `
              <div class="flex items-center justify-between bg-slate-800/60 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[10px] md:text-xs">
                <span class="font-bold text-slate-200 truncate pr-2">[${stf.tag}] 区間${idx + 1} (${sg.lengthKm.toFixed(1)}km)</span>
                <div class="flex items-center gap-2 shrink-0 tabular-nums">
                  <span class="${sg.minRadiusM < 250 ? 'text-rose-400 font-bold' : (sg.minRadiusM < 450 ? 'text-amber-300' : 'text-emerald-400')}">R${sg.minRadiusM}m</span>
                  <span class="text-slate-300">上限${sg.maxSpeedKmh}km/h</span>
                  ${sg.levelCrossings > 0 ? `<span class="text-rose-400 font-bold">踏切×${sg.levelCrossings}</span>` : ''}
                  ${sg.hasRiver ? `<span class="text-sky-300">橋梁</span>` : ''}
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      <div class="mt-3">
        <div class="text-[10px] md:text-xs font-bold text-slate-400 mb-1.5">自社駅一覧（クリックでフォーカス）</div>
        <div class="flex flex-wrap gap-1.5 md:gap-2">
          ${state.myStations.map(s => `
            <button data-action="select-station" data-stid="${s.id}" class="px-2.5 md:px-3 py-1 md:py-1.5 rounded-full text-[11px] md:text-xs font-semibold border cursor-pointer ${s.id === state.selectedStationId ? 'bg-sky-600 text-white border-sky-400' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'}">
              ${s.name}${s.hasPassing ? ' [4線]' : ''}
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  // --- タブ2: 種別・直通 ---
  function renderServiceTab(container) {
    if (state.myStations.length < 2) {
      container.innerHTML = `
        <div class="bg-slate-800/80 border border-slate-700 rounded-xl p-4 text-xs md:text-sm text-slate-300 leading-relaxed">
          2駅以上を線路で繋ぐと、種別（各停・準急・急行・特急）の運行本数や停車駅、直通運転を設定できるようになります。
        </div>`;
      return;
    }

    const hasPassing = hasIntermediatePassingTrack();
    const hasDirect = getConnectedDirectStations().length > 0;

    container.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <div class="text-xs md:text-sm font-extrabold text-white">種別・停車駅エディタ（1時間あたり）</div>
        <span class="text-[10px] md:text-xs font-bold ${hasPassing ? 'text-emerald-400' : 'text-amber-300'}">${hasPassing ? '待避線OK' : '待避線なし'}</span>
      </div>

      <div class="grid grid-cols-4 gap-1.5 md:gap-2 mb-3">
        ${state.services.map(sv => `
          <div class="bg-slate-800/90 border ${sv.enabled ? 'border-slate-500' : 'border-slate-800 opacity-60'} rounded-lg p-1.5 md:p-2 flex flex-col items-center gap-1.5">
            <button data-action="toggle-service" data-svid="${sv.id}" class="w-full py-1 rounded text-[11px] md:text-xs font-extrabold cursor-pointer" style="background:${sv.enabled ? sv.color : '#334155'};color:${sv.enabled ? '#0f172a' : '#94a3b8'}">
              ${sv.name} ${sv.enabled ? 'ON' : 'OFF'}
            </button>
            <div class="flex items-center gap-1 text-[10px] md:text-xs text-slate-200">
              <button data-action="freq-down" data-svid="${sv.id}" class="w-5 h-5 md:w-6 md:h-6 rounded bg-slate-700 hover:bg-slate-600 font-bold cursor-pointer">-</button>
              <span class="w-7 md:w-9 text-center font-bold tabular-nums">${sv.freq}本</span>
              <button data-action="freq-up" data-svid="${sv.id}" class="w-5 h-5 md:w-6 md:h-6 rounded bg-slate-700 hover:bg-slate-600 font-bold cursor-pointer">+</button>
            </div>
            <button data-action="toggle-sv-direct" data-svid="${sv.id}" class="w-full py-1 rounded text-[9px] md:text-[11px] font-bold border cursor-pointer ${sv.direct && hasDirect ? 'bg-amber-500/20 text-amber-300 border-amber-400/60' : 'bg-slate-900 text-slate-400 border-slate-700'}">
              ${sv.direct && hasDirect ? '直通ON' : '直通OFF'}
            </button>
          </div>
        `).join('')}
      </div>

      <div class="bg-slate-950/70 border border-slate-800 rounded-xl overflow-hidden">
        <table class="w-full text-[11px] md:text-xs border-collapse">
          <thead>
            <tr class="bg-slate-900 text-slate-400 border-b border-slate-800">
              <th class="text-left py-2 px-2.5 font-semibold">駅名</th>
              ${state.services.map(sv => `<th class="py-2 px-1 text-center font-bold" style="color:${sv.color}">${sv.name}</th>`).join('')}
              <th class="py-2 px-2.5 text-right font-semibold">都心</th>
            </tr>
          </thead>
          <tbody>
            ${state.myStations.map((st, idx) => `
              <tr class="border-b border-slate-800/70 last:border-0">
                <td class="py-1.5 md:py-2 px-2.5 font-bold text-slate-200 truncate max-w-[96px] md:max-w-[130px]">
                  ${st.name}${st.hasPassing ? '<span class="text-[9px] md:text-[11px] text-sky-400 ml-1">4線</span>' : ''}
                </td>
                ${state.services.map(sv => {
                  const stop = !!sv.stops[st.id];
                  const locked = sv.id === 'local' || idx === 0 || idx === state.myStations.length - 1;
                  return `
                    <td class="py-1.5 text-center">
                      <button data-action="toggle-stop" data-svid="${sv.id}" data-stid="${st.id}" class="w-6 h-6 md:w-7 md:h-7 rounded-full text-xs md:text-sm font-extrabold cursor-pointer ${stop ? 'text-slate-950' : 'bg-slate-800 text-slate-500'} ${locked ? 'opacity-80' : ''}" style="${stop ? `background:${sv.color}` : ''}">
                        ${stop ? '●' : '｜'}
                      </button>
                    </td>`;
                }).join('')}
                <td class="py-1.5 md:py-2 px-2.5 text-right font-bold tabular-nums ${st.hubTime <= 35 ? 'text-emerald-400' : (st.hubTime <= 50 ? 'text-amber-300' : 'text-rose-400')}">
                  ${st.hubTime}分
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // --- タブ3: 沿線開発・土地区画整理 ---
  function renderDevTab(container) {
    const st = state.myStations.find(s => s.id === state.selectedStationId) || state.myStations[0] || null;
    const isRoad = state.buildMode === 'road';
    const isRotary = state.buildMode === 'rotary';
    const isRedev = state.buildMode === 'redev';
    const isLm = state.buildMode === 'landmark';

    const stationSection = st ? `
      <div class="mb-3 pb-2.5 border-b border-slate-800">
        <div class="flex items-center justify-between gap-2 mb-2">
          <div class="text-xs md:text-sm font-extrabold text-white shrink-0">対象駅: <span class="text-sky-300">${st.name}駅</span></div>
          <div class="flex gap-1.5 overflow-x-auto max-w-[60%]">
            ${state.myStations.map(s => `
              <button data-action="select-station" data-stid="${s.id}" class="px-2 py-0.5 rounded text-[10px] md:text-xs font-bold shrink-0 cursor-pointer ${s.id === st.id ? 'bg-sky-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-400'}">${s.name}</button>
            `).join('')}
          </div>
        </div>
        <div class="grid grid-cols-4 gap-1.5">
          ${Object.values(ZONINGS).map(z => {
            const active = st.zoning === z.id;
            return `
              <button data-action="set-zoning" data-stid="${st.id}" data-zoning="${z.id}" class="py-1.5 px-1 rounded-lg text-[10px] md:text-xs font-bold border cursor-pointer ${active ? 'bg-slate-800 text-white' : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-800'}" style="${active ? `border-color:${z.color};box-shadow:inset 0 0 0 1px ${z.color}` : ''}">
                ${z.name}
              </button>`;
          }).join('')}
        </div>
      </div>
    ` : `
      <div class="mb-3 bg-slate-800/60 border border-slate-700/80 rounded-xl px-3 py-2 text-[11px] md:text-xs text-slate-300 leading-relaxed">
        駅建設前でも土地区画整理・道路再編・沿道開発を先行整備できます（駅を開業すると乗降客・収益に連動します）。
      </div>
    `;

    container.innerHTML = `
      ${stationSection}

      <div class="mb-3">
        <div class="flex items-center justify-between mb-1.5">
          <div class="text-[10px] md:text-xs font-bold text-slate-300">土地区画整理・道路再編（既存道路を作り変える）</div>
          <span class="text-[10px] text-slate-400 tabular-nums">ロータリー ${state.rotaries.length} / 道路 ${state.customRoads.filter(r => r.widthM > 0).length}</span>
        </div>
        <div class="grid grid-cols-3 gap-1.5 md:gap-2">
          <button data-action="mode-rotary" class="text-left p-2 rounded-xl border cursor-pointer transition ${isRotary ? 'bg-sky-600/30 border-sky-400 text-white' : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-200'}">
            <div class="text-[11px] md:text-xs font-extrabold">駅前ロータリー</div>
            <div class="text-[10px] text-amber-300 font-bold mt-0.5">${REDEV_TOOLS.rotary.cost}億円</div>
            <div class="text-[9.5px] text-slate-400 mt-0.5 leading-tight">交通広場＋道路接続</div>
          </button>
          <button data-action="mode-road" class="text-left p-2 rounded-xl border cursor-pointer transition ${isRoad ? 'bg-sky-600/30 border-sky-400 text-white' : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-200'}">
            <div class="text-[11px] md:text-xs font-extrabold">道路を引く・付替</div>
            <div class="text-[10px] text-amber-300 font-bold mt-0.5">大通り/街路/消去</div>
            <div class="text-[9.5px] text-slate-400 mt-0.5 leading-tight">既存道路を上書き再編</div>
          </button>
          <button data-action="mode-redev" class="text-left p-2 rounded-xl border cursor-pointer transition ${isRedev ? 'bg-sky-600/30 border-sky-400 text-white' : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-200'}">
            <div class="text-[11px] md:text-xs font-extrabold">区画整理スタンプ</div>
            <div class="text-[10px] text-amber-300 font-bold mt-0.5">28億 / 12億</div>
            <div class="text-[9.5px] text-slate-400 mt-0.5 leading-tight">グリッド街区・更地化</div>
          </button>
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between mb-1.5">
          <div class="text-[10px] md:text-xs font-bold text-slate-300">沿道施設建設（実在道路・新設道路・ロータリーに自動整列）</div>
          <span class="text-[10px] text-emerald-400 font-bold tabular-nums">配置済 ${state.developments.length}件</span>
        </div>
        <div class="grid grid-cols-2 gap-1.5 md:gap-2">
          ${LANDMARKS.map(lm => {
            const active = isLm && state.selectedLandmarkId === lm.id;
            const builtCount = state.developments.filter(d => d.landmarkId === lm.id).length;
            return `
              <button data-action="select-landmark-build" data-lmid="${lm.id}" class="text-left p-2 md:p-2.5 rounded-xl border cursor-pointer transition ${active ? 'bg-sky-600/30 border-sky-400 shadow-inner' : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700'}">
                <div class="flex items-center justify-between gap-1">
                  <span class="text-[11px] md:text-xs font-bold text-white truncate">${lm.name}</span>
                  <span class="text-[10px] md:text-xs font-extrabold text-amber-300 shrink-0">${lm.cost}億</span>
                </div>
                <div class="text-[9.5px] md:text-[11px] text-slate-300 mt-1 leading-snug">${lm.desc}</div>
                <div class="flex items-center justify-between mt-1 text-[9px] text-slate-400">
                  <span>規模 ${lm.w}×${lm.d}m</span>
                  ${builtCount > 0 ? `<span class="text-emerald-400 font-bold">×${builtCount}</span>` : ''}
                </div>
              </button>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  // --- タブ4: 経営・統計 ---
  function renderFinanceTab(container) {
    if (state.myStations.length < 2) {
      container.innerHTML = `
        <div class="bg-slate-800/80 border border-slate-700 rounded-xl p-4 text-xs md:text-sm text-slate-300 leading-relaxed">
          2駅以上を開通させると、月次収支（運賃・特急・不動産）と沿線人口推移チャートが集計されます。
        </div>`;
      return;
    }

    const f = state.finance;
    const totalRev = f.fareRev + f.expressRev + f.estateRev;
    const totalExp = f.trackCost + f.opCost + f.directCost + f.landmarkCost;

    container.innerHTML = `
      <div class="grid grid-cols-3 gap-1.5 md:gap-2.5 mb-2.5">
        <div class="bg-slate-800/90 border border-slate-700 rounded-lg p-2 md:p-3">
          <div class="text-[10px] md:text-xs text-slate-400">月間収入</div>
          <div class="text-xs md:text-base font-extrabold text-sky-300 tabular-nums mt-0.5">+${totalRev.toFixed(1)}億</div>
        </div>
        <div class="bg-slate-800/90 border border-slate-700 rounded-lg p-2 md:p-3">
          <div class="text-[10px] md:text-xs text-slate-400">月間支出</div>
          <div class="text-xs md:text-base font-extrabold text-rose-300 tabular-nums mt-0.5">-${totalExp.toFixed(1)}億</div>
        </div>
        <div class="bg-slate-800/90 border border-slate-700 rounded-lg p-2 md:p-3">
          <div class="text-[10px] md:text-xs text-slate-400">月間純利益</div>
          <div class="text-xs md:text-base font-extrabold tabular-nums mt-0.5 ${f.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${f.netProfit >= 0 ? '+' : ''}${f.netProfit.toFixed(1)}億</div>
        </div>
      </div>

      <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 md:p-3 mb-2.5 text-[10px] md:text-xs grid grid-cols-2 gap-x-4 gap-y-1.5">
        <div class="flex justify-between"><span class="text-slate-400">運賃収入</span><span class="font-bold text-slate-200">${f.fareRev.toFixed(1)}億</span></div>
        <div class="flex justify-between"><span class="text-slate-400">路線・駅維持</span><span class="font-bold text-slate-200">${f.trackCost.toFixed(1)}億</span></div>
        <div class="flex justify-between"><span class="text-slate-400">特急料金</span><span class="font-bold text-slate-200">${f.expressRev.toFixed(1)}億</span></div>
        <div class="flex justify-between"><span class="text-slate-400">列車運行費</span><span class="font-bold text-slate-200">${f.opCost.toFixed(1)}億</span></div>
        <div class="flex justify-between"><span class="text-slate-400">沿線不動産</span><span class="font-bold text-slate-200">${f.estateRev.toFixed(1)}億</span></div>
        <div class="flex justify-between"><span class="text-slate-400">直通・施設費</span><span class="font-bold text-slate-200">${(f.directCost + f.landmarkCost).toFixed(1)}億</span></div>
      </div>

      <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 md:p-3 mb-2.5">
        <div class="text-[10px] md:text-xs font-bold text-slate-400 mb-1.5">沿線人口の推移（万人）</div>
        <div class="relative h-20 md:h-32 w-full">
          <canvas id="pop-chart-canvas" class="w-full h-full"></canvas>
        </div>
      </div>

      <div class="text-[10px] md:text-xs font-bold text-slate-400 mb-1.5">駅別パフォーマンス</div>
      <div class="space-y-1.5">
        ${state.myStations.map(st => `
          <div class="flex items-center justify-between bg-slate-800/60 rounded-lg px-2.5 py-1.5 text-[10.5px] md:text-xs">
            <span class="font-bold text-white">${st.name}</span>
            <div class="flex items-center gap-2.5 tabular-nums">
              <span class="text-slate-300">${(st.ridership / 1000).toFixed(1)}千人/日</span>
              <span class="${st.hubTime <= 35 ? 'text-emerald-400' : 'text-amber-300'} font-bold">都心${st.hubTime}分</span>
              <span class="${st.congestion > 130 ? 'text-rose-400 font-bold' : 'text-slate-400'}">混雑${st.congestion}%</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    drawPopChart();
  }

  function drawPopChart() {
    const c = document.getElementById('pop-chart-canvas');
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = c.getBoundingClientRect();
    const w = Math.max(120, Math.floor(rect.width));
    const h = Math.max(50, Math.floor(rect.height));
    c.width = w * dpr;
    c.height = h * dpr;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const data = state.history.corridorPop;
    if (data.length < 2) {
      g.fillStyle = '#94a3b8';
      g.font = '10px sans-serif';
      g.fillText('月が進むと人口推移が表示されます', 8, h * 0.55);
      return;
    }

    const minV = Math.min(...data) * 0.99;
    const maxV = Math.max(...data) * 1.01 + 100;
    const padX = 8, padY = 8;

    g.beginPath();
    data.forEach((v, i) => {
      const px = padX + (i / (data.length - 1)) * (w - padX * 2);
      const py = h - padY - ((v - minV) / (maxV - minV)) * (h - padY * 2);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.strokeStyle = '#38bdf8';
    g.lineWidth = 2;
    g.stroke();

    const lastV = data[data.length - 1];
    g.fillStyle = '#e2e8f0';
    g.font = 'bold 10px sans-serif';
    g.fillText(`${(lastV / 10000).toFixed(2)}万人`, w - 58, 12);
  }

  // =========================================================================
  // 8. プレイヤー操作ハンドラ
  // =========================================================================
  function syncTouchConfirmButton() {
    const btn = document.getElementById('btn-confirm-place');
    if (!btn) return;
    const canConfirm = !!(IS_TOUCH && state.buildMode && state.pendingTap && state.pendingTap.mode === state.buildMode && state.hoverPreview && state.hoverPreview.valid !== false);
    btn.classList.toggle('hidden', !canConfirm);
  }

  function showPreviewForCurrentMode(lat, lng) {
    if (state.buildMode === 'track') updateTrackHoverPreview(lat, lng);
    else if (state.buildMode === 'station') updateStationHoverPreview(lat, lng);
    else if (state.buildMode === 'road') updateRoadHoverPreview(lat, lng);
    else if (state.buildMode === 'rotary') updateRotaryHoverPreview(lat, lng);
    else if (state.buildMode === 'redev') updateRedevHoverPreview(lat, lng);
    else if (state.buildMode === 'landmark') updateLandmarkHoverPreview(lat, lng);
  }

  function executePlacementForCurrentMode(lat, lng) {
    state.pendingTap = null;
    syncTouchConfirmButton();
    if (state.buildMode === 'track') tryAddTrackNode(lat, lng);
    else if (state.buildMode === 'station') tryPlaceStationOnTrack(lat, lng);
    else if (state.buildMode === 'road') tryAddRoadNode(lat, lng);
    else if (state.buildMode === 'rotary') tryPlaceRotary(lat, lng);
    else if (state.buildMode === 'redev') tryPlaceRedevBlock(lat, lng);
    else if (state.buildMode === 'landmark') tryPlaceDevelopment(lat, lng);
  }

  function clearPreviewTrack() {
    if (map && mapReady && map.getSource('preview-track')) {
      map.getSource('preview-track').setData({ type: 'FeatureCollection', features: [] });
    }
    if (map && mapReady && map.getSource('preview-dev')) {
      map.getSource('preview-dev').setData({ type: 'FeatureCollection', features: [] });
    }
    const box = document.getElementById('align-preview-box');
    if (box) box.classList.add('hidden');
    state.hoverPreview = null;
    state.pendingTap = null;
    syncTouchConfirmButton();
  }

  function getActiveAnchorAndTangent() {
    if (state.trackNodes.length === 0) return { anchor: null, tangent: null };
    if (state.activeEnd === 'start') {
      const anchor = state.trackNodes[0];
      const seg0 = state.segments[0];
      const tangent = seg0 ? [-seg0.startDir[0], -seg0.startDir[1]] : null;
      return { anchor, tangent };
    }
    const anchor = state.trackNodes[state.trackNodes.length - 1];
    const segLast = state.segments[state.segments.length - 1];
    const tangent = segLast ? [segLast.endDir[0], segLast.endDir[1]] : null;
    return { anchor, tangent };
  }

  function buildCandidateTrackNode(lat, lng, fastPreview = false) {
    // 既存駅への強制スナップは廃止し、クリック位置をそのまま採用
    const targetLat = lat;
    const targetLng = lng;
    const nearEx = getNearestExistingStation(targetLat, targetLng, 0.50);
    const nearExDistM = nearEx ? Math.round(haversineKm(targetLat, targetLng, nearEx.lat, nearEx.lng) * 1000) : null;
    const muni = getNearestMunicipality(targetLat, targetLng);

    if (state.trackNodes.length === 0) {
      return {
        valid: true,
        isFirst: true,
        nearEx,
        nearExDistM,
        targetLat,
        targetLng,
        muni,
        cost: 0,
        coords: [],
        arc: null,
        analysis: null
      };
    }

    const { anchor, tangent } = getActiveAnchorAndTangent();
    const distKm = haversineKm(anchor.lat, anchor.lng, targetLat, targetLng);

    if (distKm < 0.005) {
      return { valid: false, reason: '同じ地点が選択されています' };
    }
    if (distKm > 10.0) {
      return { valid: false, reason: '1区間が長すぎます（10km以内で指定してください）' };
    }

    const arc = buildTangentArc(anchor.lng, anchor.lat, tangent, targetLng, targetLat);
    if (!arc || arc.invalid) {
      return { valid: false, reason: (arc && arc.reason) || '線形を生成できません' };
    }

    const analysis = analyzeAlignmentOnMap(arc.coords, state.buildStructure, muni.priceBase, fastPreview);
    analysis.minRadiusM = arc.minRadiusM;
    analysis.maxSpeedKmh = Math.max(30, speedLimitForRadius(arc.minRadiusM) - analysis.levelCrossings * 7);

    return {
      valid: true,
      isFirst: false,
      attachToStart: state.activeEnd === 'start',
      nearEx,
      nearExDistM,
      targetLat,
      targetLng,
      muni,
      cost: analysis.totalCost,
      coords: arc.coords,
      arc,
      analysis
    };
  }

  function updateTrackHoverPreview(lat, lng) {
    const box = document.getElementById('align-preview-box');
    const cand = buildCandidateTrackNode(lat, lng, true);
    state.hoverPreview = cand;

    if (!cand.valid) {
      if (map && mapReady && map.getSource('preview-track')) {
        map.getSource('preview-track').setData({ type: 'FeatureCollection', features: [] });
      }
      if (box) {
        box.classList.remove('hidden');
        box.innerHTML = `<span class="text-rose-300 font-bold">${cand.reason}</span>`;
      }
      return;
    }

    if (cand.isFirst) {
      if (map && mapReady && map.getSource('preview-track')) {
        map.getSource('preview-track').setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: { color: '#38bdf8' },
            geometry: { type: 'Point', coordinates: [cand.targetLng, cand.targetLat] }
          }]
        });
      }
      if (box) {
        box.classList.remove('hidden');
        const lp = getNearestLocalPlace(cand.targetLat, cand.targetLng, 2.0);
        const exTxt = cand.nearEx ? `<span class="text-amber-300 font-bold">${cand.nearEx.name}駅まで${cand.nearExDistM}m</span> ・ ` : '';
        box.innerHTML = `${exTxt}${cand.muni.name}${lp ? `・${lp.name}` : ''}から線路敷設を開始（始点 0億円）`;
      }
      return;
    }

    const a = cand.analysis;
    const okFunds = state.funds >= cand.cost;
    let lineColor = '#22c55e';
    if (!okFunds) lineColor = '#f43f5e';
    else if (a.minRadiusM < 250 || a.levelCrossings > 0) lineColor = '#f59e0b';

    if (map && mapReady && map.getSource('preview-track')) {
      map.getSource('preview-track').setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { color: lineColor },
            geometry: { type: 'LineString', coordinates: cand.coords }
          },
          {
            type: 'Feature',
            properties: { color: lineColor },
            geometry: { type: 'Point', coordinates: [cand.targetLng, cand.targetLat] }
          }
        ]
      });
    }

    if (box) {
      const tags = [];
      if (cand.nearEx) tags.push(`<span class="text-amber-300 font-bold">${cand.nearEx.name}駅 ${cand.nearExDistM}m</span>`);
      if (a.hasRiver) tags.push(`<span class="text-sky-300">河川渡河(+${a.riverCost}億)</span>`);
      if (a.levelCrossings > 0) tags.push(`<span class="text-rose-300 font-bold">幹線踏切x${a.levelCrossings}(減速)</span>`);
      else if (a.majorRoadCrossings > 0) tags.push(`<span class="text-emerald-300">幹線道路立体交差</span>`);
      if (a.roadUndergroundDiscount) tags.push(`<span class="text-emerald-300 font-bold">公道下シールド-20%</span>`);
      if (a.structure !== 'underground' && a.buildingDensity >= 0.25) tags.push(`<span class="text-amber-300">建物密集地</span>`);

      const rLabel = a.minRadiusM >= 1900 ? '直線' : `R${a.minRadiusM}m`;
      const rColor = a.minRadiusM < 250 ? 'text-rose-300' : (a.minRadiusM < 450 ? 'text-amber-300' : 'text-emerald-300');
      box.classList.remove('hidden');
      box.innerHTML = `
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <span>区間 <strong>${a.lengthKm.toFixed(2)}km</strong> ・ <strong class="${rColor}">${rLabel}</strong> (上限${a.maxSpeedKmh}km/h)</span>
          <span class="font-extrabold ${okFunds ? 'text-amber-300' : 'text-rose-400'}">敷設費 ${cand.cost}億円</span>
        </div>
        ${tags.length ? `<div class="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5">${tags.join('')}</div>` : ''}
      `;
    }
  }

  function tryAddTrackNode(lat, lng) {
    // 反対側の端点をクリックしたら延伸端を切り替える（Train World風）
    if (state.trackNodes.length >= 2) {
      const oppIdx = state.activeEnd === 'start' ? state.trackNodes.length - 1 : 0;
      const opp = state.trackNodes[oppIdx];
      if (haversineKm(lat, lng, opp.lat, opp.lng) < 0.28) {
        state.activeEnd = state.activeEnd === 'start' ? 'end' : 'start';
        playSfx('tap');
        showToast(state.activeEnd === 'start' ? '延伸端を始点側に切り替えました' : '延伸端を終点側に切り替えました');
        syncMapGeoJSON();
        updateHUD();
        return;
      }
    }

    const cand = buildCandidateTrackNode(lat, lng, false);
    if (!cand.valid) {
      showToast(cand.reason);
      playSfx('error');
      return;
    }
    if (state.funds < cand.cost) {
      showToast(`資金が不足しています（必要: ${cand.cost}億円）`);
      playSfx('error');
      return;
    }

    const { targetLat, targetLng, attachToStart, arc, analysis } = cand;
    state.funds = Math.round((state.funds - cand.cost) * 10) / 10;
    const nodeId = 'nd_' + (Date.now() % 100000) + '_' + state.trackNodes.length;
    const prevEnd = state.trackNodes.length > 0
      ? (attachToStart ? state.trackNodes[0] : state.trackNodes[state.trackNodes.length - 1])
      : null;

    const newNode = { id: nodeId, lat: targetLat, lng: targetLng, costPaid: cand.cost };
    if (attachToStart) state.trackNodes.unshift(newNode);
    else state.trackNodes.push(newNode);

    if (prevEnd && arc && analysis) {
      const orderedCoords = attachToStart ? arc.coords.slice().reverse() : arc.coords;
      const startDir = attachToStart ? [-arc.endDir[0], -arc.endDir[1]] : arc.startDir;
      const endDir = attachToStart ? [-arc.startDir[0], -arc.startDir[1]] : arc.endDir;
      const segEntry = {
        fromId: attachToStart ? nodeId : prevEnd.id,
        toId: attachToStart ? prevEnd.id : nodeId,
        structure: state.buildStructure,
        coords: orderedCoords,
        startDir,
        endDir,
        lengthKm: analysis.lengthKm,
        startKm: 0,
        endKm: analysis.lengthKm,
        minRadiusM: analysis.minRadiusM,
        levelCrossings: analysis.levelCrossings,
        hasRiver: analysis.hasRiver,
        roadUndergroundDiscount: analysis.roadUndergroundDiscount,
        maxSpeedKmh: analysis.maxSpeedKmh
      };
      if (attachToStart) state.segments.unshift(segEntry);
      else state.segments.push(segEntry);
    }

    state.undoStack.push({
      type: 'track',
      side: attachToStart ? 'start' : 'end',
      nodeId,
      costPaid: cand.cost,
      hadSegment: !!(prevEnd && arc)
    });

    rebuildRoutePolyline();
    clearPreviewTrack();
    playSfx('build');

    if (state.trackNodes.length === 1) {
      showToast('始点を設定しました。次の地点をクリックして線路を敷設してください');
    } else {
      const stLabel = (STRUCTURES[state.buildStructure] || STRUCTURES.surface).name;
      showToast(`線路を敷設（${stLabel}・${analysis.lengthKm.toFixed(1)}km・${cand.cost}億円）`);
    }

    recalculateSimulation(false);
    rebuildTrainActors();
    syncMapGeoJSON();
    syncStationMarkers();
    updateHUD();
    renderPanel();
  }

  function undoLastAction() {
    if (state.undoStack.length === 0) {
      showToast('元に戻せる操作がありません');
      return;
    }
    const last = state.undoStack.pop();
    if (last.type === 'station') {
      const idx = state.myStations.findIndex(s => s.id === last.stationId);
      if (idx >= 0) {
        state.myStations.splice(idx, 1);
        state.services.forEach(sv => { delete sv.stops[last.stationId]; });
        state.funds = Math.round((state.funds + last.costPaid) * 10) / 10;
        if (state.selectedStationId === last.stationId) {
          state.selectedStationId = state.myStations[0] ? state.myStations[0].id : null;
        }
        playSfx('tap');
        showToast(`直前の駅設置を取り消しました（+${last.costPaid}億円）`);
      }
    } else if (last.type === 'track') {
      if (state.trackNodes.length <= 2 && state.myStations.length > 0) {
        state.undoStack.push(last);
        showToast('駅が設置されているため、先に駅を取り消してください');
        playSfx('error');
        return;
      }
      if (last.side === 'start') {
        state.trackNodes.shift();
        if (last.hadSegment) state.segments.shift();
      } else {
        state.trackNodes.pop();
        if (last.hadSegment) state.segments.pop();
      }
      state.funds = Math.round((state.funds + last.costPaid) * 10) / 10;
      rebuildRoutePolyline();
      playSfx('tap');
      showToast(`直前の線路敷設を取り消しました（+${last.costPaid}億円）`);
    } else if (last.type === 'road') {
      if (last.roadId) {
        const rIdx = state.customRoads.findIndex(r => r.id === last.roadId);
        if (rIdx >= 0) state.customRoads.splice(rIdx, 1);
      }
      if (last.wasFirstNode) {
        state.activeRoadNodes = [];
        state.activeRoadChainId = null;
      } else if (state.activeRoadChainId === last.chainId && state.activeRoadNodes.length > 0) {
        state.activeRoadNodes.pop();
      }
      state.funds = Math.round((state.funds + last.costPaid) * 10) / 10;
      playSfx('tap');
      showToast(`直前の道路敷設を取り消しました（+${last.costPaid}億円）`);
    } else if (last.type === 'rotary') {
      const idx = state.rotaries.findIndex(r => r.id === last.rotaryId);
      if (idx >= 0) {
        const rot = state.rotaries[idx];
        state.rotaries.splice(idx, 1);
        if (rot.approachRoadIds && rot.approachRoadIds.length > 0) {
          state.customRoads = state.customRoads.filter(r => !rot.approachRoadIds.includes(r.id));
        }
      }
      state.funds = Math.round((state.funds + last.costPaid) * 10) / 10;
      playSfx('tap');
      showToast(`直前の駅前ロータリーを取り消しました（+${last.costPaid}億円）`);
    } else if (last.type === 'redev') {
      if (last.zoneId) {
        const zIdx = state.redevZones.findIndex(z => z.id === last.zoneId);
        if (zIdx >= 0) state.redevZones.splice(zIdx, 1);
      }
      if (last.roadIds && last.roadIds.length > 0) {
        state.customRoads = state.customRoads.filter(r => !last.roadIds.includes(r.id));
      }
      state.funds = Math.round((state.funds + last.costPaid) * 10) / 10;
      playSfx('tap');
      showToast(`直前の区画整理を取り消しました（+${last.costPaid}億円）`);
    } else if (last.type === 'development') {
      const dIdx = state.developments.findIndex(d => d.id === last.devId);
      if (dIdx >= 0) {
        const dev = state.developments[dIdx];
        state.developments.splice(dIdx, 1);
        const lm = LANDMARKS.find(l => l.id === dev.landmarkId);
        const st = dev.stationId ? state.myStations.find(s => s.id === dev.stationId) : null;
        if (lm && st) {
          st.areaPop = Math.max(3000, st.areaPop - (last.popAdded || 0));
          st.comm = Math.max(12, st.comm - (last.commAdded || 0));
          st.devLevel = Math.max(0, st.devLevel - 10);
        }
      }
      state.funds = Math.round((state.funds + last.costPaid) * 10) / 10;
      playSfx('tap');
      showToast(`直前の施設建設を取り消しました（+${last.costPaid}億円）`);
    }
    clearPreviewTrack();
    recalculateSimulation(false);
    rebuildTrainActors();
    syncMapGeoJSON();
    syncStationMarkers();
    updateHUD();
    renderPanel();
  }

  function buildCandidateStationOnTrack(lat, lng) {
    if (state.routePolyline.length < 2) {
      return { valid: false, reason: '先に線路を引いてください' };
    }
    const proj = projectPointToPolyline(lat, lng);
    if (!proj || proj.distKm > 0.65) {
      return { valid: false, reason: '引いた線路の上（近く）をクリックしてください' };
    }
    if (state.myStations.some(s => haversineKm(s.lat, s.lng, proj.lat, proj.lng) < 0.35)) {
      return { valid: false, reason: '既存の自社駅に近すぎます（350m以上離してください）' };
    }
    const nearEx = getNearestExistingStation(proj.lat, proj.lng, 0.65);
    const transferDistM = nearEx ? Math.round(haversineKm(proj.lat, proj.lng, nearEx.lat, nearEx.lng) * 1000) : null;
    const transferInfo = nearEx ? getTransferInfo(transferDistM) : null;
    const muni = getNearestMunicipality(proj.lat, proj.lng);
    const suggestedName = pickStationName(proj.lat, proj.lng, nearEx, transferDistM, muni);
    const cost = Math.round(16 + muni.priceBase * 0.25);
    return {
      valid: true,
      lat: proj.lat,
      lng: proj.lng,
      routeKm: proj.routeKm,
      nearEx,
      transferDistM,
      transferInfo,
      suggestedName,
      muni,
      cost
    };
  }

  function updateStationHoverPreview(lat, lng) {
    const box = document.getElementById('align-preview-box');
    const cand = buildCandidateStationOnTrack(lat, lng);
    state.hoverPreview = cand;

    if (!cand.valid) {
      if (map && mapReady && map.getSource('preview-track')) {
        map.getSource('preview-track').setData({ type: 'FeatureCollection', features: [] });
      }
      if (box) {
        box.classList.remove('hidden');
        box.innerHTML = `<span class="text-amber-300">${cand.reason}</span>`;
      }
      return;
    }

    const okFunds = state.funds >= cand.cost;
    const color = okFunds ? '#10b981' : '#f43f5e';
    if (map && mapReady && map.getSource('preview-track')) {
      map.getSource('preview-track').setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: { color },
          geometry: { type: 'Point', coordinates: [cand.lng, cand.lat] }
        }]
      });
    }
    if (box) {
      box.classList.remove('hidden');
      const trTxt = cand.nearEx
        ? `<span class="text-amber-300 font-bold">${cand.nearEx.name}駅 ${cand.transferDistM}m (${cand.transferInfo.label}・乗換${cand.transferInfo.penaltyMin}分${cand.transferInfo.canDirect ? '・直通可' : ''})</span> ・ `
        : '';
      box.innerHTML = `${trTxt}新駅「<strong>${cand.suggestedName}</strong>」を設置 (${cand.muni.name}) ・建設費 <strong class="${okFunds ? 'text-amber-300' : 'text-rose-400'}">${cand.cost}億円</strong>`;
    }
  }

  function tryPlaceStationOnTrack(lat, lng) {
    const cand = buildCandidateStationOnTrack(lat, lng);
    if (!cand.valid) {
      showToast(cand.reason);
      playSfx('error');
      return;
    }
    if (state.funds < cand.cost) {
      showToast(`資金が不足しています（必要: ${cand.cost}億円）`);
      playSfx('error');
      return;
    }

    state.funds = Math.round((state.funds - cand.cost) * 10) / 10;
    const newId = 'st_' + (state.myStations.length + 1);
    const newName = cand.suggestedName || pickStationName(cand.lat, cand.lng, cand.nearEx, cand.transferDistM, cand.muni);

    const newStation = createStationState({
      id: newId,
      name: newName,
      lat: cand.lat,
      lng: cand.lng,
      hasPassing: false,
      existingId: cand.nearEx ? cand.nearEx.id : null,
      transferDistM: cand.transferDistM,
      routeKm: cand.routeKm
    });

    state.myStations.push(newStation);
    state.myStations.sort((a, b) => a.routeKm - b.routeKm);
    state.undoStack.push({ type: 'station', stationId: newId, costPaid: cand.cost });

    state.services.forEach(sv => { sv.stops[newId] = true; });
    state.selectedStationId = newId;
    state.selectedPoint = { lat: cand.lat, lng: cand.lng, muni: cand.muni };
    clearPreviewTrack();

    playSfx('build');
    if (state.myStations.length === 1) {
      showToast(`${newName}駅を設置（${cand.cost}億円）。あと1駅で開通します`);
    } else if (state.myStations.length === 2) {
      showToast(`${newName}駅が開業し路線が開通しました（${cand.cost}億円）`);
    } else {
      showToast(`${newName}駅を開業（建設費 ${cand.cost}億円）`);
    }

    recalculateSimulation(false);
    rebuildTrainActors();
    syncMapGeoJSON();
    syncStationMarkers();
    updateHUD();
    renderPanel();
  }

  const urban = window.RAIL_URBAN.createUrbanController({
    state,
    getMap: () => map,
    isMapReady: () => mapReady,
    getCachedRoadLayers: () => cachedRoadLayers,
    LANDMARKS, ROAD_TYPES, REDEV_TOOLS,
    geo: window.RAIL_GEO,
    playSfx, showToast, clearPreviewTrack,
    recalculateSimulation, syncMapGeoJSON, syncStationMarkers,
    updateHUD, renderPanel
  });
  const {
    isInsideRedevZone, findNearestRoadAlignment,
    updateRoadHoverPreview, tryAddRoadNode,
    updateRotaryHoverPreview, tryPlaceRotary,
    updateRedevHoverPreview, tryPlaceRedevBlock,
    updateLandmarkHoverPreview, tryPlaceDevelopment
  } = urban;

  document.getElementById('panel-content').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'set-structure') {
      state.buildStructure = btn.dataset.struct;
      playSfx('tap');
      updateHUD();
      renderPanel();
    } else if (action === 'mode-track') {
      state.buildMode = state.buildMode === 'track' ? null : 'track';
      playSfx('tap');
      clearPreviewTrack();
      updateHUD();
      renderPanel();
    } else if (action === 'mode-station') {
      if (state.trackNodes.length < 2) {
        showToast('先に「線路を引く」で線路を敷設してください');
        playSfx('error');
        return;
      }
      state.buildMode = state.buildMode === 'station' ? null : 'station';
      playSfx('tap');
      clearPreviewTrack();
      updateHUD();
      renderPanel();
    } else if (action === 'select-station') {
      const st = state.myStations.find(s => s.id === btn.dataset.stid);
      if (st) {
        state.selectedStationId = st.id;
        state.selectedPoint = { lat: st.lat, lng: st.lng, muni: getNearestMunicipality(st.lat, st.lng) };
        if (map) map.easeTo({ center: [st.lng, st.lat], zoom: Math.max(map.getZoom(), 13.4), duration: 450 });
        playSfx('tap');
        updateHUD();
        renderPanel();
        syncStationMarkers();
      }
    } else if (action === 'upgrade-passing') {
      const st = state.myStations.find(s => s.id === btn.dataset.stid);
      if (!st || st.hasPassing) return;
      if (state.funds < 35) {
        showToast('資金不足です（必要: 35億円）');
        playSfx('error');
        return;
      }
      state.funds = Math.round((state.funds - 35) * 10) / 10;
      st.hasPassing = true;
      playSfx('build');
      showToast(`${st.name}駅を2面4線（待避線付き）に拡張！`);
      recalculateSimulation(false);
      syncMapGeoJSON();
      syncStationMarkers();
      updateHUD();
      renderPanel();
    } else if (action === 'sign-direct') {
      const ex = EXISTING_STATIONS.find(x => x.id === btn.dataset.exid);
      if (!ex || state.directAgreements[ex.id]) return;
      if (state.funds < ex.directCost) {
        showToast(`資金不足です（必要: ${ex.directCost}億円）`);
        playSfx('error');
        return;
      }
      state.funds = Math.round((state.funds - ex.directCost) * 10) / 10;
      state.directAgreements[ex.id] = true;
      state.services.forEach(sv => { if (sv.enabled) sv.direct = true; });
      playSfx('direct');
      showToast(`${ex.name}駅で${ex.lines[0]}との直通運転を開始しました`);
      recalculateSimulation(false);
      syncMapGeoJSON();
      syncStationMarkers();
      updateHUD();
      renderPanel();
    } else if (action === 'toggle-service') {
      const sv = state.services.find(s => s.id === btn.dataset.svid);
      if (!sv) return;
      if (sv.id === 'local') {
        showToast('各駅停車は常時運行が必要です');
        playSfx('error');
        return;
      }
      sv.enabled = !sv.enabled;
      playSfx('tap');
      recalculateSimulation(false);
      rebuildTrainActors();
      syncMapGeoJSON();
      updateHUD();
      renderPanel();
    } else if (action === 'freq-up' || action === 'freq-down') {
      const sv = state.services.find(s => s.id === btn.dataset.svid);
      if (!sv) return;
      sv.freq = Math.max(1, Math.min(12, sv.freq + (action === 'freq-up' ? 1 : -1)));
      playSfx('tap');
      recalculateSimulation(false);
      rebuildTrainActors();
      syncMapGeoJSON();
      updateHUD();
      renderPanel();
    } else if (action === 'toggle-sv-direct') {
      const sv = state.services.find(s => s.id === btn.dataset.svid);
      if (!sv) return;
      if (getConnectedDirectStations().length === 0) {
        showToast('先に「路線・駅」タブで直通運転協定を結んでください');
        playSfx('error');
        return;
      }
      sv.direct = !sv.direct;
      playSfx('tap');
      recalculateSimulation(false);
      syncMapGeoJSON();
      updateHUD();
      renderPanel();
    } else if (action === 'toggle-stop') {
      const sv = state.services.find(s => s.id === btn.dataset.svid);
      const stId = btn.dataset.stid;
      const idx = state.myStations.findIndex(s => s.id === stId);
      if (!sv || idx < 0) return;
      if (sv.id === 'local' || idx === 0 || idx === state.myStations.length - 1) {
        showToast('各停および両端の終点駅は停車固定です');
        return;
      }
      sv.stops[stId] = !sv.stops[stId];
      playSfx('tap');
      recalculateSimulation(false);
      syncMapGeoJSON();
      updateHUD();
      renderPanel();
    } else if (action === 'set-zoning') {
      const st = state.myStations.find(s => s.id === btn.dataset.stid);
      if (!st) return;
      st.zoning = btn.dataset.zoning;
      playSfx('tap');
      showToast(`${st.name}駅周辺を「${ZONINGS[st.zoning].name}」に変更`);
      recalculateSimulation(false);
      syncMapGeoJSON();
      updateHUD();
      renderPanel();
    } else if (action === 'mode-road') {
      state.buildMode = state.buildMode === 'road' ? null : 'road';
      state.activeRoadChainId = null;
      state.activeRoadNodes = [];
      playSfx('tap');
      clearPreviewTrack();
      updateHUD();
      renderPanel();
    } else if (action === 'mode-rotary') {
      state.buildMode = state.buildMode === 'rotary' ? null : 'rotary';
      playSfx('tap');
      clearPreviewTrack();
      updateHUD();
      renderPanel();
    } else if (action === 'mode-redev') {
      state.buildMode = state.buildMode === 'redev' ? null : 'redev';
      playSfx('tap');
      clearPreviewTrack();
      updateHUD();
      renderPanel();
    } else if (action === 'select-landmark-build') {
      const lmId = btn.dataset.lmid;
      if (state.buildMode === 'landmark' && state.selectedLandmarkId === lmId) {
        state.buildMode = null;
      } else {
        state.selectedLandmarkId = lmId;
        state.buildMode = 'landmark';
      }
      playSfx('tap');
      clearPreviewTrack();
      updateHUD();
      renderPanel();
    } else if (action === 'build-landmark') {
      const st = state.myStations.find(s => s.id === btn.dataset.stid);
      const lm = LANDMARKS.find(l => l.id === btn.dataset.lmid);
      if (!st || !lm) return;
      if (st.landmark === lm.id) {
        showToast('この施設はすでに建設済みです');
        return;
      }
      if (state.funds < lm.cost) {
        showToast(`資金不足です（必要: ${lm.cost}億円）`);
        playSfx('error');
        return;
      }
      state.funds = Math.round((state.funds - lm.cost) * 10) / 10;
      st.landmark = lm.id;
      st.areaPop += lm.popAdd;
      st.comm = Math.min(100, st.comm + lm.commAdd);
      st.devLevel = Math.min(100, st.devLevel + 18);
      if (map) map.easeTo({ center: [st.lng, st.lat], zoom: Math.max(map.getZoom(), 14.2), pitch: 58, duration: 500 });
      playSfx('build');
      showToast(`${st.name}駅前に「${lm.name}」が開業しました`);
      recalculateSimulation(false);
      syncMapGeoJSON();
      syncStationMarkers();
      updateHUD();
      renderPanel();
    }
  });

  // タブ切り替え
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.panelCollapsed) setPanelCollapsed(false);
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeTab = btn.dataset.tab;
      if (state.activeTab !== 'route' && (state.buildMode === 'track' || state.buildMode === 'station')) state.buildMode = null;
      if (state.activeTab !== 'dev' && ['road', 'rotary', 'redev', 'landmark'].includes(state.buildMode)) state.buildMode = null;
      playSfx('tap');
      updateHUD();
      renderPanel();
    });
  });

  // 速度・ミュート・ヘルプ（モバイル用コンパクトボタンも同期）
  function syncSpeedButtons(sp) {
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
    const pcBtn = document.getElementById(`btn-speed-${sp}`);
    if (pcBtn) pcBtn.classList.add('active');
    [0, 1, 3].forEach(v => {
      const mBtn = document.getElementById(`btn-speed-${v}-m`);
      if (!mBtn) return;
      if (v === sp) {
        mBtn.className = 'speed-btn-proxy active px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-600 text-white border border-sky-500 cursor-pointer';
      } else {
        mBtn.className = 'speed-btn-proxy px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 cursor-pointer';
      }
    });
  }
  [0, 1, 3].forEach(sp => {
    const el = document.getElementById(`btn-speed-${sp}`);
    if (el) {
      el.addEventListener('click', () => {
        state.speed = sp;
        syncSpeedButtons(sp);
        playSfx('tap');
      });
    }
  });
  document.querySelectorAll('[data-proxy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.proxy);
      if (target) target.click();
    });
  });

  // モバイル用パネル折りたたみトグル（地図を広く操作可能）
  function setPanelCollapsed(collapsed) {
    state.panelCollapsed = !!collapsed;
    const panelEl = document.getElementById('panel-area');
    const lbl = document.getElementById('panel-toggle-label');
    if (panelEl) panelEl.classList.toggle('collapsed', state.panelCollapsed);
    if (lbl) lbl.textContent = state.panelCollapsed ? 'パネルを開く' : 'パネルをたたんで地図を広く見る';
    if (map) setTimeout(() => map.resize(), 60);
  }
  const panelToggleBtn = document.getElementById('btn-panel-toggle');
  if (panelToggleBtn) {
    panelToggleBtn.addEventListener('click', () => {
      setPanelCollapsed(!state.panelCollapsed);
      playSfx('tap');
    });
  }
  const confirmPlaceBtn = document.getElementById('btn-confirm-place');
  if (confirmPlaceBtn) {
    confirmPlaceBtn.addEventListener('click', () => {
      if (state.pendingTap && state.pendingTap.mode === state.buildMode) {
        executePlacementForCurrentMode(state.pendingTap.lat, state.pendingTap.lng);
      }
    });
  }

  document.getElementById('btn-mute').addEventListener('click', (e) => {
    isMuted = !isMuted;
    e.currentTarget.textContent = isMuted ? '音OFF' : '音ON';
  });

  const helpModal = document.getElementById('help-modal');
  document.getElementById('btn-help').addEventListener('click', () => { helpModal.classList.remove('hidden'); playSfx('tap'); });
  document.getElementById('btn-close-help').addEventListener('click', () => { helpModal.classList.add('hidden'); });
  document.getElementById('btn-start-play').addEventListener('click', () => { helpModal.classList.add('hidden'); playSfx('tap'); });
  document.getElementById('btn-show-tutorial').addEventListener('click', () => {
    state.tutorialVisible = true;
    state.tutorialSkippedDirect = false;
    helpModal.classList.add('hidden');
    playSfx('tap');
    renderTutorial();
  });

  function switchTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tabName);
    });
    if (tabName !== 'route' && (state.buildMode === 'track' || state.buildMode === 'station')) state.buildMode = null;
    if (tabName !== 'dev' && ['road', 'rotary', 'redev', 'landmark'].includes(state.buildMode)) state.buildMode = null;
    updateHUD();
    renderPanel();
  }

  document.getElementById('tutorial-box').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tut-action]');
    if (!btn) return;
    const act = btn.dataset.tutAction;
    playSfx('tap');
    if (act === 'tut-close') {
      state.tutorialVisible = false;
      renderTutorial();
    } else if (act === 'tut-start-track') {
      switchTab('route');
      state.buildMode = 'track';
      updateHUD();
      renderPanel();
    } else if (act === 'tut-start-station') {
      switchTab('route');
      state.buildMode = 'station';
      updateHUD();
      renderPanel();
    } else if (act === 'tut-go-route') {
      switchTab('route');
    } else if (act === 'tut-go-service') {
      switchTab('service');
    } else if (act === 'tut-go-dev') {
      switchTab('dev');
    } else if (act === 'tut-skip-direct') {
      state.tutorialSkippedDirect = true;
      renderTutorial();
    }
  });
  document.getElementById('btn-undo-node').addEventListener('click', () => { undoLastAction(); });
  document.getElementById('btn-switch-end').addEventListener('click', () => {
    if (state.trackNodes.length < 2) return;
    state.activeEnd = state.activeEnd === 'start' ? 'end' : 'start';
    playSfx('tap');
    syncMapGeoJSON();
    updateHUD();
  });
  document.getElementById('btn-cancel-mode').addEventListener('click', () => {
    state.buildMode = null;
    state.activeRoadChainId = null;
    state.activeRoadNodes = [];
    updateHUD();
    renderPanel();
  });
  const devModeBarEl = document.getElementById('dev-mode-bar');
  if (devModeBarEl) {
    devModeBarEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-dev-act]');
      if (!btn) return;
      const act = btn.dataset.devAct;
      playSfx('tap');
      if (act === 'set-road-type') {
        state.roadType = btn.dataset.val;
      } else if (act === 'new-road-chain') {
        state.activeRoadChainId = null;
        state.activeRoadNodes = [];
        clearPreviewTrack();
        showToast('新しい道路の起点をクリックしてください');
      } else if (act === 'set-redev-tool') {
        state.redevTool = btn.dataset.val;
      } else if (act === 'rotate-dev') {
        state.devAngleDeg = (state.devAngleDeg + 15) % 360;
      } else if (act === 'toggle-road-snap') {
        state.devRoadSnap = !state.devRoadSnap;
      }
      updateHUD();
      if (state.pendingTap && state.pendingTap.mode === state.buildMode) {
        showPreviewForCurrentMode(state.pendingTap.lat, state.pendingTap.lng);
        syncTouchConfirmButton();
      }
    });
  }
  document.querySelectorAll('.struct-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      state.buildStructure = btn.dataset.struct;
      playSfx('tap');
      updateHUD();
      renderPanel();
    });
  });

  // マップ操作ボタン
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    if (map) map.zoomIn({ duration: 250 });
    playSfx('tap');
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    if (map) map.zoomOut({ duration: 250 });
    playSfx('tap');
  });
  document.getElementById('btn-view-toggle').addEventListener('click', (e) => {
    state.is25D = !state.is25D;
    e.currentTarget.textContent = state.is25D ? '2.5D' : '2D';
    if (map) {
      map.easeTo({ pitch: state.is25D ? (IS_MOBILE ? 20 : 35) : 0, bearing: state.is25D ? (IS_MOBILE ? 0 : -14) : 0, duration: 350 });
      realBuildingLayerIds.forEach(lid => {
        try { map.setLayoutProperty(lid, 'visibility', state.is25D ? 'visible' : 'none'); } catch (_) {}
      });
    }
    playSfx('tap');
  });
  document.getElementById('btn-layer-speed').addEventListener('click', (e) => {
    state.showSpeedHeat = !state.showSpeedHeat;
    e.currentTarget.textContent = state.showSpeedHeat ? '速度' : '路線';
    e.currentTarget.className = `w-8 h-8 md:w-10 md:h-10 rounded-lg bg-white/95 hover:bg-white font-extrabold text-[9px] md:text-xs border border-slate-300 shadow active:scale-95 cursor-pointer ${state.showSpeedHeat ? 'text-emerald-700' : 'text-sky-700'}`;
    syncMapGeoJSON();
    playSfx('tap');
  });
  document.getElementById('btn-center').addEventListener('click', () => {
    const sel = document.getElementById('area-select');
    const preset = (JAPAN_PRESETS || []).find(p => p.id === (sel && sel.value)) || { lat: 35.626, lng: 139.555, zoom: 12.2 };
    if (map) map.easeTo({ center: [preset.lng, preset.lat], zoom: preset.zoom, pitch: state.is25D ? 35 : 0, bearing: state.is25D ? -14 : 0, duration: 450 });
    playSfx('tap');
  });

  const areaSelectEl = document.getElementById('area-select');
  if (areaSelectEl) {
    areaSelectEl.addEventListener('change', () => {
      const preset = (JAPAN_PRESETS || []).find(p => p.id === areaSelectEl.value);
      if (!preset || !map) return;
      playSfx('tap');
      map.jumpTo({ center: [preset.lng, preset.lat], zoom: preset.zoom, pitch: state.is25D ? 35 : 0, bearing: state.is25D ? -14 : 0 });
      if (preset.useBuiltin) {
        EXISTING_STATIONS = BUILTIN_STATIONS.slice();
        customExistingLinesGeoJSON = null;
        loadedOsmWayIds = new Set();
        if (map.getSource('existing-lines')) map.getSource('existing-lines').setData(buildExistingLinesGeoJSON());
        if (map.getSource('existing-stations')) map.getSource('existing-stations').setData(buildExistingStationsGeoJSON());
        showToast('東京西南部エリアへ移動しました（周辺路線を読込で全路線取得も可）');
      } else {
        showToast(`${preset.name}へ移動しました。広域の既存駅を一括読込します...`);
        setTimeout(() => loadOsmRailForCurrentView(true, preset.bbox || null, preset.id), 250);
      }
    });
  }

  const loadOsmBtn = document.getElementById('btn-load-osm-rail');
  if (loadOsmBtn) {
    loadOsmBtn.addEventListener('click', () => {
      playSfx('tap');
      loadOsmRailForCurrentView();
    });
  }

  // =========================================================================
  // 9. メインループ
  // =========================================================================
  let lastFrameTime = 0;
  let rafId = null;

  function gameLoop(ts) {
    if (!lastFrameTime) lastFrameTime = ts;
    const dt = Math.min(0.1, (ts - lastFrameTime) / 1000);
    lastFrameTime = ts;

    if (state.speed > 0 && !document.hidden) {
      const maxSeg = Math.max(1, state.myStations.length - 1);
      if (state.trains.length > 0) {
        state.trains.forEach(tr => {
          const step = (tr.speed / 135) * dt * state.speed;
          tr.progress += step * tr.dir;
          if (tr.progress >= maxSeg) { tr.progress = maxSeg; tr.dir = -1; }
          else if (tr.progress <= 0) { tr.progress = 0; tr.dir = 1; }
        });
        if (ts - lastTrainRenderTs >= (IS_MOBILE ? 220 : 140)) {
          lastTrainRenderTs = ts;
          updateTrainGeoJSON();
        }
      }

      state.tickInMonth += dt * state.speed;
      if (state.tickInMonth >= 4.5) {
        state.tickInMonth = 0;
        state.month += 1;
        if (state.month > 12) { state.month = 1; state.year += 1; }
        recalculateSimulation(true);
        recordHistory();
        if (state.myStations.length > 0) syncMapGeoJSON({ tracks: false, dev: false });
        playSfx('month');
        updateHUD();
        if (state.activeTab === 'finance') renderPanel();
      }
    }

    rafId = requestAnimationFrame(gameLoop);
  }

  window.addEventListener('resize', () => {
    if (map) map.resize();
    if (state.activeTab === 'finance') drawPopChart();
  });

  if (typeof ResizeObserver !== 'undefined') {
    const mapWrapEl = document.getElementById('map-wrapper');
    if (mapWrapEl) {
      new ResizeObserver(() => {
        if (map) map.resize();
      }).observe(mapWrapEl);
    }
  }

  // PC向けキーボードショートカット（Ctrl+Z / Cmd+Z で元に戻す対応）
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undoLastAction();
      return;
    }
    if (e.key === 'Escape') {
      if (!helpModal.classList.contains('hidden')) {
        helpModal.classList.add('hidden');
      } else if (state.buildMode) {
        state.buildMode = null;
        updateHUD();
        renderPanel();
      }
    } else if (e.key === ' ') {
      e.preventDefault();
      const nextSp = state.speed === 0 ? 1 : 0;
      document.getElementById(`btn-speed-${nextSp}`).click();
    } else if (e.key === '1') {
      document.getElementById('btn-speed-1').click();
    } else if (e.key === '3') {
      document.getElementById('btn-speed-3').click();
    } else if (e.key.toLowerCase() === 'r' && (state.buildMode === 'landmark' || state.buildMode === 'redev')) {
      state.devAngleDeg = (state.devAngleDeg + 15) % 360;
      playSfx('tap');
      updateHUD();
    } else if (e.key.toLowerCase() === 'n' && state.buildMode === 'road') {
      state.activeRoadChainId = null;
      state.activeRoadNodes = [];
      clearPreviewTrack();
      playSfx('tap');
      showToast('新しい道路の起点をクリックしてください');
      updateHUD();
    }
  });

  window.addEventListener('load', () => {
    initWorld();
    initMap();
    updateHUD();
    renderPanel();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(gameLoop);
  });
})();
