(() => {
  'use strict';

  // =========================================================================
  // 1. 効果音（Web Audio API）
  // =========================================================================
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
    EXISTING_STATIONS,
    EXISTING_LINES,
    STRUCTURES,
    ZONINGS,
    LANDMARKS
  } = window.RAIL_DATA;

  // =========================================================================
  // 3. 地理計算ユーティリティ
  // =========================================================================
  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

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
    return best;
  }

  function getNearestExistingStation(lat, lng, maxKm = 0.85) {
    let best = null;
    let bestDist = maxKm;
    for (const ex of EXISTING_STATIONS) {
      const d = haversineKm(lat, lng, ex.lat, ex.lng);
      if (d < bestDist) {
        bestDist = d;
        best = ex;
      }
    }
    return best;
  }

  // 局所平面メートル座標変換（基準緯度）
  function toLocalMeters(lng, lat, refLng, refLat) {
    const mLat = 111320;
    const mLng = 111320 * Math.cos(refLat * Math.PI / 180);
    return [(lng - refLng) * mLng, (lat - refLat) * mLat];
  }

  function fromLocalMeters(x, y, refLng, refLat) {
    const mLat = 111320;
    const mLng = 111320 * Math.cos(refLat * Math.PI / 180);
    return [refLng + x / mLng, refLat + y / mLat];
  }

  // 3点を通る円の半径（Menger曲率半径・メートル）
  function calcRadiusMeters(p0, p1, p2) {
    const refLng = p1[0], refLat = p1[1];
    const [x0, y0] = toLocalMeters(p0[0], p0[1], refLng, refLat);
    const [x2, y2] = toLocalMeters(p2[0], p2[1], refLng, refLat);
    const a = Math.hypot(x0, y0);
    const b = Math.hypot(x2, y2);
    const c = Math.hypot(x2 - x0, y2 - y0);
    const area2 = Math.abs(x0 * y2 - y0 * x2);
    if (area2 < 1e-3 || a < 1 || b < 1 || c < 1) return 9999;
    return (a * b * c) / (2 * area2);
  }

  // Catmull-Rom / Cubic Hermite による滑らかな鉄道線形（経由点列から各区間の曲線点列を生成）
  function computeRouteCurves(nodes) {
    const n = nodes.length;
    if (n < 2) return [];
    const refLng = nodes[0].lng;
    const refLat = nodes[0].lat;
    const pts = nodes.map(s => toLocalMeters(s.lng, s.lat, refLng, refLat));

    const tangents = [];
    for (let i = 0; i < n; i++) {
      let tx = 0, ty = 0;
      if (i === 0) {
        tx = pts[1][0] - pts[0][0];
        ty = pts[1][1] - pts[0][1];
      } else if (i === n - 1) {
        tx = pts[n - 1][0] - pts[n - 2][0];
        ty = pts[n - 1][1] - pts[n - 2][1];
      } else {
        const dx1 = pts[i][0] - pts[i - 1][0], dy1 = pts[i][1] - pts[i - 1][1];
        const l1 = Math.hypot(dx1, dy1) || 1;
        const dx2 = pts[i + 1][0] - pts[i][0], dy2 = pts[i + 1][1] - pts[i][1];
        const l2 = Math.hypot(dx2, dy2) || 1;
        tx = dx1 / l1 + dx2 / l2;
        ty = dy1 / l1 + dy2 / l2;
        if (Math.hypot(tx, ty) < 1e-4) { tx = dx2 / l2; ty = dy2 / l2; }
      }
      const len = Math.hypot(tx, ty) || 1;
      tangents.push([tx / len, ty / len]);
    }

    const curves = [];
    const SAMPLES = 24;
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      const segDist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const handle = segDist * 0.34;
      const t0 = [tangents[i][0] * handle * 3, tangents[i][1] * handle * 3];
      const t1 = [tangents[i + 1][0] * handle * 3, tangents[i + 1][1] * handle * 3];

      const coords = [];
      let arcM = 0;
      let prev = null;
      for (let s = 0; s <= SAMPLES; s++) {
        const u = s / SAMPLES;
        const u2 = u * u, u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1;
        const h10 = u3 - 2 * u2 + u;
        const h01 = -2 * u3 + 3 * u2;
        const h11 = u3 - u2;
        const x = h00 * p0[0] + h10 * t0[0] + h01 * p1[0] + h11 * t1[0];
        const y = h00 * p0[1] + h10 * t0[1] + h01 * p1[1] + h11 * t1[1];
        if (prev) arcM += Math.hypot(x - prev[0], y - prev[1]);
        prev = [x, y];
        coords.push(fromLocalMeters(x, y, refLng, refLat));
      }

      let minR = 9999;
      for (let k = 2; k < coords.length - 2; k += 2) {
        const r = calcRadiusMeters(coords[k - 2], coords[k], coords[k + 2]);
        if (r < minR) minR = r;
      }

      curves.push({
        coords,
        lengthKm: arcM / 1000,
        minRadiusM: Math.round(Math.min(2000, minR))
      });
    }
    return curves;
  }

  // 曲線半径に基づく現実的な鉄道制限速度（km/h）
  function speedLimitForRadius(r) {
    if (r >= 800) return 110;
    if (r >= 500) return 90;
    if (r >= 350) return 75;
    if (r >= 240) return 60;
    if (r >= 160) return 48;
    return 36;
  }

  // 実在ベクトル地図（OpenFreeMap）上の道路・河川・建物を軽量サンプリング解析
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
    const step = fastPreview ? Math.max(1, Math.floor((coords.length - 2) / 7)) : Math.max(1, Math.floor((coords.length - 2) / 14));
    let sampledCount = 0;

    if (map && mapReady && cachedInfraLayers.length > 0) {
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

    // 構造別の現実的な線路敷設コスト算出（億円・駅建設費は別）
    const stDef = STRUCTURES[structure] || STRUCTURES.surface;
    const baseTrackCost = (4 + lengthKm * 7.5) * stDef.costMult;
    const landAcqCost = structure === 'underground'
      ? muniPriceBase * 0.06
      : (muniPriceBase * 0.14 + buildingDensity * lengthKm * 8.0);
    const riverCost = hasRiver ? (structure === 'underground' ? 28 : 20) : 0;
    const curveCost = minRadiusM < 250 ? 8 : 0;
    let totalCost = baseTrackCost + landAcqCost + riverCost + curveCost;
    if (roadUndergroundDiscount) totalCost *= 0.80;
    totalCost = Math.max(3, Math.round(totalCost));

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

  // 指定緯度経度の周囲に3D押し出しポリゴン（矩形）を作る
  function makeBuildingPolygon(lng, lat, halfW_m, halfH_m, offsetLng_m = 0, offsetLat_m = 0) {
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(lat * Math.PI / 180);
    const cLng = lng + offsetLng_m / mPerDegLng;
    const cLat = lat + offsetLat_m / mPerDegLat;
    const dLng = halfW_m / mPerDegLng;
    const dLat = halfH_m / mPerDegLat;
    return [[
      [cLng - dLng, cLat - dLat],
      [cLng + dLng, cLat - dLat],
      [cLng + dLng, cLat + dLat],
      [cLng - dLng, cLat + dLat],
      [cLng - dLng, cLat - dLat]
    ]];
  }

  // =========================================================================
  // 4. ゲーム状態（State）
  // =========================================================================
  const state = {
    year: 2026,
    month: 4,
    tickInMonth: 0,
    speed: 1,
    funds: 500.0,
    activeTab: 'route',
    buildMode: 'track', // 'track' | 'station' | null
    selectedPoint: null,
    selectedStationId: null,
    is25D: true,
    showSpeedHeat: true,
    tutorialVisible: true,
    tutorialSkippedDirect: false,
    buildStructure: 'elevated',
    hoverPreview: null,

    trackNodes: [],
    myStations: [],
    segments: [],
    routePolyline: [],
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

  function createStationState({ id, name, lat, lng, hasPassing, existingId, zoning, routeKm }) {
    const muni = getNearestMunicipality(lat, lng);
    const density = muni.pop / muni.area;
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
    state.myStations = [];
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

  function rebuildSegmentsGeometry() {
    const n = state.trackNodes.length;
    if (n < 2) {
      state.segments = [];
      state.routePolyline = [];
      return;
    }
    const oldMeta = {};
    state.segments.forEach(sg => {
      oldMeta[`${sg.fromId}_${sg.toId}`] = sg;
      oldMeta[`${sg.toId}_${sg.fromId}`] = sg;
    });

    const curves = computeRouteCurves(state.trackNodes);
    const newSegs = [];
    const polyline = [];
    let totalKm = 0;

    for (let i = 0; i < n - 1; i++) {
      const a = state.trackNodes[i];
      const b = state.trackNodes[i + 1];
      const prev = oldMeta[`${a.id}_${b.id}`];
      const struct = prev ? prev.structure : state.buildStructure;
      const c = curves[i];
      const levelCrossings = prev ? prev.levelCrossings : 0;
      const hasRiver = prev ? prev.hasRiver : false;
      const roadUndergroundDiscount = prev ? prev.roadUndergroundDiscount : false;
      const maxSpeedKmh = Math.max(30, speedLimitForRadius(c.minRadiusM) - levelCrossings * 7);
      const startKm = totalKm;

      c.coords.forEach((pt, idx) => {
        if (i > 0 && idx === 0) return;
        if (polyline.length > 0) {
          const lp = polyline[polyline.length - 1];
          totalKm += haversineKm(lp.lat, lp.lng, pt[1], pt[0]);
        }
        polyline.push({ lng: pt[0], lat: pt[1], cumKm: totalKm });
      });

      newSegs.push({
        fromId: a.id,
        toId: b.id,
        structure: struct,
        coords: c.coords,
        lengthKm: totalKm - startKm,
        startKm,
        endKm: totalKm,
        minRadiusM: c.minRadiusM,
        levelCrossings,
        hasRiver,
        roadUndergroundDiscount,
        maxSpeedKmh
      });
    }
    state.segments = newSegs;
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
    return 0;
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

          const transferPenalty = gw.ex.hub ? 0 : (canDirectHere ? 0 : 10);
          const totalMin = gw.ex.hubCost + bestRunMin + waitMin + transferPenalty;
          if (totalMin < bestHubTime) bestHubTime = totalMin;
        }
      }

      const lm = st.landmark ? LANDMARKS.find(l => l.id === st.landmark) : null;
      const lmRev = lm ? lm.revAdd : 0;
      const lmWeekend = lm ? lm.weekendBoost : 1.0;

      const rawAccess = Math.max(5, Math.min(100, 108 - (bestHubTime - 12) * 1.45));
      const commutingDemand = st.areaPop * (rawAccess / 100) * 0.32;
      const incomingDemand = (st.comm * 160) * (rawAccess / 100) * lmWeekend + (totalWeekendAttr * 18);
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
  // 6. MapLibre GL JS 実在2.5Dマップ（軽量化チューニング済）
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
      zoom: window.innerWidth >= 900 ? 12.2 : 11.8,
      pitch: 50,
      bearing: -14,
      antialias: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
      fadeDuration: 0,
      maxTileCacheSize: 48,
      maxPitch: 65
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
      try {
        const styleObj = map.getStyle();
        const layers = (styleObj && styleObj.layers) || [];
        let has3D = false;
        cachedInfraLayers = [];
        realBuildingLayerIds = [];
        layers.forEach(l => {
          const sl = l['source-layer'] || '';
          if (sl === 'transportation' || sl === 'water' || sl === 'waterway' || sl === 'building') {
            cachedInfraLayers.push(l.id);
          }
          if (l.type === 'fill-extrusion') {
            has3D = true;
            realBuildingLayerIds.push(l.id);
            map.setLayerZoomRange(l.id, 13.8, 24);
            map.setPaintProperty(l.id, 'fill-extrusion-color', [
              'interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 12],
              0, '#f8fafc',
              25, '#e2e8f0',
              70, '#cbd5e1'
            ]);
            map.setPaintProperty(l.id, 'fill-extrusion-opacity', 0.88);
          }
        });
        if (!has3D && styleObj && styleObj.sources && styleObj.sources.openmaptiles) {
          map.addLayer({
            id: 'custom-real-buildings-3d',
            type: 'fill-extrusion',
            source: 'openmaptiles',
            'source-layer': 'building',
            minzoom: 13.8,
            paint: {
              'fill-extrusion-color': '#e2e8f0',
              'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
              'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
              'fill-extrusion-opacity': 0.86
            }
          });
          realBuildingLayerIds.push('custom-real-buildings-3d');
          cachedInfraLayers.push('custom-real-buildings-3d');
        }
      } catch (_) {}

      setupGameMapLayers();
      mapReady = true;
      syncMapGeoJSON();
      syncStationMarkers();
    });

    let lastPreviewTs = 0;
    map.on('mousemove', (e) => {
      if (!state.buildMode) {
        if (state.hoverPreview) clearPreviewTrack();
        return;
      }
      const now = performance.now();
      if (now - lastPreviewTs < 120) return;
      lastPreviewTs = now;
      if (state.buildMode === 'track') {
        updateTrackHoverPreview(e.lngLat.lat, e.lngLat.lng);
      } else if (state.buildMode === 'station') {
        updateStationHoverPreview(e.lngLat.lat, e.lngLat.lng);
      }
    });

    map.on('click', (e) => {
      const lat = e.lngLat.lat;
      const lng = e.lngLat.lng;
      if (state.buildMode === 'track') {
        tryAddTrackNode(lat, lng);
      } else if (state.buildMode === 'station') {
        tryPlaceStationOnTrack(lat, lng);
      } else {
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

  function setupGameMapLayers() {
    // 1. 既存他社路線
    if (!map.getSource('existing-lines')) {
      map.addSource('existing-lines', { type: 'geojson', data: buildExistingLinesGeoJSON() });
      map.addLayer({
        id: 'existing-lines-layer',
        type: 'line',
        source: 'existing-lines',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 3.5],
          'line-opacity': 0.58,
          'line-dasharray': [2.5, 1.8]
        }
      });
    }

    // 2. 既存駅ドット＆ラベル（主要駅は常時、途中各駅はズーム12.2以上で表示）
    if (!map.getSource('existing-stations')) {
      map.addSource('existing-stations', { type: 'geojson', data: buildExistingStationsGeoJSON() });
      map.addLayer({
        id: 'existing-stations-circle',
        type: 'circle',
        source: 'existing-stations',
        paint: {
          'circle-radius': ['case', ['get', 'hub'], 6.5, ['get', 'major'], 4.8, 3.2],
          'circle-color': ['case', ['get', 'hub'], '#0f172a', '#ffffff'],
          'circle-stroke-color': ['case', ['get', 'hub'], '#f59e0b', ['get', 'major'], '#334155', '#64748b'],
          'circle-stroke-width': ['case', ['get', 'major'], 2, 1.4]
        }
      });
      map.addLayer({
        id: 'existing-stations-label-major',
        type: 'symbol',
        source: 'existing-stations',
        filter: ['any', ['get', 'hub'], ['get', 'major']],
        layout: {
          'text-field': ['get', 'name'],
          'text-size': ['case', ['get', 'hub'], 12, 10.5],
          'text-offset': [0, -1.1],
          'text-anchor': 'bottom'
        },
        paint: {
          'text-color': '#0f172a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2
        }
      });
      map.addLayer({
        id: 'existing-stations-label-local',
        type: 'symbol',
        source: 'existing-stations',
        minzoom: 12.2,
        filter: ['all', ['!', ['get', 'hub']], ['!', ['get', 'major']]],
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 9.5,
          'text-offset': [0, -0.9],
          'text-anchor': 'bottom'
        },
        paint: {
          'text-color': '#475569',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.6
        }
      });
    }

    // 3. 駅勢圏インパクトサークル
    if (!map.getSource('station-zones')) {
      map.addSource('station-zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'station-zones-fill',
        type: 'circle',
        source: 'station-zones',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 12, 14, 38],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.22,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 1.2,
          'circle-stroke-opacity': 0.55
        }
      });
    }

    // 4. 自社開発3Dビル＆大型ランドマーク
    if (!map.getSource('dev-buildings')) {
      map.addSource('dev-buildings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'dev-buildings-3d',
        type: 'fill-extrusion',
        source: 'dev-buildings',
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.92
        }
      });
    }

    // 5. 自社路線（地上・高架・地下の構造別ビジュアル＋曲線線形）
    if (!map.getSource('my-track')) {
      map.addSource('my-track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'my-track-elevated-shadow',
        type: 'line',
        source: 'my-track',
        filter: ['==', ['get', 'structure'], 'elevated'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': 'rgba(15, 23, 42, 0.35)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 8, 14, 15],
          'line-translate': [2, 4]
        }
      });
      map.addLayer({
        id: 'my-track-casing',
        type: 'line',
        source: 'my-track',
        filter: ['!=', ['get', 'structure'], 'underground'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#0f172a',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5.5, 14, 10.5]
        }
      });
      map.addLayer({
        id: 'my-track-inner',
        type: 'line',
        source: 'my-track',
        filter: ['!=', ['get', 'structure'], 'underground'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.2, 14, 6.4]
        }
      });
      map.addLayer({
        id: 'my-track-underground-casing',
        type: 'line',
        source: 'my-track',
        filter: ['==', ['get', 'structure'], 'underground'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': '#0f172a',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5.5, 14, 9.5],
          'line-opacity': 0.55,
          'line-dasharray': [2.2, 1.4]
        }
      });
      map.addLayer({
        id: 'my-track-underground',
        type: 'line',
        source: 'my-track',
        filter: ['==', ['get', 'structure'], 'underground'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.2, 14, 5.8],
          'line-opacity': 0.85,
          'line-dasharray': [2.2, 1.4]
        }
      });
    }

    // 5b. 線路制御点（経由点ノード）
    if (!map.getSource('my-track-nodes')) {
      map.addSource('my-track-nodes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'my-track-nodes-circle',
        type: 'circle',
        source: 'my-track-nodes',
        paint: {
          'circle-radius': 4,
          'circle-color': '#38bdf8',
          'circle-stroke-color': '#0f172a',
          'circle-stroke-width': 1.5
        }
      });
    }

    // 5c. 延伸・駅設置リアルタイムプレビュー
    if (!map.getSource('preview-track')) {
      map.addSource('preview-track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'preview-track-line',
        type: 'line',
        source: 'preview-track',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 7],
          'line-opacity': 0.85,
          'line-dasharray': [1.8, 1.4]
        }
      });
      map.addLayer({
        id: 'preview-track-point',
        type: 'circle',
        source: 'preview-track',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 8,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.5
        }
      });
    }

    // 6. 走行中の自社列車
    if (!map.getSource('my-trains')) {
      map.addSource('my-trains', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'my-trains-circle',
        type: 'circle',
        source: 'my-trains',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4.5, 14, 7.5],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2
        }
      });
    }
  }

  function buildExistingLinesGeoJSON() {
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

  function syncMapGeoJSON() {
    if (!mapReady || !map) return;

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
      map.getSource('my-track-nodes').setData({
        type: 'FeatureCollection',
        features: state.trackNodes.map(nd => ({
          type: 'Feature',
          properties: { id: nd.id },
          geometry: { type: 'Point', coordinates: [nd.lng, nd.lat] }
        }))
      });
    }

    const bldgFeatures = [];
    state.myStations.forEach(st => {
      const z = ZONINGS[st.zoning] || ZONINGS.residential;
      const baseH = 22 + st.devLevel * 1.1 + (st.accessScore * 0.45);

      const offsets = [
        [110, 85, 42, 36, 1.0],
        [-115, 75, 38, 38, 0.85],
        [95, -95, 36, 40, 0.78],
        [-105, -90, 40, 34, 0.72]
      ];
      offsets.forEach(([ox, oy, hw, hh, mult]) => {
        bldgFeatures.push({
          type: 'Feature',
          properties: { color: z.color, height: Math.round(baseH * mult) },
          geometry: { type: 'Polygon', coordinates: makeBuildingPolygon(st.lng, st.lat, hw, hh, ox, oy) }
        });
      });

      if (st.landmark) {
        const lm = LANDMARKS.find(l => l.id === st.landmark);
        if (lm) {
          bldgFeatures.push({
            type: 'Feature',
            properties: { color: lm.color, height: Math.round(115 + st.devLevel * 0.9) },
            geometry: { type: 'Polygon', coordinates: makeBuildingPolygon(st.lng, st.lat, 62, 62, 0, 145) }
          });
        }
      }
    });
    if (map.getSource('dev-buildings')) {
      map.getSource('dev-buildings').setData({ type: 'FeatureCollection', features: bldgFeatures });
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
      el.innerHTML = `<span>${st.name}${isDirect ? '★' : ''}${st.hasPassing ? ' [4]' : ''}</span>${lm ? `<span>${lm.icon}</span>` : ''}`;
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
  // 7. UI レンダリング（HUD & 4タブパネル）
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
    const undoBtn = document.getElementById('btn-undo-node');
    const mapWrap = document.getElementById('map-wrapper');
    if (state.buildMode === 'track') {
      banner.classList.remove('hidden');
      if (structBar) structBar.classList.remove('hidden');
      if (undoBtn) undoBtn.classList.toggle('hidden', state.trackNodes.length === 0);
      if (mapWrap) mapWrap.classList.add('extend-cursor');
      if (state.trackNodes.length === 0) {
        bannerText.textContent = '🛤️ 線路の始点をマップでクリック（既存駅付近で自動接続）';
      } else {
        bannerText.textContent = '🛤️ 線路の経由点を次々クリックして自由な線形を引こう';
      }
    } else if (state.buildMode === 'station') {
      banner.classList.remove('hidden');
      if (structBar) structBar.classList.add('hidden');
      if (undoBtn) undoBtn.classList.add('hidden');
      if (mapWrap) mapWrap.classList.add('extend-cursor');
      bannerText.textContent = '🚉 引いた線路上の好きな場所をクリックして駅を設置';
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
      titleEl.textContent = state.trackNodes.length < 2 ? '🛤️ まずは線路を引こう' : '🚉 線路上に駅を設置しよう';
      subEl.textContent = state.trackNodes.length < 2
        ? 'マップをクリックして自由な曲線線形を敷設（地上／高架／地下）'
        : `敷設済み ${getLineLengthKm().toFixed(1)}km — 「駅を設置」で2駅以上置くと開通`;
      return;
    }
    const st = state.myStations.find(s => s.id === state.selectedStationId);
    if (st && state.selectedPoint && haversineKm(st.lat, st.lng, state.selectedPoint.lat, state.selectedPoint.lng) < 0.3) {
      const directTag = st.existingId && state.directAgreements[st.existingId] ? ' [直通中]' : '';
      titleEl.textContent = `🚉 ${st.name}駅${directTag} (${st.muniName})`;
      subEl.textContent = state.myStations.length < 2
        ? '2駅目を設置すると運行が開始されます'
        : `都心体感 ${st.hubTime}分 / 乗降 ${(st.ridership / 1000).toFixed(1)}千人/日 / 混雑 ${st.congestion}%`;
      return;
    }
    if (state.selectedPoint) {
      const m = state.selectedPoint.muni;
      const nearEx = getNearestExistingStation(state.selectedPoint.lat, state.selectedPoint.lng, 0.9);
      titleEl.textContent = `${m.name}${nearEx ? `・${nearEx.name}駅付近` : ''}`;
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
    const hasLandmark = state.myStations.some(st => !!st.landmark);

    if (nodes < 2) {
      return {
        step: 1, total: 6,
        title: 'まずは線路（線形）を引こう',
        desc: 'マップ上で始点と経由点を次々クリックして自由な線形を引けます。地上／高架／地下を切り替えながら、道路や河川に合わせて敷設してみよう！',
        ctaLabel: state.buildMode === 'track' ? null : '🛤️ 線路を引く',
        ctaAction: 'tut-start-track'
      };
    }
    if (n < 2) {
      return {
        step: 2, total: 6,
        title: '線路上に駅を2つ以上設置しよう',
        desc: '「🚉 駅を設置」モードに切り替えて、引いた線路の上をクリック！2駅以上置くと列車が走り始めます（既存駅付近は自動接続）。',
        ctaLabel: state.buildMode === 'station' ? null : '🚉 駅を設置する',
        ctaAction: 'tut-start-station'
      };
    }
    if (n === 2) {
      return {
        step: 3, total: 6,
        title: '3駅目を設置して沿線を広げよう',
        desc: 'さらに線路を伸ばすか、途中に3駅目を設置してみよう。中間駅ができると待避線や急行の追い越しが活きてきます！',
        ctaLabel: state.buildMode === 'station' ? null : '🚉 3駅目を設置',
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
      title: '🎉 チュートリアル完了！',
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
    const canDirectStations = state.myStations.filter(s => s.existingId);

    if (n === 0) {
      const km = getLineLengthKm();
      container.innerHTML = `
        <div class="mb-3">
          <div class="text-xs md:text-base font-extrabold text-white">新線建設プロジェクト（線路 ${km.toFixed(1)}km）</div>
          <div class="text-[10px] md:text-xs text-slate-400 mt-0.5">① 線路を引く → ② 線路上に駅を設置する</div>
        </div>
        <div class="grid grid-cols-2 gap-2 mb-3">
          <button data-action="mode-track" class="py-2 px-3 rounded-xl text-xs md:text-sm font-bold cursor-pointer border ${state.buildMode === 'track' ? 'bg-sky-600 border-sky-300 text-white shadow' : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200'}">
            🛤️ 線路を引く
          </button>
          <button data-action="mode-station" class="py-2 px-3 rounded-xl text-xs md:text-sm font-bold cursor-pointer border ${state.buildMode === 'station' ? 'bg-emerald-600 border-emerald-300 text-white shadow' : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200'} ${state.trackNodes.length < 2 ? 'opacity-50' : ''}">
            🚉 駅を設置
          </button>
        </div>
        <div class="mb-3">
          <div class="text-[10px] md:text-xs font-bold text-slate-400 mb-1.5">敷設構造（道路・河川との兼ね合い）</div>
          <div class="grid grid-cols-3 gap-1.5">
            ${Object.values(STRUCTURES).map(stf => {
              const active = state.buildStructure === stf.id;
              return `
                <button data-action="set-structure" data-struct="${stf.id}" class="py-1.5 px-2 rounded-lg text-[10px] md:text-xs font-bold border cursor-pointer ${active ? 'bg-sky-600/25 border-sky-400 text-white' : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'}">
                  ${stf.icon} ${stf.name}
                </button>`;
            }).join('')}
          </div>
          <div class="text-[10px] md:text-xs text-slate-400 mt-1">${STRUCTURES[state.buildStructure].desc}</div>
        </div>
        <div class="bg-slate-800/80 border border-slate-700 rounded-xl p-3 text-xs md:text-sm text-slate-300 space-y-1.5 leading-relaxed">
          <p>${state.trackNodes.length < 2 ? 'マップ上で始点と経由点をクリックして自由な線形を引いてください。' : '線路が敷設されました！「🚉 駅を設置」を押して線路上に駅を2つ以上置くと開通します。'}</p>
          <p class="text-[11px] md:text-xs text-amber-300">💡 既存駅（白丸）の近くを通るように線路を引き、駅を置くと直通運転協定を結べます。</p>
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
                  <div class="text-[10px] md:text-xs text-slate-400">${active ? `直通中 (線路使用料 ${ex.directFee}億/月・乗換0分)` : `協定費 ${ex.directCost}億 / 乗換ペナルティ-10分`}</div>
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
            ${state.buildMode === 'track' ? '🛤️ 線路敷設中' : '🛤️ 線路を延伸'}
          </button>
          <button data-action="mode-station" class="py-1.5 md:py-2 px-2.5 rounded-lg text-xs md:text-sm font-bold cursor-pointer border ${state.buildMode === 'station' ? 'bg-emerald-600 border-emerald-300 text-white shadow' : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200'}">
            ${state.buildMode === 'station' ? '🚉 駅設置中' : '🚉 駅を設置'}
          </button>
        </div>
      </div>

      ${st ? `
      <div class="bg-slate-800/90 border border-slate-700 rounded-xl p-2.5 md:p-3.5">
        <div class="flex items-center justify-between gap-2">
          <div>
            <div class="text-xs md:text-sm font-bold text-sky-300">選択駅: ${st.name}駅</div>
            <div class="text-[10px] md:text-xs text-slate-300 mt-1">${n < 2 ? '開業準備中（2駅目を設置してください）' : `都心体感 <strong class="text-white">${st.hubTime}分</strong> ・乗降 ${(st.ridership / 1000).toFixed(1)}千人/日 ・混雑 ${st.congestion}%`}</div>
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
                ${stf.icon} ${stf.name}
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
                <span class="font-bold text-slate-200 truncate pr-2">${stf.icon} 区間${idx + 1} (${sg.lengthKm.toFixed(1)}km)</span>
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
          2駅以上を設置すると、種別（各停・準急・急行・特急）の運行本数や停車駅、直通運転を設定できるようになります。
        </div>`;
      return;
    }

    const hasPassing = hasIntermediatePassingTrack();
    const hasDirect = getConnectedDirectStations().length > 0;

    container.innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <div class="text-xs md:text-sm font-extrabold text-white">種別・停車駅エディタ（1時間あたり）</div>
        <span class="text-[10px] md:text-xs font-bold ${hasPassing ? 'text-emerald-400' : 'text-amber-300'}">${hasPassing ? '待避線OK' : '⚠ 待避線なし'}</span>
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

  // --- タブ3: 沿線開発 ---
  function renderDevTab(container) {
    const st = state.myStations.find(s => s.id === state.selectedStationId) || state.myStations[0];
    if (!st) {
      container.innerHTML = `
        <div class="bg-slate-800/80 border border-slate-700 rounded-xl p-4 text-xs md:text-sm text-slate-300 leading-relaxed">
          駅を設置すると、駅ごとの開発方針（ゾーニング）や大型ランドマークの建設ができるようになります。
        </div>`;
      return;
    }
    const currentLm = st.landmark ? LANDMARKS.find(l => l.id === st.landmark) : null;

    container.innerHTML = `
      <div class="flex items-center justify-between gap-2 mb-2.5">
        <div class="text-xs md:text-base font-extrabold text-white shrink-0">沿線開発: <span class="text-sky-300">${st.name}駅</span></div>
        <div class="flex gap-1.5 overflow-x-auto max-w-[55%]">
          ${state.myStations.map(s => `
            <button data-action="select-station" data-stid="${s.id}" class="px-2 md:px-2.5 py-1 rounded text-[10px] md:text-xs font-bold shrink-0 cursor-pointer ${s.id === st.id ? 'bg-sky-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-400'}">${s.name}</button>
          `).join('')}
        </div>
      </div>

      <div class="mb-3">
        <div class="text-[10px] md:text-xs font-bold text-slate-400 mb-1.5">一般市街地の開発方針（3D自動成長）</div>
        <div class="grid grid-cols-4 gap-1.5 md:gap-2">
          ${Object.values(ZONINGS).map(z => {
            const active = st.zoning === z.id;
            return `
              <button data-action="set-zoning" data-stid="${st.id}" data-zoning="${z.id}" class="py-1.5 md:py-2 px-1 rounded-lg text-[10px] md:text-xs font-bold border cursor-pointer ${active ? 'bg-slate-800 text-white' : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-800'}" style="${active ? `border-color:${z.color};box-shadow:inset 0 0 0 1px ${z.color}` : ''}">
                ${z.name}
              </button>`;
          }).join('')}
        </div>
        <div class="text-[10px] md:text-xs text-slate-300 mt-1.5">${ZONINGS[st.zoning].desc}</div>
      </div>

      <div>
        <div class="flex items-center justify-between mb-1.5">
          <div class="text-[10px] md:text-xs font-bold text-slate-400">大型ランドマーク（直接建設・1駅1施設）</div>
          ${currentLm ? `<span class="text-[10px] md:text-xs font-bold text-emerald-400">建設済: ${currentLm.icon}${currentLm.name}</span>` : ''}
        </div>
        <div class="grid grid-cols-2 gap-1.5 md:gap-2.5">
          ${LANDMARKS.map(lm => {
            const builtHere = st.landmark === lm.id;
            return `
              <button data-action="build-landmark" data-stid="${st.id}" data-lmid="${lm.id}" class="text-left p-2 md:p-3 rounded-xl border cursor-pointer ${builtHere ? 'bg-emerald-950/60 border-emerald-500/70' : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700'} transition">
                <div class="flex items-center justify-between gap-1">
                  <span class="text-xs md:text-sm font-bold text-white">${lm.icon} ${lm.name}</span>
                  <span class="text-[10px] md:text-xs font-extrabold text-amber-300 shrink-0">${lm.cost}億</span>
                </div>
                <div class="text-[9.5px] md:text-xs text-slate-300 mt-1 leading-snug">${lm.desc}</div>
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
  // 8. プレイヤー操作ハンドラ（線路先引き＆駅設置）
  // =========================================================================
  function clearPreviewTrack() {
    if (map && mapReady && map.getSource('preview-track')) {
      map.getSource('preview-track').setData({ type: 'FeatureCollection', features: [] });
    }
    const box = document.getElementById('align-preview-box');
    if (box) box.classList.add('hidden');
    state.hoverPreview = null;
  }

  function buildCandidateTrackNode(lat, lng, fastPreview = false) {
    const nearEx = getNearestExistingStation(lat, lng, 0.45);
    const targetLat = nearEx ? nearEx.lat : lat;
    const targetLng = nearEx ? nearEx.lng : lng;
    const muni = getNearestMunicipality(targetLat, targetLng);

    if (state.trackNodes.length === 0) {
      return {
        valid: true,
        isFirst: true,
        nearEx,
        targetLat,
        targetLng,
        muni,
        cost: 0,
        coords: [],
        analysis: null
      };
    }

    const first = state.trackNodes[0];
    const last = state.trackNodes[state.trackNodes.length - 1];
    const dFirst = haversineKm(first.lat, first.lng, targetLat, targetLng);
    const dLast = haversineKm(last.lat, last.lng, targetLat, targetLng);
    const attachToStart = state.trackNodes.length > 1 && dFirst < dLast;
    const distKm = attachToStart ? dFirst : dLast;

    if (distKm < 0.25) {
      return { valid: false, reason: '直前の線路点に近すぎます（250m以上離してください）' };
    }
    if (distKm > 10.0) {
      return { valid: false, reason: '1区間が長すぎます（10km以内で経由点を打ってください）' };
    }

    const tempNodes = state.trackNodes.slice();
    const dummy = { id: '__preview__', lat: targetLat, lng: targetLng };
    if (attachToStart) tempNodes.unshift(dummy);
    else tempNodes.push(dummy);

    const curves = computeRouteCurves(tempNodes);
    const newSegCurve = attachToStart ? curves[0] : curves[curves.length - 1];
    const analysis = analyzeAlignmentOnMap(newSegCurve.coords, state.buildStructure, muni.priceBase, fastPreview);

    return {
      valid: true,
      isFirst: false,
      attachToStart,
      nearEx,
      targetLat,
      targetLng,
      muni,
      cost: analysis.totalCost,
      coords: newSegCurve.coords,
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
        box.innerHTML = `<span class="text-rose-300 font-bold">⚠ ${cand.reason}</span>`;
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
        const snapTxt = cand.nearEx ? `<span class="text-amber-300 font-bold">★ ${cand.nearEx.name}駅付近</span> ・` : '';
        box.innerHTML = `${snapTxt}${cand.muni.name}から線路敷設を開始（始点設置 0億円）`;
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
      if (cand.nearEx) tags.push(`<span class="text-amber-300 font-bold">★${cand.nearEx.name}付近</span>`);
      if (a.hasRiver) tags.push(`<span class="text-sky-300">🌊河川(+${a.riverCost}億)</span>`);
      if (a.levelCrossings > 0) tags.push(`<span class="text-rose-300 font-bold">🚧幹線踏切×${a.levelCrossings}</span>`);
      else if (a.majorRoadCrossings > 0) tags.push(`<span class="text-emerald-300">✓幹線立体交差</span>`);
      if (a.roadUndergroundDiscount) tags.push(`<span class="text-emerald-300 font-bold">🛣️公道下-20%</span>`);
      if (a.structure !== 'underground' && a.buildingDensity >= 0.25) tags.push(`<span class="text-amber-300">🏘️建物密集</span>`);

      const rColor = a.minRadiusM < 250 ? 'text-rose-300' : (a.minRadiusM < 450 ? 'text-amber-300' : 'text-emerald-300');
      box.classList.remove('hidden');
      box.innerHTML = `
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <span>区間 <strong>${a.lengthKm.toFixed(2)}km</strong> ・曲線 <strong class="${rColor}">R${a.minRadiusM}m</strong> (上限${a.maxSpeedKmh}km/h)</span>
          <span class="font-extrabold ${okFunds ? 'text-amber-300' : 'text-rose-400'}">敷設費 ${cand.cost}億円</span>
        </div>
        ${tags.length ? `<div class="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">${tags.join('')}</div>` : ''}
      `;
    }
  }

  function tryAddTrackNode(lat, lng) {
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

    const { targetLat, targetLng, attachToStart, analysis } = cand;
    state.funds = Math.round((state.funds - cand.cost) * 10) / 10;
    const nodeId = 'nd_' + (Date.now() % 100000) + '_' + state.trackNodes.length;
    const prevEnd = state.trackNodes.length > 0
      ? (attachToStart ? state.trackNodes[0] : state.trackNodes[state.trackNodes.length - 1])
      : null;

    const newNode = { id: nodeId, lat: targetLat, lng: targetLng, costPaid: cand.cost };
    if (attachToStart) state.trackNodes.unshift(newNode);
    else state.trackNodes.push(newNode);

    if (prevEnd && analysis) {
      const segEntry = {
        fromId: attachToStart ? nodeId : prevEnd.id,
        toId: attachToStart ? prevEnd.id : nodeId,
        structure: state.buildStructure,
        coords: cand.coords,
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

    rebuildSegmentsGeometry();
    clearPreviewTrack();
    playSfx('build');

    if (state.trackNodes.length === 1) {
      showToast('🛤️ 線路の始点を設定！次の経由点をクリックして線路を伸ばそう');
    } else {
      const stLabel = (STRUCTURES[state.buildStructure] || STRUCTURES.surface).name;
      showToast(`🛤️ 線路を敷設（${stLabel}・${analysis.lengthKm.toFixed(1)}km・${cand.cost}億円）`);
    }

    recalculateSimulation(false);
    rebuildTrainActors();
    syncMapGeoJSON();
    syncStationMarkers();
    updateHUD();
    renderPanel();
  }

  function undoLastTrackNode() {
    if (state.trackNodes.length === 0) return;
    if (state.trackNodes.length <= 2 && state.myStations.length > 0) {
      showToast('駅が設置されているためこれ以上戻せません');
      playSfx('error');
      return;
    }
    const removed = state.trackNodes.pop();
    if (removed && removed.costPaid) {
      state.funds = Math.round((state.funds + removed.costPaid) * 10) / 10;
    }
    state.segments.pop();
    rebuildSegmentsGeometry();
    clearPreviewTrack();
    playSfx('tap');
    showToast('↩ 直前の線路ポイントを戻しました');
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
    if (state.myStations.some(s => haversineKm(s.lat, s.lng, proj.lat, proj.lng) < 0.6)) {
      return { valid: false, reason: '既存の自社駅に近すぎます（600m以上離してください）' };
    }
    const nearEx = getNearestExistingStation(proj.lat, proj.lng, 0.65);
    const muni = getNearestMunicipality(proj.lat, proj.lng);
    const cost = Math.round(16 + muni.priceBase * 0.25);
    return {
      valid: true,
      lat: proj.lat,
      lng: proj.lng,
      routeKm: proj.routeKm,
      nearEx,
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
        box.innerHTML = `<span class="text-amber-300">🚉 ${cand.reason}</span>`;
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
      const snapTxt = cand.nearEx ? `<span class="text-amber-300 font-bold">★ ${cand.nearEx.name}駅と接続可</span> ・` : '';
      box.innerHTML = `${snapTxt}${cand.muni.name}に新駅を設置 ・建設費 <strong class="${okFunds ? 'text-amber-300' : 'text-rose-400'}">${cand.cost}億円</strong>`;
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
    let newName = cand.nearEx
      ? cand.nearEx.name
      : `${cand.muni.name.replace(/[区市]/g, '')}${['北', '南', '東', '西', '中央', '台'][state.myStations.length % 6]}`;
    if (state.myStations.some(s => s.name === newName)) {
      newName = `${newName}新`;
    }

    const newStation = createStationState({
      id: newId,
      name: newName,
      lat: cand.lat,
      lng: cand.lng,
      hasPassing: false,
      existingId: cand.nearEx ? cand.nearEx.id : null,
      routeKm: cand.routeKm
    });

    state.myStations.push(newStation);
    state.myStations.sort((a, b) => a.routeKm - b.routeKm);

    state.services.forEach(sv => { sv.stops[newId] = true; });
    state.selectedStationId = newId;
    state.selectedPoint = { lat: cand.lat, lng: cand.lng, muni: cand.muni };
    clearPreviewTrack();

    playSfx('build');
    if (state.myStations.length === 1) {
      showToast(`🚉 ${newName}駅を設置！（${cand.cost}億円）あと1駅置くと開通します`);
    } else if (state.myStations.length === 2) {
      showToast(`🎉 ${newName}駅が開業し路線開通！（${cand.cost}億円）列車が走り始めます`);
    } else {
      showToast(`🚉 ${newName}駅を開業！（建設費 ${cand.cost}億円）`);
    }

    recalculateSimulation(false);
    rebuildTrainActors();
    syncMapGeoJSON();
    syncStationMarkers();
    updateHUD();
    renderPanel();
  }

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
        showToast('先に「🛤️ 線路を引く」で線路を敷設してください');
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
      showToast(`✨ ${ex.name}駅で${ex.lines[0]}との直通運転を開始！`);
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
      if (map) map.easeTo({ center: [st.lng, st.lat], zoom: Math.max(map.getZoom(), 14.2), pitch: 50, duration: 500 });
      playSfx('build');
      showToast(`${lm.icon} ${st.name}駅前に「${lm.name}」が開業！`);
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
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeTab = btn.dataset.tab;
      if (state.activeTab !== 'route') state.buildMode = null;
      playSfx('tap');
      updateHUD();
      renderPanel();
    });
  });

  // 速度・ミュート・ヘルプ
  [0, 1, 3].forEach(sp => {
    document.getElementById(`btn-speed-${sp}`).addEventListener('click', () => {
      state.speed = sp;
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      document.getElementById(`btn-speed-${sp}`).classList.add('active');
      playSfx('tap');
    });
  });

  document.getElementById('btn-mute').addEventListener('click', (e) => {
    isMuted = !isMuted;
    e.currentTarget.textContent = isMuted ? '🔇' : '🔊';
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
    if (tabName !== 'route') state.buildMode = null;
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
  document.getElementById('btn-undo-node').addEventListener('click', () => { undoLastTrackNode(); });
  document.getElementById('btn-cancel-mode').addEventListener('click', () => {
    state.buildMode = null;
    updateHUD();
    renderPanel();
  });
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
      map.easeTo({ pitch: state.is25D ? 50 : 0, bearing: state.is25D ? -14 : 0, duration: 350 });
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
    if (map) map.easeTo({ center: [139.535, 35.626], zoom: 12.1, pitch: state.is25D ? 50 : 0, bearing: state.is25D ? -14 : 0, duration: 450 });
    playSfx('tap');
  });

  // =========================================================================
  // 9. メインループ
  // =========================================================================
  let lastFrameTime = 0;
  let rafId = null;

  function gameLoop(ts) {
    if (!lastFrameTime) lastFrameTime = ts;
    const dt = Math.min(0.1, (ts - lastFrameTime) / 1000);
    lastFrameTime = ts;

    if (state.speed > 0) {
      const maxSeg = Math.max(1, state.myStations.length - 1);
      if (state.trains.length > 0) {
        state.trains.forEach(tr => {
          const step = (tr.speed / 135) * dt * state.speed;
          tr.progress += step * tr.dir;
          if (tr.progress >= maxSeg) { tr.progress = maxSeg; tr.dir = -1; }
          else if (tr.progress <= 0) { tr.progress = 0; tr.dir = 1; }
        });
        if (ts - lastTrainRenderTs >= 80) {
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
        syncMapGeoJSON();
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

  // PC向けキーボードショートカット
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
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
