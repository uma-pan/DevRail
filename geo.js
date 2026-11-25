// 地理・幾何・回転ポリゴン・建築シルエット生成ユーティリティ
window.RAIL_GEO = (() => {
  'use strict';
  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
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
    const area2 = Math.abs(x0 * y2 - y0 * x2); // 2 * triangle area
    if (area2 < 1e-3 || a < 1 || b < 1 || c < 1) return 9999;
    return (a * b * c) / (2 * area2);
  }

  // Train World方式：既存区間の接線に連続する定半径円弧／直線セグメントを生成（既存区間は一切変形しない）
  function buildTangentArc(p0Lng, p0Lat, t0, p1Lng, p1Lat) {
    const mLat = 111320;
    const mLng = 111320 * Math.cos(p0Lat * Math.PI / 180);
    const vx = (p1Lng - p0Lng) * mLng;
    const vy = (p1Lat - p0Lat) * mLat;
    const dist = Math.hypot(vx, vy);
    if (dist < 1) return { invalid: true, reason: '同じ地点が選択されています' };
    const ux = vx / dist, uy = vy / dist;
    const SAMPLES = Math.max(4, Math.min(18, Math.ceil(dist / 90)));

    if (!t0) {
      const coords = [];
      for (let i = 0; i <= SAMPLES; i++) {
        const f = i / SAMPLES;
        coords.push([p0Lng + (vx * f) / mLng, p0Lat + (vy * f) / mLat]);
      }
      return { coords, lengthKm: dist / 1000, minRadiusM: 2000, startDir: [ux, uy], endDir: [ux, uy] };
    }

    const tx = t0[0], ty = t0[1];
    const dot = Math.max(-1, Math.min(1, tx * ux + ty * uy));
    const cross = tx * uy - ty * ux;
    const alpha = Math.atan2(cross, dot);
    const absAlpha = Math.abs(alpha);

    if (absAlpha > Math.PI * 0.62) {
      return { invalid: true, reason: '折り返し角度が急すぎます（進行方向寄りに指定してください）' };
    }
    if (absAlpha < 0.04) {
      const coords = [];
      for (let i = 0; i <= SAMPLES; i++) {
        const f = i / SAMPLES;
        coords.push([p0Lng + (vx * f) / mLng, p0Lat + (vy * f) / mLat]);
      }
      return { coords, lengthKm: dist / 1000, minRadiusM: 2000, startDir: [ux, uy], endDir: [ux, uy] };
    }

    const sinA = Math.sin(absAlpha);
    const R = dist / (2 * sinA);
    if (R < 40) {
      return { invalid: true, reason: `曲線半径が急すぎます（R${Math.round(R)}m / 最小R40m）` };
    }

    const sign = cross >= 0 ? 1 : -1;
    const nx = -ty * sign;
    const ny = tx * sign;
    const cx = nx * R;
    const cy = ny * R;
    const startAngle = Math.atan2(-cy, -cx);
    const sweep = 2 * absAlpha * sign;

    const coords = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const ang = startAngle + sweep * (i / SAMPLES);
      const x = cx + Math.cos(ang) * R;
      const y = cy + Math.sin(ang) * R;
      coords.push([p0Lng + x / mLng, p0Lat + y / mLat]);
    }
    const endAngle = startAngle + sweep;
    const ex = -Math.sin(endAngle) * sign;
    const ey = Math.cos(endAngle) * sign;
    const eLen = Math.hypot(ex, ey) || 1;

    return {
      coords,
      lengthKm: (R * 2 * absAlpha) / 1000,
      minRadiusM: Math.round(Math.min(2000, R)),
      startDir: [tx, ty],
      endDir: [ex / eLen, ey / eLen]
    };
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

  // 道路方位角 angleRad（東=0, 北=π/2）に合わせて回転した矩形ポリゴンを生成
  // localOffsetX_m: 道路平行方向、localOffsetY_m: 道路垂直方向（左側が正）
  function makeRotatedRect(lng, lat, halfW_m, halfD_m, angleRad, localOffsetX_m = 0, localOffsetY_m = 0) {
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const corners = [
      [-halfW_m, -halfD_m],
      [ halfW_m, -halfD_m],
      [ halfW_m,  halfD_m],
      [-halfW_m,  halfD_m],
      [-halfW_m, -halfD_m]
    ];
    const ring = corners.map(([lx, ly]) => {
      const rx = lx + localOffsetX_m;
      const ry = ly + localOffsetY_m;
      const mx = rx * cosA - ry * sinA;
      const my = rx * sinA + ry * cosA;
      return fromLocalMeters(mx, my, lng, lat);
    });
    return [ring];
  }

  function makeCirclePolygon(lng, lat, radiusM, segments = 28) {
    const ring = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      ring.push(fromLocalMeters(Math.cos(a) * radiusM, Math.sin(a) * radiusM, lng, lat));
    }
    return [ring];
  }

  function makeEllipsePolygon(lng, lat, rxM, ryM, angleRad, segments = 24, localOffsetX_m = 0, localOffsetY_m = 0) {
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const ring = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const rx = Math.cos(a) * rxM + localOffsetX_m;
      const ry = Math.sin(a) * ryM + localOffsetY_m;
      const mx = rx * cosA - ry * sinA;
      const my = rx * sinA + ry * cosA;
      ring.push(fromLocalMeters(mx, my, lng, lat));
    }
    return [ring];
  }

  // ポリラインの左右 halfWidthM を覆う帯状の区画整理（整地）ポリゴンを生成
  function makeBufferPolygonAroundPolyline(coords, halfWidthM) {
    if (!coords || coords.length < 2 || halfWidthM <= 0) return null;
    const refLng = coords[0][0];
    const refLat = coords[0][1];
    const pts = coords.map(c => {
      const [x, y] = toLocalMeters(c[0], c[1], refLng, refLat);
      return { x, y };
    });
    const leftSide = [];
    const rightSide = [];
    for (let i = 0; i < pts.length; i++) {
      let dx = 0, dy = 0;
      if (i === 0) {
        dx = pts[1].x - pts[0].x;
        dy = pts[1].y - pts[0].y;
      } else if (i === pts.length - 1) {
        dx = pts[i].x - pts[i - 1].x;
        dy = pts[i].y - pts[i - 1].y;
      } else {
        const dx1 = pts[i].x - pts[i - 1].x, dy1 = pts[i].y - pts[i - 1].y;
        const l1 = Math.hypot(dx1, dy1) || 1;
        const dx2 = pts[i + 1].x - pts[i].x, dy2 = pts[i + 1].y - pts[i].y;
        const l2 = Math.hypot(dx2, dy2) || 1;
        dx = dx1 / l1 + dx2 / l2;
        dy = dy1 / l1 + dy2 / l2;
      }
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      leftSide.push(fromLocalMeters(pts[i].x + nx * halfWidthM, pts[i].y + ny * halfWidthM, refLng, refLat));
      rightSide.push(fromLocalMeters(pts[i].x - nx * halfWidthM, pts[i].y - ny * halfWidthM, refLng, refLat));
    }
    const p0 = pts[0], p1 = pts[1];
    const aStart = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const startCap = [];
    for (let k = 1; k <= 5; k++) {
      const a = aStart + Math.PI / 2 + (Math.PI * k) / 6;
      startCap.push(fromLocalMeters(p0.x + Math.cos(a) * halfWidthM, p0.y + Math.sin(a) * halfWidthM, refLng, refLat));
    }
    const pn = pts[pts.length - 1], pn1 = pts[pts.length - 2];
    const aEnd = Math.atan2(pn.y - pn1.y, pn.x - pn1.x);
    const endCap = [];
    for (let k = 1; k <= 5; k++) {
      const a = aEnd + Math.PI / 2 - (Math.PI * k) / 6;
      endCap.push(fromLocalMeters(pn.x + Math.cos(a) * halfWidthM, pn.y + Math.sin(a) * halfWidthM, refLng, refLat));
    }
    const ring = [...leftSide, ...endCap, ...rightSide.reverse(), ...startCap];
    ring.push(ring[0]);
    return [ring];
  }

  function isPointInRing(lng, lat, ring) {
    if (!ring || ring.length < 4) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function projectPointToSegmentLocal(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-4) {
      return { x: ax, y: ay, dist: Math.hypot(px - ax, py - ay), angle: 0, side: 1 };
    }
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const dist = Math.hypot(px - cx, py - cy);
    const cross = dx * (py - ay) - dy * (px - ax);
    return { x: cx, y: cy, dist, angle: Math.atan2(dy, dx), side: cross >= 0 ? 1 : -1 };
  }

  // 沿道施設の建築シルエット（複数棟3Dポリゴン＋敷地舗装）を道路方位に合わせて生成
  function buildDevelopmentFeatures(dev, lm, devLevelBoost = 0) {
    const w = (lm.w || 60) * 0.5;
    const d = (lm.d || 34) * 0.5;
    const baseH = Math.round((lm.h || 60) + devLevelBoost * 0.35);
    const a = dev.angleRad || 0;
    const lng = dev.lng;
    const lat = dev.lat;
    const col = lm.color || '#0ea5e9';
    const buildings = [];

    const lotPoly = makeRotatedRect(lng, lat, w + 4, d + 4, a);
    const lotFeature = {
      type: 'Feature',
      properties: { id: dev.id, color: '#cbd5e1' },
      geometry: { type: 'Polygon', coordinates: lotPoly }
    };

    const pushBox = (hw, hd, h, ox, oy, color) => {
      buildings.push({
        type: 'Feature',
        properties: { color: color || col, height: h },
        geometry: { type: 'Polygon', coordinates: makeRotatedRect(lng, lat, hw, hd, a, ox, oy) }
      });
    };

    if (lm.shape === 'podium_tower') {
      pushBox(w, d, Math.round(baseH * 0.28), 0, 0, '#38bdf8');
      pushBox(w * 0.58, d * 0.62, baseH, -w * 0.14, 0, col);
      pushBox(w * 0.26, d * 0.52, Math.round(baseH * 0.65), w * 0.45, 0, '#0284c7');
    } else if (lm.shape === 'twin_tower') {
      pushBox(w, d * 0.48, 16, 0, -d * 0.32, '#94a3b8');
      pushBox(w * 0.34, d * 0.68, baseH, -w * 0.46, d * 0.1, col);
      pushBox(w * 0.34, d * 0.68, Math.round(baseH * 0.88), w * 0.46, d * 0.1, '#d97706');
    } else if (lm.shape === 'strip_mall') {
      pushBox(w * 0.46, d * 0.85, baseH, -w * 0.5, 0, col);
      pushBox(w * 0.46, d * 0.85, Math.round(baseH * 0.82), w * 0.5, 0, '#0284c7');
    } else if (lm.shape === 'mansion_row') {
      pushBox(w * 0.30, d * 0.78, baseH, -w * 0.64, 0, col);
      pushBox(w * 0.30, d * 0.78, Math.round(baseH * 1.08), 0, 0, '#f59e0b');
      pushBox(w * 0.30, d * 0.78, Math.round(baseH * 0.92), w * 0.64, 0, col);
    } else if (lm.shape === 'campus') {
      pushBox(w * 0.92, d * 0.26, baseH, 0, d * 0.62, col);
      pushBox(w * 0.24, d * 0.72, Math.round(baseH * 0.85), -w * 0.68, -d * 0.1, '#9333ea');
      pushBox(w * 0.24, d * 0.72, Math.round(baseH * 0.78), w * 0.68, -d * 0.1, '#9333ea');
    } else if (lm.shape === 'outlet') {
      pushBox(w * 0.94, d * 0.30, baseH, 0, d * 0.56, col);
      pushBox(w * 0.32, d * 0.48, Math.round(baseH * 0.85), -w * 0.56, -d * 0.32, '#0d9488');
      pushBox(w * 0.32, d * 0.48, Math.round(baseH * 0.85), w * 0.56, -d * 0.32, '#0d9488');
    } else if (lm.shape === 'stadium') {
      buildings.push({
        type: 'Feature',
        properties: { color: col, height: baseH },
        geometry: { type: 'Polygon', coordinates: makeEllipsePolygon(lng, lat, w, d, a, 24) }
      });
      buildings.push({
        type: 'Feature',
        properties: { color: '#fdba74', height: Math.round(baseH * 0.55) },
        geometry: { type: 'Polygon', coordinates: makeEllipsePolygon(lng, lat, w * 0.64, d * 0.64, a, 20) }
      });
    } else if (lm.shape === 'theme_park') {
      pushBox(w * 0.42, d * 0.24, Math.round(baseH * 0.55), 0, -d * 0.68, '#fb7185');
      buildings.push({
        type: 'Feature',
        properties: { color: col, height: baseH },
        geometry: { type: 'Polygon', coordinates: makeEllipsePolygon(lng, lat, w * 0.36, d * 0.36, a, 16, 0, d * 0.12) }
      });
      pushBox(w * 0.26, d * 0.28, Math.round(baseH * 0.72), -w * 0.60, d * 0.34, '#e11d48');
      pushBox(w * 0.26, d * 0.28, Math.round(baseH * 0.68), w * 0.60, d * 0.34, '#f43f5e');
    } else {
      pushBox(w, d, baseH, 0, 0, col);
    }

    return { lotFeature, buildings };
  }

  return {
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
  };
})();
