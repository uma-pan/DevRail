// MapLibre GL JS ゲームレイヤー構成モジュール
window.RAIL_LAYERS = (() => {
  'use strict';
  function setupGameMapLayers(map, buildExistingLinesGeoJSON, buildExistingStationsGeoJSON) {
    // 0a. 土地区画整理・整地マスク（ベースマップの既存道路・既存建物を更地化して上書き）
    if (!map.getSource('redev-zones')) {
      map.addSource('redev-zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'redev-zones-fill',
        type: 'fill',
        source: 'redev-zones',
        paint: {
          'fill-color': '#eef2f6',
          'fill-opacity': 0.97
        }
      });
      map.addLayer({
        id: 'redev-zones-outline',
        type: 'line',
        source: 'redev-zones',
        paint: {
          'line-color': '#94a3b8',
          'line-width': 1.2,
          'line-dasharray': [3, 2],
          'line-opacity': 0.65
        }
      });
    }

    // 0b. 自社新設道路・区画街路・付け替え大通り
    if (!map.getSource('custom-roads')) {
      map.addSource('custom-roads', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'custom-roads-casing',
        type: 'line',
        source: 'custom-roads',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#475569',
          'line-width': [
            'interpolate', ['exponential', 2], ['zoom'],
            11, ['case', ['==', ['get', 'roadType'], 'avenue'], 3.2, 2.0],
            14, ['case', ['==', ['get', 'roadType'], 'avenue'], 12, 7],
            16, ['case', ['==', ['get', 'roadType'], 'avenue'], 32, 18]
          ]
        }
      });
      map.addLayer({
        id: 'custom-roads-fill',
        type: 'line',
        source: 'custom-roads',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['case', ['==', ['get', 'roadType'], 'avenue'], '#f8fafc', '#ffffff'],
          'line-width': [
            'interpolate', ['exponential', 2], ['zoom'],
            11, ['case', ['==', ['get', 'roadType'], 'avenue'], 2.2, 1.2],
            14, ['case', ['==', ['get', 'roadType'], 'avenue'], 9.5, 5.2],
            16, ['case', ['==', ['get', 'roadType'], 'avenue'], 27, 14.5]
          ]
        }
      });
      map.addLayer({
        id: 'custom-roads-centerline',
        type: 'line',
        source: 'custom-roads',
        filter: ['==', ['get', 'roadType'], 'avenue'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': '#f59e0b',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 15, 2.0],
          'line-dasharray': [2.5, 2.0],
          'line-opacity': 0.85
        }
      });
    }

    // 0c. 駅前ロータリー（歩道広場・環状車道・中央植栽アイランド）
    if (!map.getSource('custom-rotaries')) {
      map.addSource('custom-rotaries', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'custom-rotary-plaza',
        type: 'fill',
        source: 'custom-rotaries',
        filter: ['==', ['get', 'part'], 'plaza'],
        paint: {
          'fill-color': '#cbd5e1',
          'fill-outline-color': '#64748b'
        }
      });
      map.addLayer({
        id: 'custom-rotary-road',
        type: 'fill',
        source: 'custom-rotaries',
        filter: ['==', ['get', 'part'], 'road'],
        paint: {
          'fill-color': '#64748b'
        }
      });
      map.addLayer({
        id: 'custom-rotary-lane',
        type: 'line',
        source: 'custom-rotaries',
        filter: ['==', ['get', 'part'], 'lane'],
        paint: {
          'line-color': '#f8fafc',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.0, 15, 2.2],
          'line-dasharray': [2.5, 2.0],
          'line-opacity': 0.9
        }
      });
      map.addLayer({
        id: 'custom-rotary-island',
        type: 'fill',
        source: 'custom-rotaries',
        filter: ['==', ['get', 'part'], 'island'],
        paint: {
          'fill-color': '#86efac',
          'fill-outline-color': '#16a34a'
        }
      });
    }

    // 0d. 開発施設の敷地舗装
    if (!map.getSource('dev-lots')) {
      map.addSource('dev-lots', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'dev-lots-fill',
        type: 'fill',
        source: 'dev-lots',
        paint: {
          'fill-color': '#cbd5e1',
          'fill-outline-color': '#64748b',
          'fill-opacity': 0.78
        }
      });
    }

    // 1a. 日本全国の全既存鉄道路線（OpenFreeMapベクトルタイル直描画：通信量0・超軽量60fps）
    const styleObj = map.getStyle();
    if (styleObj && styleObj.sources && styleObj.sources.openmaptiles && !map.getLayer('nationwide-rail-vector')) {
      map.addLayer({
        id: 'nationwide-rail-vector',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'rail'],
        paint: {
          'line-color': [
            'match', ['get', 'subclass'],
            'subway', '#0284c7',
            'light_rail', '#0d9488',
            'monorail', '#7c3aed',
            'tram', '#059669',
            '#db2777'
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.1, 11, 2.0, 14, 3.4],
          'line-opacity': 0.62
        }
      });
    }

    // 1b. 初期エリア用ハイライト路線（広域読込時はベクトルタイル一本化のため自動非表示）
    if (!map.getSource('existing-lines')) {
      map.addSource('existing-lines', { type: 'geojson', data: buildExistingLinesGeoJSON() });
      map.addLayer({
        id: 'existing-lines-layer',
        type: 'line',
        source: 'existing-lines',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 3.5],
          'line-opacity': 0.45,
          'line-dasharray': [2.5, 1.8]
        }
      });
    }

    // 2. 既存駅ドット（関東全域2,000駅超でも軽快に動くズーム連動表示）
    if (!map.getSource('existing-stations')) {
      map.addSource('existing-stations', { type: 'geojson', data: buildExistingStationsGeoJSON() });
      map.addLayer({
        id: 'existing-stations-circle',
        type: 'circle',
        source: 'existing-stations',
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            8, ['case', ['get', 'hub'], 4.2, ['get', 'major'], 2.4, 1.2],
            12, ['case', ['get', 'hub'], 6.5, ['get', 'major'], 4.5, 2.8],
            14, ['case', ['get', 'hub'], 7.5, ['get', 'major'], 5.5, 3.8]
          ],
          'circle-color': ['case', ['get', 'hub'], '#0f172a', '#ffffff'],
          'circle-stroke-color': ['case', ['get', 'hub'], '#f59e0b', ['get', 'major'], '#334155', '#64748b'],
          'circle-stroke-width': ['case', ['get', 'hub'], 2.2, ['get', 'major'], 1.6, 1.0]
        }
      });
      map.addLayer({
        id: 'existing-stations-label-hub',
        type: 'symbol',
        source: 'existing-stations',
        minzoom: 8.5,
        filter: ['==', ['get', 'hub'], true],
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 12,
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
        id: 'existing-stations-label-major',
        type: 'symbol',
        source: 'existing-stations',
        minzoom: 10.6,
        filter: ['all', ['!=', ['get', 'hub'], true], ['==', ['get', 'major'], true]],
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 10.5,
          'text-offset': [0, -1.0],
          'text-anchor': 'bottom'
        },
        paint: {
          'text-color': '#0f172a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.8
        }
      });
      map.addLayer({
        id: 'existing-stations-label-local',
        type: 'symbol',
        source: 'existing-stations',
        minzoom: 12.5,
        filter: ['all', ['!', ['get', 'hub']], ['!', ['get', 'major']]],
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 9.5,
          'text-offset': [0, -0.85],
          'text-anchor': 'bottom'
        },
        paint: {
          'text-color': '#475569',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5
        }
      });
    }

    // 3. 駅勢圏インパクトサークル（Subway Builder風の赤い/青い駅エリア）
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

    // 4. 自社開発による3D新規ビル群＆大型ランドマーク（fill-extrusion）
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
      // 高架用の立体シャドウ
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
      // 地上・高架ケーシング
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
      // 地上・高架本体
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
      // 地下シールド線（破線＋半透明）
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

    // 5b. 線路制御点＆現在の延伸アンカー
    if (!map.getSource('my-track-nodes')) {
      map.addSource('my-track-nodes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'my-track-nodes-circle',
        type: 'circle',
        source: 'my-track-nodes',
        paint: {
          'circle-radius': ['case', ['get', 'active'], 7.5, 4],
          'circle-color': ['case', ['get', 'active'], '#ffffff', '#38bdf8'],
          'circle-stroke-color': ['case', ['get', 'active'], '#0284c7', '#0f172a'],
          'circle-stroke-width': ['case', ['get', 'active'], 3, 1.5]
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

    // 5d. 沿線開発・区画整理・道路再編のリアルタイムプレビュー
    if (!map.getSource('preview-dev')) {
      map.addSource('preview-dev', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'preview-dev-fill',
        type: 'fill',
        source: 'preview-dev',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['coalesce', ['get', 'opacity'], 0.35],
          'fill-outline-color': ['coalesce', ['get', 'stroke'], '#0ea5e9']
        }
      });
      map.addLayer({
        id: 'preview-dev-line',
        type: 'line',
        source: 'preview-dev',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['coalesce', ['get', 'width'], 4],
          'line-dasharray': [2, 1.5],
          'line-opacity': 0.9
        }
      });
      map.addLayer({
        id: 'preview-dev-point',
        type: 'circle',
        source: 'preview-dev',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 6,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2
        }
      });
    }

    // 6. 走行中の自社列車（リアルタイムアニメーション）
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

  return { setupGameMapLayers };
})();
