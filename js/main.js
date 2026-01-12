// Newspaper-style CO₂ per-capita story map (offline Leaflet, GitHub Pages friendly)

var MIN_YEAR = 1960;
var MAX_YEAR = 2022;
var BASE_YEAR = 2015;

var currentYear = MAX_YEAR;
var mode = 'level'; // 'level' or 'change'

var pinnedIso = null;
var pinnedLayer = null;

// --- date in masthead ---
(function setToday(){
  var el = document.getElementById('todayText');
  if (!el) return;
  var d = new Date();
  el.textContent = d.toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: '2-digit' });
})();

// --- Leaflet map ---
var map = L.map('map', { 
  worldCopyJump: true, 
  minZoom: 2, 
  maxZoom: 7,
  zoomControl: false,
  maxBounds: [[-85, -180], [85, 180]],
  maxBoundsViscosity: 1.0
}).setView([20, 0], 2);

// Force map to recalculate size after a short delay to ensure visibility on mobile/slow loads
setTimeout(function() {
  map.invalidateSize();
}, 500);

window.addEventListener('resize', function() {
  map.invalidateSize();
});

L.control.zoom({ position: 'topleft' }).addTo(map);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  subdomains: 'abcd',
  maxZoom: 20
}).addTo(map);

L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

// --- helpers ---
function getValue(iso, year){
  if (!iso || iso === '-99') return null;
  var row = emissionsPerCapita[iso];
  if (!row) return null;
  var v = row[String(year)];
  if (v === undefined || v === null) return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

function getDelta(iso, year, baseYear){
  var a = getValue(iso, year);
  var b = getValue(iso, baseYear);
  if (a === null || b === null) return null;
  return a - b;
}

function metricForStyle(iso, year){
  if (mode === 'change') return getDelta(iso, year, BASE_YEAR);
  return getValue(iso, year);
}

function fmtTonnes(v){
  if (v === null) return 'No data';
  return v.toFixed(2) + ' t/person';
}

function fmtDelta(v){
  if (v === null) return 'No data';
  var sign = v > 0 ? '+' : '';
  return sign + v.toFixed(2) + ' t/person';
}

// --- color scales ---
var levelBreaks = [0.5, 2, 4, 7, 11, 15, 26]; // tonnes/person
var levelColors = ['#1B5E20', '#43A047', '#8BC34A', '#DCE775', '#FFD54F', '#FB8C00', '#E53935', '#B71C1C'];

function colorLevel(v){
  if (v === null) return '#4a4a4a';
  for (var i = 0; i < levelBreaks.length; i++) {
    if (v <= levelBreaks[i]) return levelColors[i];
  }
  return levelColors[levelColors.length - 1];
}

// delta breaks in t/person
var deltaBreaks = [-5, -2, -1, -0.5, 0.5, 1, 2, 5];
var deltaColors = ['#1B5E20', '#43A047', '#8BC34A', '#C5E1A5', '#eeeeee', '#FFCCBC', '#EF9A9A', '#E53935', '#B71C1C'];

function colorDelta(v){
  if (v === null) return '#4a4a4a';
  for (var i = 0; i < deltaBreaks.length; i++) {
    if (v <= deltaBreaks[i]) return deltaColors[i];
  }
  return deltaColors[deltaColors.length - 1];
}

function getFill(v){
  return (mode === 'change') ? colorDelta(v) : colorLevel(v);
}

// --- leaflet style ---
function baseStyle(feature){
  var iso = feature && feature.properties ? feature.properties.iso_a3 : null;
  var v = metricForStyle(iso, currentYear);
  return {
    weight: 0.5,
    color: 'rgba(255,255,255,0.2)',
    opacity: 1,
    fillOpacity: 0.8,
    fillColor: getFill(v)
  };
}

function highlightStyle(){
  return { weight: 2, color: '#fff', fillOpacity: 1 };
}

function resetLayerStyle(layer){
  geojson.resetStyle(layer);
}

// --- hover box on map ---
var info = L.control({ position: 'topright' });
info.onAdd = function(){
  this._div = L.DomUtil.create('div', 'infoBox');
  this.update(null, null);
  return this._div;
};
info.update = function(props, iso){
  if (!this._div) return;

  // show pinned when nothing hovered
  if (!props && pinnedIso){
    var p = pinnedLayer && pinnedLayer.feature ? pinnedLayer.feature.properties : null;
    var pv = metricForStyle(pinnedIso, currentYear);
    this._div.innerHTML =
      '<div><b>' + (p ? p.name : pinnedIso) + '</b></div>' +
      '<div style="margin-top:4px;">' + (mode === 'change' ? fmtDelta(pv) : fmtTonnes(pv)) + '</div>' +
      '<div style="opacity:.8;margin-top:4px;">Year ' + currentYear + '</div>' +
      '<div style="opacity:.75;margin-top:2px;">Mode ' + (mode === 'change' ? 'Change since 1990' : 'Level') + '</div>';
    return;
  }

  if (!props){
    this._div.innerHTML =
      '<div><b>Hover a country</b></div>' +
      '<div style="margin-top:4px;opacity:.85;">Year ' + currentYear + ' • ' + (mode === 'change' ? 'Change since 1990' : 'Level') + '</div>';
    return;
  }

  var v = metricForStyle(iso, currentYear);
  this._div.innerHTML =
    '<div><b>' + props.name + '</b></div>' +
    '<div style="margin-top:4px;">' + (mode === 'change' ? fmtDelta(v) : fmtTonnes(v)) + '</div>' +
    '<div style="opacity:.8;margin-top:4px;">Year ' + currentYear + '</div>';
};
info.addTo(map);

// --- rank cache for speed ---
var rankCache = {}; // year -> { iso: rank, count: n }

function buildRank(year){
  var y = String(year);
  if (rankCache[y]) return rankCache[y];

  var arr = [];
  for (var iso in emissionsPerCapita){
    if (!Object.prototype.hasOwnProperty.call(emissionsPerCapita, iso)) continue;
    var v = getValue(iso, year);
    if (v === null) continue;
    arr.push([iso, v]);
  }
  arr.sort(function(a, b){ return b[1] - a[1]; });

  var ranks = {};
  for (var i = 0; i < arr.length; i++){
    ranks[arr[i][0]] = i + 1;
  }
  rankCache[y] = { ranks: ranks, count: arr.length };
  return rankCache[y];
}

// --- profile panel ---
var elName = document.getElementById('countryName');
var elMeta = document.getElementById('countryMeta');
var elValue = document.getElementById('metricValue');
var elRank = document.getElementById('metricRank');
var elDelta = document.getElementById('metricDelta');

function updateProfile(){
  var clearBtn = document.getElementById('clearPin');

  if (!pinnedIso){
    elName.textContent = 'No country selected';
    elMeta.textContent = 'Click a country on the map to pin a profile.';
    elValue.textContent = '—';
    elRank.textContent = '—';
    elDelta.textContent = '—';
    drawSpark(null);
    if (clearBtn) clearBtn.disabled = true;
    return;
  }

  var props = pinnedLayer && pinnedLayer.feature ? pinnedLayer.feature.properties : null;
  var country = props ? props.name : pinnedIso;

  var v = getValue(pinnedIso, currentYear);
  var d = getDelta(pinnedIso, currentYear, BASE_YEAR);

  var rk = buildRank(currentYear);
  var r = rk.ranks[pinnedIso];
  var rankText = r ? (r + ' / ' + rk.count) : '—';

  elName.textContent = country;
  elMeta.textContent = 'Pinned selection • Year ' + currentYear;
  elValue.textContent = fmtTonnes(v);
  elRank.textContent = rankText;
  elDelta.textContent = fmtDelta(d);

  drawSpark(pinnedIso);

  if (clearBtn) clearBtn.disabled = false;
}

function drawSpark(iso){
  var canvas = document.getElementById('spark');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');

  // Set display size
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  var w = rect.width;
  var h = rect.height;

  ctx.clearRect(0, 0, w, h);

  if (!iso){
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Select a country to see its trend.', w / 2, h / 2);
    return;
  }

  var values = [];
  var years = [];
  var minV = Infinity, maxV = -Infinity;

  for (var yr = MIN_YEAR; yr <= MAX_YEAR; yr++){
    var v = getValue(iso, yr);
    years.push(yr);
    values.push(v);
    if (v === null) continue;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }

  if (!isFinite(minV) || !isFinite(maxV) || minV === maxV){
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Not enough data for a trend line.', w / 2, h / 2);
    return;
  }

  var padL = 10, padR = 10, padT = 20, padB = 25;
  var innerW = w - padL - padR;
  var innerH = h - padT - padB;

  function xFor(i){
    return padL + (i / (years.length - 1)) * innerW;
  }
  function yFor(v){
    var t = (v - minV) / (maxV - minV);
    return padT + (1 - t) * innerH;
  }

  // Draw year labels
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  
  // Start Year
  ctx.fillText(MIN_YEAR, xFor(0), h - 10);
  
  // Mid Year (approx 1990)
  var midIdx = years.indexOf(1990);
  if (midIdx !== -1) {
    ctx.fillText('1990', xFor(midIdx), h - 10);
  }
  
  // End Year
  ctx.fillText(MAX_YEAR, xFor(years.length - 1), h - 10);

  // Draw gradient area
  ctx.beginPath();
  var firstX = -1, lastX = -1;
  for (var i = 0; i < values.length; i++){
    var v2 = values[i];
    if (v2 !== null){
      var x = xFor(i);
      var y = yFor(v2);
      if (firstX === -1) {
        firstX = x;
        ctx.moveTo(x, h - 20); // Close gradient at the baseline of labels
        ctx.lineTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      lastX = x;
    }
  }
  if (firstX !== -1) {
    ctx.lineTo(lastX, h - 20);
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, padT, 0, h);
    grad.addColorStop(0, 'rgba(0, 229, 255, 0.2)');
    grad.addColorStop(1, 'rgba(0, 229, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Draw line
  ctx.strokeStyle = '#00E5FF';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowBlur = 4;
  ctx.shadowColor = 'rgba(0, 229, 255, 0.5)';

  ctx.beginPath();
  var started = false;
  for (var i = 0; i < values.length; i++){
    var v2 = values[i];
    if (v2 === null){
      started = false;
      continue;
    }
    var x = xFor(i);
    var y = yFor(v2);
    if (!started){
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  // current year marker
  var idx = currentYear - MIN_YEAR;
  if (idx >= 0 && idx < values.length && values[idx] !== null){
    var mx = xFor(idx);
    var my = yFor(values[idx]);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(mx, my, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#00E5FF';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// --- choropleth layer ---
function onEachFeature(feature, layer){
  layer.on({
    mouseover: function(e){
      if (pinnedLayer && e.target === pinnedLayer) {
        info.update(feature.properties, feature.properties.iso_a3);
        return;
      }
      e.target.setStyle(highlightStyle());
      if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) e.target.bringToFront();
      info.update(feature.properties, feature.properties.iso_a3);
    },
    mouseout: function(e){
      if (pinnedLayer && e.target === pinnedLayer) {
        info.update(null, null);
        return;
      }
      resetLayerStyle(e.target);
      info.update(null, null);
    },
    click: function(e){
      setPinned(e.target);
    }
  });
}

var geojson = L.geoJson(countriesGeo, {
  style: baseStyle,
  onEachFeature: onEachFeature
}).addTo(map);

// --- legend (in the dock, not on map) ---
function renderLegend(){
  var dock = document.getElementById('legendDock');
  if (!dock) return;

  var html = '';
  html += '<div class="flex flex-wrap justify-center items-end gap-2 md:gap-4 w-full max-w-4xl mx-auto">';
  
  if (mode === 'level'){
    var b = levelBreaks.slice();
    var labels = ['≤ 0.5', '0.5–2', '2–4', '4–7', '7–11', '11–15', '15–26', '> 26'];
    for (var i = 0; i < labels.length; i++){
      html += '<div class="flex flex-col items-center gap-2 group cursor-pointer">';
      html += '<div class="w-12 h-2 rounded-full transition-transform group-hover:scale-110" style="background-color: ' + levelColors[i] + ';"></div>';
      html += '<span class="text-[10px] text-slate-400 uppercase tracking-tighter">' + labels[i] + '</span>';
      html += '</div>';
    }
  } else {
    var labels = ['≤ -5', '-5 to -2', '-2 to -1', '-1 to -0.5', '±0.5', '0.5 to 1', '1 to 2', '2 to 5', '> 5'];
    for (var j = 0; j < labels.length; j++){
      html += '<div class="flex flex-col items-center gap-2 group cursor-pointer" title="Change since 2015">';
      html += '<div class="w-10 h-2 rounded-full transition-transform group-hover:scale-110" style="background-color: ' + deltaColors[j] + ';"></div>';
      html += '<span class="text-[10px] text-slate-400 uppercase tracking-tighter">' + labels[j] + '</span>';
      html += '</div>';
    }
  }
  
  html += '<div class="w-px h-6 bg-white/10 mx-2"></div>';
  html += '<div class="flex flex-col items-center gap-2 group cursor-pointer">';
  html += '<div class="w-12 h-2 rounded-full border border-white/10" style="background-color: #4a4a4a;"></div>';
  html += '<span class="text-[10px] text-slate-400 uppercase tracking-tighter">No data</span>';
  html += '</div>';
  
  html += '</div>';
  dock.innerHTML = html;
}

// --- pinned selection ---
function setPinned(layer){
  if (pinnedLayer){
    resetLayerStyle(pinnedLayer);
  }
  pinnedLayer = layer;

  var iso = layer && layer.feature && layer.feature.properties ? layer.feature.properties.iso_a3 : null;
  pinnedIso = iso;

  if (pinnedLayer){
    pinnedLayer.setStyle(Object.assign({}, highlightStyle(), { fillOpacity: 0.95 }));
    if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) pinnedLayer.bringToFront();
  }

  updateProfile();
  info.update(null, null);
}

function clearPinned(){
  if (pinnedLayer){
    resetLayerStyle(pinnedLayer);
  }
  pinnedIso = null;
  pinnedLayer = null;
  updateProfile();
  info.update(null, null);
}

// --- update cycle ---
function applyUpdate(){
  geojson.setStyle(baseStyle);

  // keep pinned on top and highlighted
  if (pinnedLayer){
    pinnedLayer.setStyle(Object.assign({}, highlightStyle(), { fillOpacity: 0.95 }));
    if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) pinnedLayer.bringToFront();
  }

  document.getElementById('yearText').textContent = String(currentYear);

  renderLegend();
  updateProfile();
  info.update(null, null);
}

// --- UI wiring ---
var slider = document.getElementById('yearSlider');
var playBtn = document.getElementById('playBtn');

var modeLevelBtn = document.getElementById('modeLevel');
var modeChangeBtn = document.getElementById('modeChange');

var clearBtn = document.getElementById('clearPin');
if (clearBtn){
  clearBtn.addEventListener('click', function(){
    clearPinned();
  });
}

if (slider){
  slider.addEventListener('input', function(e){
    currentYear = Number(e.target.value);
    applyUpdate();
  });
}

var timer = null;
function setPlaying(isPlaying){
  if (!playBtn) return;

  if (isPlaying){
    playBtn.textContent = 'Pause';
    timer = setInterval(function(){
      currentYear += 1;
      if (currentYear > MAX_YEAR) currentYear = MIN_YEAR;
      if (slider) slider.value = String(currentYear);
      applyUpdate();
    }, 650);
  } else {
    playBtn.textContent = 'Play';
    if (timer) clearInterval(timer);
    timer = null;
  }
}

if (playBtn){
  playBtn.addEventListener('click', function(){
    setPlaying(!timer);
  });
}

function setMode(next){
  mode = next;
  if (modeLevelBtn && modeChangeBtn){
    if (mode === 'level'){
      modeLevelBtn.classList.add('bg-neon-cyan', 'text-deep-navy', 'font-bold');
      modeLevelBtn.classList.remove('bg-transparent', 'text-white', 'border-white/30');
      
      modeChangeBtn.classList.add('bg-transparent', 'text-white', 'border-white/30');
      modeChangeBtn.classList.remove('bg-neon-cyan', 'text-deep-navy', 'font-bold');
    } else {
      modeChangeBtn.classList.add('bg-neon-cyan', 'text-deep-navy', 'font-bold');
      modeChangeBtn.classList.remove('bg-transparent', 'text-white', 'border-white/30');
      
      modeLevelBtn.classList.add('bg-transparent', 'text-white', 'border-white/30');
      modeLevelBtn.classList.remove('bg-neon-cyan', 'text-deep-navy', 'font-bold');
    }
  }
  applyUpdate();
}

if (modeLevelBtn){
  modeLevelBtn.addEventListener('click', function(){ setMode('level'); });
}
if (modeChangeBtn){
  modeChangeBtn.addEventListener('click', function(){ setMode('change'); });
}

var yearBtns = document.querySelectorAll('.yearBtn');
for (var i = 0; i < yearBtns.length; i++){
  yearBtns[i].addEventListener('click', function(e){
    var y = Number(e.target.getAttribute('data-year'));
    if (!isFinite(y)) return;
    currentYear = Math.max(MIN_YEAR, Math.min(MAX_YEAR, y));
    if (slider) slider.value = String(currentYear);
    applyUpdate();
  });
}

// stop play when user interacts with the map
map.on('dragstart zoomstart', function(){
  if (timer) setPlaying(false);
});

// initial render
renderLegend();
updateProfile();
applyUpdate();
