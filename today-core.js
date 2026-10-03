/* Today at Deer Creek: the parts with no page and no network, so Node can test them (test-core.js).
   Every instant is a Date; every calendar question (which day, what time) is answered in the course's
   own time zone, whatever the viewer's device is set to. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TodayCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 445 Deer Creek Dr, Crossville, TN (U.S. Census geocoder)
  const COURSE = { lat: 35.99545, lon: -85.02372, tz: 'America/Chicago' };
  const BOOKING_URL = 'https://foreupsoftware.com/index.php/booking/22536/11099';
  // Green fees as the booking page listed them, read September 30, 2026
  const RATES = { weekday: 45, weekend: 57, twilight: 35, nineWeekday: 27, nineWeekend: 35, nineTwilight: 25, twilightFrom: '2:30 PM' };
  // Pace for "tee off by": about 4 h 15 min for 18 holes and 2 h 10 min for nine, to the 10-minute tee interval
  const PACE = { eighteen: 255, nine: 130 };
  // An hour is playable when it is dry enough, mild enough and calm enough
  const PLAYABLE = { maxPop: 30, minTemp: 40, maxTemp: 92, maxWind: 20 };

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const partsFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: COURSE.tz, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short'
  });
  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: COURSE.tz, hour: 'numeric', minute: '2-digit' });
  const longDateFmt = new Intl.DateTimeFormat('en-US', { timeZone: COURSE.tz, weekday: 'long', month: 'long', day: 'numeric' });
  const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: COURSE.tz, weekday: 'long' });

  const pad = (n) => String(n).padStart(2, '0');

  /** The course's local calendar parts of an instant. wd: 0 = Sunday. */
  function local(date) {
    const o = {};
    for (const p of partsFmt.formatToParts(date)) o[p.type] = p.value;
    return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour % 24, mm: +o.minute, wd: WEEKDAYS.indexOf(o.weekday) };
  }

  /** "2026-10-03": the course's calendar day an instant falls on. */
  function dayKey(date) {
    const l = local(date);
    return l.y + '-' + pad(l.m) + '-' + pad(l.d);
  }

  /** Noon on a calendar day, as an instant: a safe handle for "that day". */
  function noonOf(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 17, 0));
  }

  /** The calendar day n days after key. */
  function addDays(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n, 12));
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  }

  /** Sunrise and sunset at the course on a calendar day, from NOAA's solar equations. */
  function sunTimes(key) {
    const [y, m, d] = key.split('-').map(Number);
    const rad = Math.PI / 180;
    const jd = Date.UTC(y, m - 1, d, 12) / 86400000 + 2440587.5;
    const T = (jd - 2451545) / 36525;
    const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
      Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
    const omega = 125.04 - 1934.136 * T;
    const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad);
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(omega * rad);
    const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad)) / rad;
    const yv = Math.tan(eps / 2 * rad) ** 2;
    const eqTime = 4 / rad * (yv * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) +
      4 * e * yv * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * yv * yv * Math.sin(4 * L0 * rad) -
      1.25 * e * e * Math.sin(2 * M * rad));
    const cosHa = Math.cos(90.833 * rad) / (Math.cos(COURSE.lat * rad) * Math.cos(decl * rad)) -
      Math.tan(COURSE.lat * rad) * Math.tan(decl * rad);
    const ha = Math.acos(Math.min(1, Math.max(-1, cosHa))) / rad;
    const noonUtcMinutes = 720 - 4 * COURSE.lon - eqTime;
    const base = Date.UTC(y, m - 1, d);
    return {
      sunrise: new Date(base + (noonUtcMinutes - 4 * ha) * 60000),
      sunset: new Date(base + (noonUtcMinutes + 4 * ha) * 60000)
    };
  }

  /** The strongest wind in an NWS wind string: "0 mph", "5 to 10 mph". */
  function windMph(text) {
    const nums = String(text || '').match(/\d+/g);
    return nums ? Math.max(...nums.map(Number)) : 0;
  }

  function tempF(t) {
    if (t && typeof t === 'object') {
      if (t.value == null) return null;
      return /degC/.test(t.unitCode || '') ? Math.round(t.value * 9 / 5 + 32) : Math.round(t.value);
    }
    return typeof t === 'number' ? t : null;
  }

  function iconFor(h) {
    const s = h.sky.toLowerCase();
    if (h.thunder && h.pop >= 20) return 'storm';
    if (/rain|shower|drizzle/.test(s) && h.pop >= 40) return 'rain';
    if (/rain|shower|drizzle/.test(s) && h.pop >= 15) return 'showers';
    if (/snow|sleet|flurr/.test(s)) return 'snow';
    if (/fog|haze|smoke/.test(s)) return 'fog';
    if (/partly|mostly sunny|mostly clear/.test(s)) return h.isDaytime ? 'partly' : 'night';
    if (/cloudy|overcast/.test(s)) return 'cloud';
    return h.isDaytime ? 'sun' : 'night';
  }

  function isPlayable(h) {
    return h.pop < PLAYABLE.maxPop && !(h.thunder && h.pop >= 20) && h.temp != null &&
      h.temp >= PLAYABLE.minTemp && h.temp <= PLAYABLE.maxTemp && h.wind <= PLAYABLE.maxWind;
  }

  /** NWS hourly periods, as the hours the page reasons about. */
  function toHours(periods) {
    return (periods || []).map((p) => {
      const pop = p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value != null ? p.probabilityOfPrecipitation.value : 0;
      const h = {
        start: new Date(p.startTime), end: new Date(p.endTime), temp: tempF(p.temperature), pop,
        wind: windMph(p.windSpeed), windText: p.windSpeed || '', windDir: p.windDirection || '',
        sky: p.shortForecast || '', isDaytime: !!p.isDaytime, thunder: /thunder/i.test(p.shortForecast || '')
      };
      h.key = dayKey(h.start);
      h.icon = iconFor(h);
      h.playable = isPlayable(h);
      return h;
    }).filter((h) => !isNaN(h.start) && !isNaN(h.end));
  }

  /** The hours of a day worth showing: from sunrise (or now, if it's that day) to sunset. */
  function playingHours(hours, key, now) {
    const sun = sunTimes(key);
    let from = sun.sunrise;
    if (now && dayKey(now) === key && now > from) from = now;
    return hours.filter((h) => h.key === key && h.end > from && h.start < sun.sunset);
  }

  /** The longest run of playable hours (ties go to the drier run). */
  function bestWindow(list) {
    let best = null;
    let run = [];
    const wetness = (r) => r.reduce((s, h) => s + h.pop, 0) / r.length;
    for (const h of list) {
      if (!h.playable) { run = []; continue; }
      run.push(h);
      if (!best || run.length > best.length || (run.length === best.length && wetness(run) < wetness(best))) best = run.slice();
    }
    if (!best) return null;
    return { start: best[0].start, end: best[best.length - 1].end, hours: best.length, maxPop: Math.max(...best.map((h) => h.pop)) };
  }

  /** The headline for a day, as two lines in the board's light-then-heavy style. */
  function verdict(list) {
    const n = list.length;
    if (!n) return { key: 'dark', a: "That's a", b: 'wrap.' };
    const count = (f) => list.filter(f).length;
    const playable = count((h) => h.playable);
    const storms = count((h) => h.thunder && h.pop >= 30);
    const temps = list.map((h) => h.temp).filter((t) => t != null);
    const avg = temps.reduce((s, t) => s + t, 0) / (temps.length || 1);
    const hi = Math.max(...temps);
    const win = bestWindow(list);
    if (storms >= Math.max(2, Math.ceil(n * 0.4))) return { key: 'storms', a: 'Storms', b: 'likely.' };
    if (playable === n || playable >= Math.ceil(n * 0.75)) {
      if (avg < 48) return { key: 'cold', a: 'Cold, but', b: 'playable.' };
      if (hi > PLAYABLE.maxTemp) return { key: 'hot', a: 'Hot, but', b: 'playable.' };
      return { key: 'good', a: 'A good day', b: 'to play.' };
    }
    // Three dry hours is enough for nine holes, so a window that long leads the headline
    if (!win || win.hours < 3) return { key: 'wet', a: 'A wet', b: 'one.' };
    if (win.start <= list[0].start) return { key: 'early', a: 'Play it', b: 'early.' };
    if (win.end >= list[n - 1].end) return { key: 'late', a: 'Better', b: 'later on.' };
    return { key: 'window', a: 'Pick your', b: 'window.' };
  }

  /** Green fees for a calendar day: Monday to Thursday, or Friday to Sunday. */
  function ratesFor(key) {
    const wd = local(noonOf(key)).wd;
    const weekend = wd === 5 || wd === 6 || wd === 0;
    return {
      weekend,
      eighteen: weekend ? RATES.weekend : RATES.weekday,
      nine: weekend ? RATES.nineWeekend : RATES.nineWeekday,
      twilight: RATES.twilight, nineTwilight: RATES.nineTwilight, twilightFrom: RATES.twilightFrom,
      days: weekend ? 'Friday to Sunday' : 'Monday to Thursday'
    };
  }

  /** The last tee time on the 10-minute sheet that still finishes a round of `minutes` by sunset. */
  function teeOffBy(sunset, minutes) {
    const t = sunset.getTime() - minutes * 60000;
    return new Date(Math.floor(t / 600000) * 600000);
  }

  /** The forecast's own words for a day's daytime, or null. */
  function daytimePeriod(dailyPeriods, key) {
    return (dailyPeriods || []).find((p) => p.isDaytime && dayKey(new Date(p.startTime)) === key) || null;
  }

  /** "6:36 PM", to the nearest minute as almanacs print it, with a space that never breaks. */
  const time = (d) => timeFmt.format(new Date(Math.round(d.getTime() / 60000) * 60000)).replace(/[  ]/g, ' ');

  /** The forecaster's first sentence for a day ("Patchy fog and showers and thunderstorms likely."). */
  function daySummary(period) {
    if (!period) return '';
    const first = String(period.detailedForecast || '').split(/(?<=\.)\s/)[0].trim();
    return first && first.length <= 110 ? first : (period.shortForecast || '') + '.';
  }
  const longDate = (key) => longDateFmt.format(noonOf(key));
  const weekday = (key) => weekdayFmt.format(noonOf(key));
  /** "7a", "12p": an hour's label in the chart. */
  function hourLabel(d) {
    const hh = local(d).hh;
    return (hh % 12 || 12) + (hh < 12 ? 'a' : 'p');
  }

  return {
    COURSE, BOOKING_URL, RATES, PACE, PLAYABLE,
    local, dayKey, addDays, noonOf, sunTimes, windMph, toHours, playingHours, bestWindow, verdict,
    ratesFor, teeOffBy, daytimePeriod, daySummary, time, longDate, weekday, hourLabel
  };
});
