// 土地区画整理・道路再編・駅前ロータリー・沿道施設配置モジュール
window.RAIL_URBAN = (() => {
  'use strict';
  function createUrbanController(ctx) {
    const {
      state, getMap, isMapReady, getCachedRoadLayers,
      LANDMARKS, ROAD_TYPES, REDEV_TOOLS, geo,
      playSfx, showToast, clearPreviewTrack,
      recalculateSimulation, syncMapGeoJSON, syncStationMarkers,
      updateHUD, renderPanel
    } = ctx;
    const {
      haversineKm, toLocalMeters, fromLocalMeters, buildTangentArc,
      makeRotatedRect, makeCirclePolygon, makeBufferPolygonAroundPolyline,
      isPointInRing, projectPointToSegmentLocal
    } = geo;

  function isInsideRedevZone(lng, lat) {
    for (let i = 0; i < state.redevZones.length; i++) {
      const z = state.redevZones[i];
      if (z.polygon && z.polygon[0] && isPointInRing(lng, lat, z.polygon[0])) return true;
    }
    for (let i = 0; i < state.rotaries.length; i++) {
      const r = state.rotaries[i];
      if (haversineKm(lat, lng, r.lat, r.lng) * 1000 < r.clearRadiusM) return true;
    }
    for (let i = 0; i < state.customRoads.length; i++) {
      const rd = state.customRoads[i];
      if (rd.clearPolygon && rd.clearPolygon[0] && isPointInRing(lng, lat, rd.clearPolygon[0])) return true;
    }
    return false;
  }

  // 最寄りの道路（1.駅前ロータリー 2.自社新設道路 3.実在OpenFreeMap道路）を検索し、
  // 沿道セットバック位置と道路平行方位角を返す
  function findNearestRoadAlignment(lng, lat, halfD_m = 16, options = {}) {
    const queryRealRoads = options.queryRealRoads !== false;
    const maxSnapDistM = options.maxSnapDistM || 62;
    let best = null;

    // 1. 駅前ロータリー外周（最優先）
    for (let i = 0; i < state.rotaries.length; i++) {
      const rot = state.rotaries[i];
      const [px, py] = toLocalMeters(lng, lat, rot.lng, rot.lat);
      const distC = Math.hypot(px, py);
      const ringDist = Math.abs(distC - rot.radiusM);
      if (distC >= rot.radiusM * 0.45 && distC <= rot.radiusM + maxSnapDistM) {
        const radial = Math.atan2(py, px);
        const tangent = radial + Math.PI / 2;
        const targetR = rot.radiusM + halfD_m + 4;
        const snapPt = fromLocalMeters(Math.cos(radial) * targetR, Math.sin(radial) * targetR, rot.lng, rot.lat);
        const cand = {
          aligned: true,
          snapLng: snapPt[0],
          snapLat: snapPt[1],
          roadPointLng: fromLocalMeters(Math.cos(radial) * rot.radiusM, Math.sin(radial) * rot.radiusM, rot.lng, rot.lat)[0],
          roadPointLat: fromLocalMeters(Math.cos(radial) * rot.radiusM, Math.sin(radial) * rot.radiusM, rot.lng, rot.lat)[1],
          angleRad: tangent,
          roadSource: 'rotary',
          distM: ringDist,
          roadHalfW: 4
        };
        if (!best || cand.distM < best.distM) best = cand;
      }
    }

    // 2. 自社新設道路・区画街路
    for (let i = 0; i < state.customRoads.length; i++) {
      const rd = state.customRoads[i];
      if (!rd.coords || rd.coords.length < 2 || rd.widthM <= 0) continue;
      // 簡易BBox枝刈り
      const p0 = rd.coords[0];
      if (Math.abs(p0[1] - lat) > 0.04 && Math.abs(rd.coords[rd.coords.length - 1][1] - lat) > 0.04) continue;
      const roadHalfW = rd.widthM * 0.5;
      for (let j = 1; j < rd.coords.length; j++) {
        const [ax, ay] = toLocalMeters(rd.coords[j - 1][0], rd.coords[j - 1][1], lng, lat);
        const [bx, by] = toLocalMeters(rd.coords[j][0], rd.coords[j][1], lng, lat);
        const proj = projectPointToSegmentLocal(0, 0, ax, ay, bx, by);
        if (proj.dist <= maxSnapDistM && (!best || proj.dist < best.distM - 3)) {
          const offsetDist = roadHalfW + halfD_m + 4;
          const nx = -Math.sin(proj.angle) * proj.side;
          const ny =  Math.cos(proj.angle) * proj.side;
          const snapPt = fromLocalMeters(proj.x + nx * offsetDist, proj.y + ny * offsetDist, lng, lat);
          const roadPt = fromLocalMeters(proj.x, proj.y, lng, lat);
          best = {
            aligned: true,
            snapLng: snapPt[0],
            snapLat: snapPt[1],
            roadPointLng: roadPt[0],
            roadPointLat: roadPt[1],
            angleRad: proj.angle,
            roadSource: 'custom',
            distM: proj.dist,
            roadHalfW
          };
        }
      }
    }

    // 3. 実在道路（OpenFreeMapベクトルタイル・区画整理で消去済みエリア外のみ）
    const map = getMap(); const mapReady = isMapReady(); const cachedRoadLayers = getCachedRoadLayers();
    if (!best && queryRealRoads && map && mapReady && cachedRoadLayers.length > 0 && !isInsideRedevZone(lng, lat)) {
      try {
        const pt = map.project([lng, lat]);
        const padPx = 28;
        const feats = map.queryRenderedFeatures(
          [[pt.x - padPx, pt.y - padPx], [pt.x + padPx, pt.y + padPx]],
          { layers: cachedRoadLayers }
        );
        for (let fi = 0; fi < feats.length; fi++) {
          const f = feats[fi];
          const cls = (f.properties && f.properties.class) || '';
          if (cls === 'rail' || cls === 'ferry' || cls === 'path') continue;
          const geom = f.geometry;
          if (!geom) continue;
          const lines = geom.type === 'LineString' ? [geom.coordinates]
            : (geom.type === 'MultiLineString' ? geom.coordinates : []);
          const roadHalfW = ['motorway', 'trunk', 'primary'].includes(cls) ? 10
            : (cls === 'secondary' ? 7.5 : (cls === 'tertiary' ? 6 : 4.5));
          for (let li = 0; li < lines.length; li++) {
            const coords = lines[li];
            for (let j = 1; j < coords.length; j++) {
              const [ax, ay] = toLocalMeters(coords[j - 1][0], coords[j - 1][1], lng, lat);
              const [bx, by] = toLocalMeters(coords[j][0], coords[j][1], lng, lat);
              const segLen = Math.hypot(bx - ax, by - ay);
              if (segLen < 4) continue;
              const proj = projectPointToSegmentLocal(0, 0, ax, ay, bx, by);
              if (proj.dist <= maxSnapDistM && (!best || proj.dist < best.distM)) {
                const offsetDist = roadHalfW + halfD_m + 3.5;
                const nx = -Math.sin(proj.angle) * proj.side;
                const ny =  Math.cos(proj.angle) * proj.side;
                const snapPt = fromLocalMeters(proj.x + nx * offsetDist, proj.y + ny * offsetDist, lng, lat);
                const roadPt = fromLocalMeters(proj.x, proj.y, lng, lat);
                best = {
                  aligned: true,
                  snapLng: snapPt[0],
                  snapLat: snapPt[1],
                  roadPointLng: roadPt[0],
                  roadPointLat: roadPt[1],
                  angleRad: proj.angle,
                  roadSource: 'real',
                  distM: proj.dist,
                  roadHalfW,
                  roadClass: cls
                };
              }
            }
          }
        }
      } catch (_) {}
    }

    if (best) return best;
    return {
      aligned: false,
      snapLng: lng,
      snapLat: lat,
      roadPointLng: lng,
      roadPointLat: lat,
      angleRad: (state.devAngleDeg || 0) * Math.PI / 180,
      roadSource: 'free',
      distM: 999,
      roadHalfW: 0
    };
  }


  // =========================================================================
  // 8b. 土地区画整理・道路再編・駅前ロータリー・沿道施設配置
  // =========================================================================
  function snapRoadEndpoint(lng, lat) {
    let best = null;
    for (let i = 0; i < state.rotaries.length; i++) {
      const rot = state.rotaries[i];
      const [px, py] = toLocalMeters(lng, lat, rot.lng, rot.lat);
      const distC = Math.hypot(px, py);
      if (Math.abs(distC - rot.radiusM) <= 18) {
        const a = Math.atan2(py, px);
        const pt = fromLocalMeters(Math.cos(a) * rot.radiusM, Math.sin(a) * rot.radiusM, rot.lng, rot.lat);
        best = { lng: pt[0], lat: pt[1], snapped: true, label: 'ロータリー接続' };
        break;
      }
    }
    if (!best) {
      for (let i = 0; i < state.customRoads.length; i++) {
        const rd = state.customRoads[i];
        if (!rd.coords || rd.coords.length < 2 || rd.widthM <= 0) continue;
        const ends = [rd.coords[0], rd.coords[rd.coords.length - 1]];
        for (let k = 0; k < ends.length; k++) {
          const dm = haversineKm(lat, lng, ends[k][1], ends[k][0]) * 1000;
          if (dm <= 25) {
            best = { lng: ends[k][0], lat: ends[k][1], snapped: true, label: '既存新設道路に接続' };
            break;
          }
        }
        if (best) break;
      }
    }
    return best || { lng, lat, snapped: false, label: '' };
  }

  function buildCandidateRoadSegment(lat, lng) {
    const rt = ROAD_TYPES[state.roadType] || ROAD_TYPES.avenue;
    const sn = snapRoadEndpoint(lng, lat);
    if (state.activeRoadNodes.length === 0) {
      return {
        valid: true,
        isFirst: true,
        lng: sn.lng,
        lat: sn.lat,
        snappedLabel: sn.label,
        rt,
        cost: 0
      };
    }
    const prev = state.activeRoadNodes[state.activeRoadNodes.length - 1];
    const distKm = haversineKm(prev.lat, prev.lng, sn.lat, sn.lng);
    if (distKm < 0.012) {
      return { valid: false, reason: '直前の道路地点と近すぎます（15m以上離してください）' };
    }
    let coords = [[prev.lng, prev.lat], [sn.lng, sn.lat]];
    if (state.activeRoadNodes.length >= 2) {
      const pPrev = state.activeRoadNodes[state.activeRoadNodes.length - 2];
      const [vx, vy] = toLocalMeters(prev.lng, prev.lat, pPrev.lng, pPrev.lat);
      const vLen = Math.hypot(vx, vy) || 1;
      const t0 = [vx / vLen, vy / vLen];
      const arc = buildTangentArc(prev.lng, prev.lat, t0, sn.lng, sn.lat);
      if (!arc.invalid && arc.coords) {
        coords = arc.coords;
      }
    }
    let lengthKm = 0;
    for (let i = 1; i < coords.length; i++) {
      lengthKm += haversineKm(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    }
    const clearPoly = makeBufferPolygonAroundPolyline(coords, rt.clearHalfM);
    const cost = Math.max(0.5, Math.round((rt.baseCost * 0.4 + lengthKm * rt.costPerKm) * 10) / 10);
    return {
      valid: true,
      isFirst: false,
      lng: sn.lng,
      lat: sn.lat,
      snappedLabel: sn.label,
      coords,
      clearPoly,
      lengthKm,
      rt,
      cost
    };
  }

  function updateRoadHoverPreview(lat, lng) {
    const box = document.getElementById('align-preview-box');
    const cand = buildCandidateRoadSegment(lat, lng);
    state.hoverPreview = cand;
    const feats = [];
    if (!cand.valid) {
      if (getMap() && isMapReady() && getMap().getSource('preview-dev')) {
        getMap().getSource('preview-dev').setData({ type: 'FeatureCollection', features: [] });
      }
      if (box) {
        box.classList.remove('hidden');
        box.innerHTML = `<span class="text-amber-300">${cand.reason}</span>`;
      }
      return;
    }
    if (cand.isFirst) {
      feats.push({
        type: 'Feature',
        properties: { color: '#38bdf8' },
        geometry: { type: 'Point', coordinates: [cand.lng, cand.lat] }
      });
      if (box) {
        box.classList.remove('hidden');
        box.innerHTML = `${cand.snappedLabel ? `<span class="text-emerald-300 font-bold">[${cand.snappedLabel}]</span> ` : ''}クリックで「${cand.rt.name}」の始点を配置`;
      }
    } else {
      const okFunds = state.funds >= cand.cost;
      if (cand.clearPoly) {
        feats.push({
          type: 'Feature',
          properties: { color: '#cbd5e1', opacity: 0.42, stroke: '#64748b' },
          geometry: { type: 'Polygon', coordinates: cand.clearPoly }
        });
      }
      if (cand.rt.widthM > 0) {
        feats.push({
          type: 'Feature',
          properties: { color: okFunds ? '#38bdf8' : '#f43f5e', width: cand.rt.id === 'avenue' ? 4.5 : 2.8 },
          geometry: { type: 'LineString', coordinates: cand.coords }
        });
      }
      feats.push({
        type: 'Feature',
        properties: { color: okFunds ? '#38bdf8' : '#f43f5e' },
        geometry: { type: 'Point', coordinates: [cand.lng, cand.lat] }
      });
      if (box) {
        box.classList.remove('hidden');
        box.innerHTML = `${cand.rt.name} ${Math.round(cand.lengthKm * 1000)}m${cand.snappedLabel ? ` (${cand.snappedLabel})` : ''} ・区画整理費 <strong class="${okFunds ? 'text-amber-300' : 'text-rose-400'}">${cand.cost}億円</strong>`;
      }
    }
    if (getMap() && isMapReady() && getMap().getSource('preview-dev')) {
      getMap().getSource('preview-dev').setData({ type: 'FeatureCollection', features: feats });
    }
  }

  function tryAddRoadNode(lat, lng) {
    const cand = buildCandidateRoadSegment(lat, lng);
    if (!cand.valid) {
      showToast(cand.reason);
      playSfx('error');
      return;
    }
    if (cand.isFirst) {
      const chainId = 'rc_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
      state.activeRoadChainId = chainId;
      state.activeRoadNodes = [{ lng: cand.lng, lat: cand.lat }];
      state.undoStack.push({ type: 'road', chainId, roadId: null, wasFirstNode: true, costPaid: 0 });
      playSfx('tap');
      showToast(`${cand.rt.name}の始点を配置。次の地点をクリックして延伸してください`);
      updateHUD();
      return;
    }
    if (state.funds < cand.cost) {
      showToast(`資金不足です（必要: ${cand.cost}億円）`);
      playSfx('error');
      return;
    }
    state.funds = Math.round((state.funds - cand.cost) * 10) / 10;
    const roadId = 'rd_' + Date.now() + '_' + state.customRoads.length;
    state.customRoads.push({
      id: roadId,
      chainId: state.activeRoadChainId,
      roadType: cand.rt.id,
      coords: cand.coords,
      widthM: cand.rt.widthM,
      clearHalfM: cand.rt.clearHalfM,
      clearPolygon: cand.clearPoly,
      lengthKm: cand.lengthKm,
      costPaid: cand.cost
    });
    state.activeRoadNodes.push({ lng: cand.lng, lat: cand.lat });
    state.undoStack.push({ type: 'road', chainId: state.activeRoadChainId, roadId, wasFirstNode: false, costPaid: cand.cost });
    playSfx('build');
    showToast(`${cand.rt.name}を敷設・沿道整地（${Math.round(cand.lengthKm * 1000)}m / ${cand.cost}億円）`);
    clearPreviewTrack();
    syncMapGeoJSON({ tracks: false });
    updateHUD();
    renderPanel();
  }

  function updateRotaryHoverPreview(lat, lng) {
    const box = document.getElementById('align-preview-box');
    const rt = REDEV_TOOLS.rotary;
    state.hoverPreview = { valid: true, lat, lng, cost: rt.cost };
    const okFunds = state.funds >= rt.cost;
    const feats = [
      {
        type: 'Feature',
        properties: { color: '#cbd5e1', opacity: 0.35, stroke: '#94a3b8' },
        geometry: { type: 'Polygon', coordinates: makeCirclePolygon(lng, lat, rt.clearRadiusM, 28) }
      },
      {
        type: 'Feature',
        properties: { color: okFunds ? '#38bdf8' : '#f43f5e', opacity: 0.45, stroke: okFunds ? '#0284c7' : '#e11d48' },
        geometry: { type: 'Polygon', coordinates: makeCirclePolygon(lng, lat, rt.radiusM, 28) }
      },
      {
        type: 'Feature',
        properties: { color: '#22c55e', opacity: 0.65, stroke: '#16a34a' },
        geometry: { type: 'Polygon', coordinates: makeCirclePolygon(lng, lat, rt.radiusM * 0.42, 20) }
      }
    ];
    if (getMap() && isMapReady() && getMap().getSource('preview-dev')) {
      getMap().getSource('preview-dev').setData({ type: 'FeatureCollection', features: feats });
    }
    let nearSt = null, bestD = 0.30;
    state.myStations.forEach(st => {
      const d = haversineKm(lat, lng, st.lat, st.lng);
      if (d < bestD) { bestD = d; nearSt = st; }
    });
    if (box) {
      box.classList.remove('hidden');
      box.innerHTML = `${nearSt ? `<span class="text-emerald-300 font-bold">${nearSt.name}駅前</span> ・ ` : ''}駅前ロータリー整備（外周に施設を円形配置可） ・費用 <strong class="${okFunds ? 'text-amber-300' : 'text-rose-400'}">${rt.cost}億円</strong>`;
    }
  }

  function tryPlaceRotary(lat, lng) {
    const rt = REDEV_TOOLS.rotary;
    if (state.funds < rt.cost) {
      showToast(`資金不足です（必要: ${rt.cost}億円）`);
      playSfx('error');
      return;
    }
    state.funds = Math.round((state.funds - rt.cost) * 10) / 10;
    const rotaryId = 'rot_' + Date.now() + '_' + state.rotaries.length;
    const clearPoly = makeCirclePolygon(lng, lat, rt.clearRadiusM, 28);

    const approachRoadIds = [];
    const nearRoad = findNearestRoadAlignment(lng, lat, 0, { queryRealRoads: true, maxSnapDistM: 100 });
    if (nearRoad && nearRoad.aligned && nearRoad.roadSource !== 'rotary') {
      const [tx, ty] = toLocalMeters(nearRoad.roadPointLng, nearRoad.roadPointLat, lng, lat);
      const distT = Math.hypot(tx, ty);
      if (distT > rt.radiusM + 4) {
        const ang = Math.atan2(ty, tx);
        const startPt = fromLocalMeters(Math.cos(ang) * (rt.radiusM - 2), Math.sin(ang) * (rt.radiusM - 2), lng, lat);
        const endPt = [nearRoad.roadPointLng, nearRoad.roadPointLat];
        const apCoords = [startPt, endPt];
        const apId = 'rd_ap_' + Date.now() + '_' + state.customRoads.length;
        state.customRoads.push({
          id: apId,
          chainId: rotaryId,
          roadType: 'avenue',
          coords: apCoords,
          widthM: ROAD_TYPES.avenue.widthM,
          clearHalfM: ROAD_TYPES.avenue.clearHalfM,
          clearPolygon: makeBufferPolygonAroundPolyline(apCoords, ROAD_TYPES.avenue.clearHalfM),
          lengthKm: distT / 1000,
          costPaid: 0
        });
        approachRoadIds.push(apId);
      }
    }

    let nearSt = null, bestD = 0.30;
    state.myStations.forEach(st => {
      const d = haversineKm(lat, lng, st.lat, st.lng);
      if (d < bestD) { bestD = d; nearSt = st; }
    });

    state.rotaries.push({
      id: rotaryId,
      lat,
      lng,
      radiusM: rt.radiusM,
      clearRadiusM: rt.clearRadiusM,
      stationId: nearSt ? nearSt.id : null,
      clearPolygon: clearPoly,
      approachRoadIds,
      costPaid: rt.cost
    });
    state.undoStack.push({ type: 'rotary', rotaryId, costPaid: rt.cost });
    playSfx('build');
    showToast(`${nearSt ? nearSt.name + '駅前に' : ''}ロータリーを整備しました（${rt.cost}億円${approachRoadIds.length > 0 ? '・既存道路と接続' : ''}）`);
    clearPreviewTrack();
    recalculateSimulation(false);
    syncMapGeoJSON({ tracks: false });
    updateHUD();
    renderPanel();
  }

  function getGridBlockPreviewData(lat, lng) {
    const tool = REDEV_TOOLS.grid_block;
    const hw = tool.widthM * 0.5;
    const hh = tool.heightM * 0.5;
    const a = (state.devAngleDeg || 0) * Math.PI / 180;
    const cosA = Math.cos(a), sinA = Math.sin(a);
    const toGeo = (lx, ly) => fromLocalMeters(lx * cosA - ly * sinA, lx * sinA + ly * cosA, lng, lat);
    const zonePoly = makeRotatedRect(lng, lat, hw, hh, a);
    const mainRoad = [toGeo(-hw, 0), toGeo(hw, 0)];
    const crossRoad1 = [toGeo(-hw * 0.45, -hh), toGeo(-hw * 0.45, hh)];
    const crossRoad2 = [toGeo( hw * 0.45, -hh), toGeo( hw * 0.45, hh)];
    return { zonePoly, mainRoad, crossRoad1, crossRoad2, cost: tool.cost };
  }

  function updateRedevHoverPreview(lat, lng) {
    const box = document.getElementById('align-preview-box');
    const feats = [];
    state.hoverPreview = { valid: true, lat, lng };
    if (state.redevTool === 'grid_block') {
      const g = getGridBlockPreviewData(lat, lng);
      const okFunds = state.funds >= g.cost;
      feats.push({
        type: 'Feature',
        properties: { color: '#cbd5e1', opacity: 0.45, stroke: okFunds ? '#0ea5e9' : '#f43f5e' },
        geometry: { type: 'Polygon', coordinates: g.zonePoly }
      });
      feats.push({
        type: 'Feature',
        properties: { color: okFunds ? '#38bdf8' : '#f43f5e', width: 4.5 },
        geometry: { type: 'LineString', coordinates: g.mainRoad }
      });
      [g.crossRoad1, g.crossRoad2].forEach(cr => {
        feats.push({
          type: 'Feature',
          properties: { color: okFunds ? '#94a3b8' : '#f43f5e', width: 2.5 },
          geometry: { type: 'LineString', coordinates: cr }
        });
      });
      if (box) {
        box.classList.remove('hidden');
        box.innerHTML = `区画整理グリッド街区（${REDEV_TOOLS.grid_block.widthM}×${REDEV_TOOLS.grid_block.heightM}m・大通り＋直交街路を新設） ・費用 <strong class="${okFunds ? 'text-amber-300' : 'text-rose-400'}">${g.cost}億円</strong>`;
      }
    } else {
      const tool = REDEV_TOOLS.clear_lot;
      const okFunds = state.funds >= tool.cost;
      feats.push({
        type: 'Feature',
        properties: { color: okFunds ? '#cbd5e1' : '#f43f5e', opacity: 0.5, stroke: okFunds ? '#64748b' : '#e11d48' },
        geometry: { type: 'Polygon', coordinates: makeCirclePolygon(lng, lat, tool.radiusM, 28) }
      });
      if (box) {
        box.classList.remove('hidden');
        box.innerHTML = `区画更地化（半径${tool.radiusM}mの既存道路・建物を消去） ・費用 <strong class="${okFunds ? 'text-amber-300' : 'text-rose-400'}">${tool.cost}億円</strong>`;
      }
    }
    if (getMap() && isMapReady() && getMap().getSource('preview-dev')) {
      getMap().getSource('preview-dev').setData({ type: 'FeatureCollection', features: feats });
    }
  }

  function tryPlaceRedevBlock(lat, lng) {
    if (state.redevTool === 'grid_block') {
      const g = getGridBlockPreviewData(lat, lng);
      if (state.funds < g.cost) {
        showToast(`資金不足です（必要: ${g.cost}億円）`);
        playSfx('error');
        return;
      }
      state.funds = Math.round((state.funds - g.cost) * 10) / 10;
      const zoneId = 'rz_' + Date.now() + '_' + state.redevZones.length;
      state.redevZones.push({ id: zoneId, type: 'grid_block', polygon: g.zonePoly, centerLng: lng, centerLat: lat, costPaid: g.cost });
      const roadIds = [];
      const addRd = (coords, roadType, widthM) => {
        const rid = 'rd_gr_' + Date.now() + '_' + state.customRoads.length + '_' + roadIds.length;
        state.customRoads.push({
          id: rid,
          chainId: zoneId,
          roadType,
          coords,
          widthM,
          clearHalfM: 0,
          clearPolygon: null,
          lengthKm: haversineKm(coords[0][1], coords[0][0], coords[1][1], coords[1][0]),
          costPaid: 0
        });
        roadIds.push(rid);
      };
      addRd(g.mainRoad, 'avenue', ROAD_TYPES.avenue.widthM);
      addRd(g.crossRoad1, 'street', ROAD_TYPES.street.widthM);
      addRd(g.crossRoad2, 'street', ROAD_TYPES.street.widthM);
      state.undoStack.push({ type: 'redev', zoneId, roadIds, costPaid: g.cost });
      playSfx('build');
      showToast(`区画整理グリッド街区を整備しました（${g.cost}億円）。新設街路に沿って施設を建てられます`);
    } else {
      const tool = REDEV_TOOLS.clear_lot;
      if (state.funds < tool.cost) {
        showToast(`資金不足です（必要: ${tool.cost}億円）`);
        playSfx('error');
        return;
      }
      state.funds = Math.round((state.funds - tool.cost) * 10) / 10;
      const zoneId = 'rz_' + Date.now() + '_' + state.redevZones.length;
      state.redevZones.push({
        id: zoneId,
        type: 'clear_lot',
        polygon: makeCirclePolygon(lng, lat, tool.radiusM, 28),
        centerLng: lng,
        centerLat: lat,
        costPaid: tool.cost
      });
      state.undoStack.push({ type: 'redev', zoneId, roadIds: [], costPaid: tool.cost });
      playSfx('build');
      showToast(`半径${tool.radiusM}mを更地化しました（${tool.cost}億円）`);
    }
    clearPreviewTrack();
    syncMapGeoJSON({ tracks: false });
    updateHUD();
    renderPanel();
  }

  function buildCandidateDevelopment(lat, lng, queryRealRoads = true) {
    const lm = LANDMARKS.find(l => l.id === state.selectedLandmarkId) || LANDMARKS[0];
    const halfD = (lm.d || 34) * 0.5;
    let align = {
      aligned: false,
      snapLng: lng,
      snapLat: lat,
      roadPointLng: lng,
      roadPointLat: lat,
      angleRad: (state.devAngleDeg || 0) * Math.PI / 180,
      roadSource: 'free',
      distM: 999
    };
    if (state.devRoadSnap) {
      align = findNearestRoadAlignment(lng, lat, halfD, { queryRealRoads, maxSnapDistM: 64 });
      if (align.aligned && state.devAngleDeg !== 0) {
        align.angleRad += (state.devAngleDeg * Math.PI / 180);
      }
    }
    const cost = align.aligned ? lm.cost : Math.round(lm.cost * 1.25);
    let nearSt = null, bestD = 1.25;
    state.myStations.forEach(st => {
      const d = haversineKm(align.snapLat, align.snapLng, st.lat, st.lng);
      if (d < bestD) { bestD = d; nearSt = st; }
    });
    return {
      lm,
      lng: align.snapLng,
      lat: align.snapLat,
      roadPointLng: align.roadPointLng,
      roadPointLat: align.roadPointLat,
      angleRad: align.angleRad,
      roadAligned: align.aligned,
      roadSource: align.roadSource,
      cost,
      nearSt
    };
  }

  function updateLandmarkHoverPreview(lat, lng) {
    const box = document.getElementById('align-preview-box');
    const cand = buildCandidateDevelopment(lat, lng, true);
    state.hoverPreview = cand;
    const okFunds = state.funds >= cand.cost;
    const hw = (cand.lm.w || 60) * 0.5;
    const hd = (cand.lm.d || 34) * 0.5;
    const feats = [
      {
        type: 'Feature',
        properties: { color: okFunds ? cand.lm.color : '#f43f5e', opacity: 0.45, stroke: okFunds ? '#ffffff' : '#e11d48' },
        geometry: { type: 'Polygon', coordinates: makeRotatedRect(cand.lng, cand.lat, hw, hd, cand.angleRad) }
      }
    ];
    if (cand.roadAligned) {
      feats.push({
        type: 'Feature',
        properties: { color: cand.roadSource === 'rotary' ? '#f59e0b' : '#10b981', width: 3 },
        geometry: { type: 'LineString', coordinates: [[cand.roadPointLng, cand.roadPointLat], [cand.lng, cand.lat]] }
      });
    }
    if (getMap() && isMapReady() && getMap().getSource('preview-dev')) {
      getMap().getSource('preview-dev').setData({ type: 'FeatureCollection', features: feats });
    }
    if (box) {
      box.classList.remove('hidden');
      const roadTag = cand.roadSource === 'rotary'
        ? '<span class="text-amber-300 font-bold">[ロータリー直結 +15%]</span>'
        : (cand.roadSource === 'custom'
          ? '<span class="text-emerald-300 font-bold">[新設道路に整列]</span>'
          : (cand.roadSource === 'real'
            ? '<span class="text-sky-300 font-bold">[実在道路に整列]</span>'
            : '<span class="text-rose-300 font-bold">[接道なし: 費用+25%・収益-20%]</span>'));
      const stTag = cand.nearSt ? ` ・${cand.nearSt.name}駅圏` : ' ・駅圏外（収益半減）';
      box.innerHTML = `${roadTag} ${cand.lm.name}${stTag} ・建設費 <strong class="${okFunds ? 'text-amber-300' : 'text-rose-400'}">${cand.cost}億円</strong>`;
    }
  }

  function tryPlaceDevelopment(lat, lng) {
    const cand = buildCandidateDevelopment(lat, lng, true);
    if (state.funds < cand.cost) {
      showToast(`資金不足です（必要: ${cand.cost}億円）`);
      playSfx('error');
      return;
    }
    state.funds = Math.round((state.funds - cand.cost) * 10) / 10;
    const devId = 'dev_' + Date.now() + '_' + state.developments.length;
    const dev = {
      id: devId,
      landmarkId: cand.lm.id,
      stationId: cand.nearSt ? cand.nearSt.id : null,
      lat: cand.lat,
      lng: cand.lng,
      angleRad: cand.angleRad,
      roadAligned: cand.roadAligned,
      roadSource: cand.roadSource,
      costPaid: cand.cost,
      // 着工してから完成するまでの月数。完成した月に住民・商業の効果が出る
      buildLeft: cand.lm.buildMonths || 4,
      buildTotal: cand.lm.buildMonths || 4,
      popAdded: 0,
      commAdded: 0
    };
    state.developments.push(dev);

    state.undoStack.push({ type: 'development', devId, costPaid: cand.cost });
    playSfx('build');
    const srcLabel = cand.roadSource === 'rotary' ? 'ロータリー沿い' : (cand.roadSource === 'custom' ? '新設道路沿い' : (cand.roadSource === 'real' ? '実在道路沿い' : '自由配置'));
    showToast(`「${cand.lm.name}」を${srcLabel}に着工（${cand.cost}億円・${dev.buildTotal}か月で完成）`);
    clearPreviewTrack();
    recalculateSimulation(false);
    syncMapGeoJSON({ tracks: false });
    syncStationMarkers();
    updateHUD();
    renderPanel();
  }


    return {
      isInsideRedevZone,
      findNearestRoadAlignment,
      snapRoadEndpoint,
      buildCandidateRoadSegment,
      updateRoadHoverPreview,
      tryAddRoadNode,
      updateRotaryHoverPreview,
      tryPlaceRotary,
      getGridBlockPreviewData,
      updateRedevHoverPreview,
      tryPlaceRedevBlock,
      buildCandidateDevelopment,
      updateLandmarkHoverPreview,
      tryPlaceDevelopment
    };
  }
  return { createUrbanController };
})();
