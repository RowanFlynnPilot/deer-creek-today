/* Today at Deer Creek: fetches the National Weather Service forecast for the course and draws the page.
   When the weather service is slow or down, the page still shows sunrise, sunset, green fees and the
   booking link, and falls back to the last forecast this device saved (up to 12 hours old), saying so. */
(function () {
  'use strict';
  const C = window.TodayCore;
  const NWS = {
    points: 'https://api.weather.gov/points/' + C.COURSE.lat.toFixed(4) + ',' + C.COURSE.lon.toFixed(4),
    hourly: 'https://api.weather.gov/gridpoints/OHX/114,54/forecast/hourly',
    daily: 'https://api.weather.gov/gridpoints/OHX/114,54/forecast'
  };
  const HOURLY_FIELDS = ['startTime', 'endTime', 'isDaytime', 'temperature', 'probabilityOfPrecipitation', 'windSpeed', 'windDirection', 'shortForecast'];
  const DAILY_FIELDS = ['startTime', 'endTime', 'isDaytime', 'temperature', 'windSpeed', 'windDirection', 'shortForecast', 'detailedForecast'];
  const CACHE_KEY = 'deer-creek-today/v1';
  const CACHE_MAX_AGE = 12 * 3600 * 1000;
  const REFRESH_EVERY = 30 * 60 * 1000;

  // Checking aids that golfers never need: ?now=2026-10-03T09:00:00-05:00 pins the clock, ?offline skips the
  // weather service, and ?fixture reads the forecast saved in fixtures/ so a screenshot comes out the same every time
  const params = new URLSearchParams(location.search);
  const pinned = params.get('now') ? new Date(params.get('now')) : null;
  const offline = params.has('offline');
  const fixture = params.has('fixture');
  const now = () => (pinned && !isNaN(pinned) ? pinned : new Date());

  const $ = (id) => document.getElementById(id);
  const state = {
    hours: [], daily: [], issued: null, source: null, savedAt: null,
    loading: true, failed: false, refreshFailedAt: null, lastTry: 0,
    key: null, picked: false, dayKeys: [], sunRisen: false, barsGrown: false
  };

  // Stroke icons in the boards' style (24px grid, 2px lines); the first four are the Today board's own
  const ICONS = {
    sun: '<path d="M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>',
    partly: '<path d="M7 4.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5M7 1v1.5M1 7h1.5M2.8 2.8l1 1M9 21a4 4 0 0 1-.5-8A5 5 0 0 1 18 12a3.5 3.5 0 0 1 1 9z"></path>',
    cloud: '<path d="M7 18a4 4 0 0 1-.5-8A5 5 0 0 1 16 9a3.5 3.5 0 0 1 1 9z"></path>',
    rain: '<path d="M7 15a4 4 0 0 1-.5-8A5 5 0 0 1 16 6a3.5 3.5 0 0 1 1 9zM8 19l-1 2M12 19l-1 2M16 19l-1 2"></path>',
    showers: '<path d="M7 15a4 4 0 0 1-.5-8A5 5 0 0 1 16 6a3.5 3.5 0 0 1 1 9zM10 19l-1 2M14 19l-1 2"></path>',
    storm: '<path d="M7 15a4 4 0 0 1-.5-8A5 5 0 0 1 16 6a3.5 3.5 0 0 1 1 9zM12.5 15l-2 3.5h3l-2 3.5"></path>',
    fog: '<path d="M3 8h18M5 12h14M3 16h18M7 20h10"></path>',
    snow: '<path d="M7 15a4 4 0 0 1-.5-8A5 5 0 0 1 16 6a3.5 3.5 0 0 1 1 9zM8 19h.01M12 21h.01M16 19h.01"></path>',
    night: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"></path>'
  };
  function iconEl(name) {
    const span = document.createElement('span');
    span.className = 'hr-icon';
    span.setAttribute('aria-hidden', 'true');
    // Static markup from the table above; no forecast text ever goes through innerHTML
    span.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || ICONS.cloud) + '</svg>';
    return span;
  }

  const short = (d) => C.time(d).replace(':00', '');
  const pick = (o, fields) => { const out = {}; for (const f of fields) if (o[f] !== undefined) out[f] = o[f]; return out; };

  // ---------- the weather service ----------

  async function getJSON(url, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/geo+json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchForecast() {
    if (offline) throw new Error('offline');
    if (fixture) {
      const fx = await getJSON('fixtures/nws-2026-10-02-2300.json', 5000);
      return { issued: fx.generatedAt, hourly: fx.hourly, daily: fx.daily };
    }
    const both = (u) => Promise.all([getJSON(u.hourly, 12000), getJSON(u.daily, 12000)]);
    let h, d;
    try {
      [h, d] = await both(NWS);
    } catch (first) {
      // The service sometimes stumbles on a request, and now and then it redraws its forecast grid,
      // so look the course up again and try once more.
      const p = await getJSON(NWS.points, 10000);
      [h, d] = await both({ hourly: p.properties.forecastHourly, daily: p.properties.forecast });
    }
    return {
      issued: h.properties.generatedAt || h.properties.updateTime || null,
      hourly: (h.properties.periods || []).map((p) => pick(p, HOURLY_FIELDS)),
      daily: (d.properties.periods || []).map((p) => pick(p, DAILY_FIELDS))
    };
  }

  function save(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data })); } catch (e) { /* private mode: no saved copy */ }
  }
  function readSaved() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return c && c.data && Date.now() - c.savedAt < CACHE_MAX_AGE ? c : null;
    } catch (e) {
      return null;
    }
  }

  function apply(data, source, savedAt) {
    state.hours = C.toHours(data.hourly);
    state.daily = data.daily || [];
    state.issued = data.issued ? new Date(data.issued) : null;
    state.source = source;
    state.savedAt = savedAt || null;
    state.failed = false;
  }

  let inflight = null;
  function refresh() {
    if (inflight) return inflight;
    state.lastTry = Date.now();
    inflight = fetchForecast()
      .then((data) => {
        if (!fixture) save(data);
        apply(data, 'live');
        state.refreshFailedAt = null;
      })
      .catch(() => {
        if (state.source === 'live') {
          state.refreshFailedAt = new Date(); // keep showing the forecast already on screen
        } else {
          const saved = readSaved();
          if (saved) apply(saved.data, 'saved', saved.savedAt);
          else state.failed = true;
        }
      })
      .finally(() => {
        inflight = null;
        state.loading = false;
        render();
      });
    return inflight;
  }

  // ---------- drawing ----------

  function defaultKey(t) {
    const today = C.dayKey(t);
    const sun = C.sunTimes(today);
    // Within 45 minutes of sunset, today is done: open on tomorrow
    return t > new Date(sun.sunset.getTime() - 45 * 60000) ? C.addDays(today, 1) : today;
  }

  function renderDays(today) {
    const keys = [today, C.addDays(today, 1), C.addDays(today, 2)];
    const box = $('days');
    if (state.dayKeys.join() !== keys.join()) {
      state.dayKeys = keys;
      box.textContent = '';
      keys.forEach((k, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'day';
        b.dataset.key = k;
        b.textContent = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : C.weekday(k);
        b.addEventListener('click', () => {
          state.key = k;
          state.picked = true;
          render();
        });
        box.appendChild(b);
      });
    }
    for (const b of box.children) b.setAttribute('aria-pressed', String(b.dataset.key === state.key));
  }

  function renderSun(sun, isToday, t) {
    const el = $('sun');
    if (isToday && (t < sun.sunrise || t > sun.sunset)) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const f = isToday ? (t - sun.sunrise) / (sun.sunset - sun.sunrise) : 0.5;
    el.style.setProperty('--lift', Math.round(Math.sin(Math.PI * f) * 26) + 'px');
    if (!state.sunRisen) {
      el.classList.add('rise');
      state.sunRisen = true;
    }
  }

  function renderRates(key, isToday, t) {
    const r = C.ratesFor(key);
    $('rates-caption').textContent = (isToday ? "Today's" : C.weekday(key) + "'s") + ' green fees';
    const twilightNow = isToday && C.local(t).hh * 60 + C.local(t).mm >= 14 * 60 + 30;
    const rows = [
      ['18 holes', r.eighteen, !twilightNow && isToday],
      ['18 holes from ' + r.twilightFrom, r.twilight, twilightNow],
      ['9 holes', r.nine, false],
      ['9 holes from ' + r.twilightFrom, r.nineTwilight, false]
    ];
    const body = $('rates');
    body.textContent = '';
    for (const [label, price] of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = label;
      const td = document.createElement('td');
      td.className = 'num';
      td.textContent = '$' + price;
      tr.append(th, td);
      body.appendChild(tr);
    }
  }

  function renderDark(sun, isToday, t) {
    const by18 = C.teeOffBy(sun.sunset, C.PACE.eighteen);
    const by9 = C.teeOffBy(sun.sunset, C.PACE.nine);
    const p = $('dark-text');
    p.textContent = '';
    const strong = (s) => { const b = document.createElement('strong'); b.textContent = s; return b; };
    if (isToday && t > sun.sunset) {
      p.append('The sun has set. Tomorrow, sunset is at ', strong(C.time(C.sunTimes(C.addDays(C.dayKey(t), 1)).sunset)), '.');
    } else if (isToday && t > by9) {
      p.append('Too late for nine holes before dark today. Sunset is at ', strong(C.time(sun.sunset)), '.');
    } else if (isToday && t > by18) {
      p.append('Too late to finish 18 in daylight. For nine, tee off by ', strong(short(by9)), '.');
    } else {
      p.append('To finish 18 before sunset, tee off by ', strong(short(by18)), '. For nine, tee off by ', strong(short(by9)), '. That allows about 4¼ hours for 18 and 2 hours 10 minutes for nine.');
    }
  }

  function setVerdict(a, b) {
    const h = $('verdict');
    h.textContent = '';
    const s1 = document.createElement('span');
    s1.className = 'v1';
    s1.textContent = a;
    const s2 = document.createElement('span');
    s2.className = 'v2';
    s2.textContent = b;
    h.append(s1, ' ', s2);
  }

  function windText(period, list) {
    if (period && period.windSpeed) {
      const speed = period.windSpeed.replace(/ to /, '–');
      return /^0 mph$/.test(period.windSpeed) ? 'Calm' : speed + (period.windDirection ? ' ' + period.windDirection : '');
    }
    if (!list.length) return '–';
    const top = list.reduce((a, h) => (h.wind > a.wind ? h : a), list[0]);
    return top.wind ? top.wind + ' mph ' + top.windDir : 'Calm';
  }

  function renderForecast(key, isToday, sun, t) {
    const list = C.playingHours(state.hours, key, t);
    const daylight = C.playingHours(state.hours, key, null);
    const period = C.daytimePeriod(state.daily, key);
    const v = C.verdict(list);
    setVerdict(v.a, v.b);
    $('summary').textContent = v.key === 'dark' ? 'The sun set at ' + C.time(sun.sunset) + '. Tomorrow is the next chance to play.' : C.daySummary(period) || (list[0] ? list[0].sky + '.' : '');
    $('retry').hidden = true;

    const temps = daylight.map((h) => h.temp).filter((x) => x != null);
    const hi = temps.length ? Math.max(...temps) : null;
    const current = state.hours.find((h) => h.start <= t && t < h.end);
    if (isToday && current) {
      $('temp').textContent = current.temp + '°';
      $('temp-sub').textContent = hi != null && v.key !== 'dark' ? 'Now · high ' + hi + '°' : 'Now';
    } else {
      $('temp').textContent = hi != null ? hi + '°' : '';
      $('temp-sub').textContent = hi != null ? 'High' : '';
    }
    $('wind').textContent = windText(period, daylight);

    const w = C.bestWindow(list);
    const bar = $('window');
    if (!list.length) {
      bar.hidden = true;
    } else if (w && w.hours >= 2) {
      const from = isToday && w.start <= t ? 'Now' : short(w.start);
      const to = w.end >= sun.sunset ? 'sunset' : short(w.end);
      $('window-text').textContent = 'Best window ' + from + ' – ' + to;
      $('window-note').textContent = 'Rain ' + w.maxPop + '% at most';
      bar.hidden = false;
    } else {
      const driest = list.reduce((a, h) => (h.pop < a.pop ? h : a), list[0]);
      $('window-text').textContent = 'No dry stretch of two hours';
      $('window-note').textContent = 'Driest ' + short(driest.start) + ' · ' + driest.pop + '%';
      bar.hidden = false;
    }

    // The page redraws every minute; rebuild the strip only when what it shows has changed,
    // so a golfer who has swiped along it isn't thrown back to the start
    const ol = $('hours');
    const signature = key + '|' + list.map((h, i) => [+h.start, h.temp, h.pop, h.icon, isToday && i === 0 && h.start <= t,
      !!(w && w.hours >= 2 && h.start >= w.start && h.end <= w.end)].join(',')).join(';');
    if (ol.dataset.signature === signature) return;
    ol.dataset.signature = signature;
    ol.textContent = '';
    const grow = !state.barsGrown;
    list.forEach((h, i) => {
      const li = document.createElement('li');
      li.className = 'hr' + (w && w.hours >= 2 && h.start >= w.start && h.end <= w.end ? ' best' : '');
      // One plain sentence for screen readers; the visual cells below are hidden from them
      const said = document.createElement('span');
      said.className = 'sr';
      said.textContent = short(h.start) + ': ' + h.temp + ' degrees, ' + h.pop + ' percent chance of rain, ' + h.sky.toLowerCase() + '.';
      const tm = document.createElement('span');
      tm.className = 'hr-t';
      tm.textContent = isToday && i === 0 && h.start <= t ? 'Now' : C.hourLabel(h.start);
      const temp = document.createElement('span');
      temp.className = 'hr-temp num';
      temp.textContent = h.temp + '°';
      const barBox = document.createElement('span');
      barBox.className = 'hr-bar';
      const fill = document.createElement('i');
      fill.style.height = Math.max(3, Math.round(h.pop / 100 * 44)) + 'px';
      if (grow) {
        fill.className = 'grow';
        fill.style.animationDelay = (0.2 + i * 0.04).toFixed(2) + 's';
      }
      barBox.appendChild(fill);
      const pop = document.createElement('span');
      pop.className = 'hr-pop num';
      pop.textContent = h.pop + '%';
      for (const el of [tm, temp, barBox, pop]) el.setAttribute('aria-hidden', 'true');
      li.append(said, tm, iconEl(h.icon), temp, barBox, pop);
      ol.appendChild(li);
    });
    if (list.length) state.barsGrown = true;
  }

  function renderWithoutForecast(key) {
    $('window').hidden = true;
    $('hours').textContent = '';
    delete $('hours').dataset.signature;
    $('temp').textContent = '';
    $('temp-sub').textContent = '';
    $('wind').textContent = '–';
    if (state.loading) {
      setVerdict('Checking', 'the sky.');
      $('summary').textContent = "Asking the National Weather Service for the course's forecast.";
      $('retry').hidden = true;
    } else if (state.failed) {
      setVerdict('Forecast', 'unavailable.');
      $('summary').textContent = "The weather service didn't answer. Sunrise, sunset and green fees below are still right.";
      $('retry').hidden = false;
    } else {
      setVerdict('No forecast', 'yet.');
      $('summary').textContent = 'The weather service forecasts about six days ahead. Check back closer to ' + C.weekday(key) + '.';
      $('retry').hidden = true;
    }
  }

  function renderStatus(t) {
    // Write only on change: the line is a live region, and the page redraws every minute
    const el = $('status');
    const s = { set textContent(v) { if (el.textContent !== v) el.textContent = v; } };
    const issued = state.issued ? (C.dayKey(state.issued) === C.dayKey(t) ? '' : C.weekday(C.dayKey(state.issued)) + ' ') + C.time(state.issued) : null;
    if (state.loading && !state.source) s.textContent = 'Checking the National Weather Service…';
    else if (state.failed) s.textContent = "The National Weather Service didn't answer, and this device has no saved forecast yet.";
    else if (state.source === 'saved') s.textContent = "The weather service isn't answering, so this is the forecast this device saved at " + C.time(new Date(state.savedAt)) + '.';
    else if (state.refreshFailedAt) s.textContent = 'Forecast from the National Weather Service, issued ' + issued + ". The latest refresh didn't go through; the page will try again.";
    else if (issued) s.textContent = 'Forecast from the National Weather Service for the course, issued ' + issued + '.';
    else s.textContent = '';
  }

  function render() {
    const t = now();
    const today = C.dayKey(t);
    if (!state.key || (!state.picked && state.key !== defaultKey(t)) || state.key < today) state.key = defaultKey(t);
    renderDays(today);
    const key = state.key;
    const isToday = key === today;
    const sun = C.sunTimes(key);
    $('date').textContent = C.longDate(key);
    $('sunrise').textContent = C.time(sun.sunrise);
    $('sunset').textContent = C.time(sun.sunset);
    $('sunset-2').textContent = C.time(sun.sunset);
    renderSun(sun, isToday, t);
    renderRates(key, isToday, t);
    renderDark(sun, isToday, t);
    if (state.hours.some((h) => h.key === key)) renderForecast(key, isToday, sun, t);
    else renderWithoutForecast(key);
    renderStatus(t);
  }

  // ---------- start ----------

  $('retry').addEventListener('click', () => {
    state.failed = false;
    state.loading = true;
    render();
    refresh();
  });
  const saved = offline || fixture ? null : readSaved();
  if (saved) apply(saved.data, 'saved', saved.savedAt); // paint at once; replaced when the fresh forecast lands
  render();
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_EVERY);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - state.lastTry > 10 * 60000) refresh();
  });
  setInterval(render, 60000); // keeps "now", the sun and the hours ahead current
})();
