// Tests for today-core.js. Run: node --test prototype/today/test-core.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const core = require('./today-core.js');

const at = (iso) => new Date(iso);
const hhmm = (d) => core.time(d).replace(' ', ' ');

test('sunrise and sunset at the course match NOAA', () => {
  // Same equations as the canvas pass that set Today's sunset; Central time, daylight saving in force
  let s = core.sunTimes('2026-09-23');
  assert.strictEqual(hhmm(s.sunrise), '6:29 AM');
  assert.strictEqual(hhmm(s.sunset), '6:36 PM');
  s = core.sunTimes('2026-10-07');
  assert.strictEqual(hhmm(s.sunrise), '6:40 AM');
  assert.strictEqual(hhmm(s.sunset), '6:16 PM');
});

test('days are counted in the course time zone, not the device one', () => {
  assert.strictEqual(core.dayKey(at('2026-10-02T23:30:00-05:00')), '2026-10-02');
  assert.strictEqual(core.dayKey(at('2026-10-03T00:30:00-05:00')), '2026-10-03');
  assert.strictEqual(core.dayKey(at('2026-10-03T04:30:00Z')), '2026-10-02');
  assert.strictEqual(core.addDays('2026-10-31', 1), '2026-11-01');
  assert.strictEqual(core.weekday('2026-10-03'), 'Saturday');
});

test('wind strings give their strongest number', () => {
  assert.strictEqual(core.windMph('0 mph'), 0);
  assert.strictEqual(core.windMph('5 to 10 mph'), 10);
  assert.strictEqual(core.windMph(''), 0);
});

test('green fees follow the booking page: $45 Monday to Thursday, $57 Friday to Sunday', () => {
  assert.strictEqual(core.ratesFor('2026-10-01').eighteen, 45); // Thursday
  assert.strictEqual(core.ratesFor('2026-10-02').eighteen, 57); // Friday
  assert.strictEqual(core.ratesFor('2026-10-04').eighteen, 57); // Sunday
  assert.strictEqual(core.ratesFor('2026-10-05').eighteen, 45); // Monday
  assert.strictEqual(core.ratesFor('2026-10-05').twilight, 35);
});

test('tee-off-by lands on the 10-minute sheet before sunset', () => {
  const { sunset } = core.sunTimes('2026-10-07'); // 6:16 PM
  assert.strictEqual(hhmm(core.teeOffBy(sunset, core.PACE.eighteen)), '2:00 PM');
  assert.strictEqual(hhmm(core.teeOffBy(sunset, core.PACE.nine)), '4:00 PM');
});

// Synthetic days: 7 AM to 6 PM, one NWS-shaped period per hour
function day(spec) {
  return core.toHours(spec.map((s, i) => {
    const h = 7 + i;
    return {
      startTime: '2026-10-07T' + String(h).padStart(2, '0') + ':00:00-05:00',
      endTime: '2026-10-07T' + String(h + 1).padStart(2, '0') + ':00:00-05:00',
      isDaytime: true, temperature: s.t == null ? 68 : s.t,
      probabilityOfPrecipitation: { value: s.p || 0 }, windSpeed: (s.w || 5) + ' mph', windDirection: 'SW',
      shortForecast: s.f || (s.p >= 30 ? 'Chance Rain Showers' : 'Sunny')
    };
  }));
}
const dry = (n, t) => Array.from({ length: n }, () => ({ t }));
const wet = (n) => Array.from({ length: n }, () => ({ p: 70 }));

test('the headline reads the day honestly', () => {
  assert.strictEqual(core.verdict(day(dry(11))).key, 'good');
  assert.strictEqual(core.verdict(day(dry(11, 44))).key, 'cold');
  assert.strictEqual(core.verdict(day([...dry(5), ...wet(6)])).key, 'early');
  assert.strictEqual(core.verdict(day([...wet(6), ...dry(5)])).key, 'late');
  assert.strictEqual(core.verdict(day([...wet(4), ...dry(3), ...wet(4)])).key, 'window');
  assert.strictEqual(core.verdict(day(wet(11))).key, 'wet');
  const storms = Array.from({ length: 11 }, () => ({ p: 60, f: 'Showers And Thunderstorms Likely' }));
  assert.strictEqual(core.verdict(day(storms)).key, 'storms');
  assert.strictEqual(core.verdict([]).key, 'dark');
});

test('the best window is the longest dry run', () => {
  const w = core.bestWindow(day([...wet(2), ...dry(4), ...wet(1), ...dry(2), ...wet(2)]));
  assert.strictEqual(w.hours, 4);
  assert.strictEqual(hhmm(w.start), '9:00 AM');
  assert.strictEqual(hhmm(w.end), '1:00 PM');
});

test('later in the day, only the hours still ahead count, up to sunset', () => {
  const hours = day(dry(13)); // 7 AM to 8 PM
  const list = core.playingHours(hours, '2026-10-07', at('2026-10-07T09:20:00-05:00'));
  assert.strictEqual(core.hourLabel(list[0].start), '9a');
  assert.strictEqual(core.hourLabel(list[list.length - 1].start), '6p'); // the 6 PM hour runs into the 6:16 sunset; 7 PM is dark
});

test('a real forecast parses: the NWS hourly feed for the course, saved October 2, 2026', () => {
  const fx = require(path.join(__dirname, 'fixtures', 'nws-2026-10-02-2300.json'));
  const hours = core.toHours(fx.hourly);
  assert.strictEqual(hours.length, 156);
  const sat = core.playingHours(hours, '2026-10-03', at('2026-10-02T23:00:00-05:00'));
  assert.ok(sat.length >= 11 && sat.length <= 13, 'Saturday has a full day of daylight hours');
  const v = core.verdict(sat);
  const w = core.bestWindow(sat);
  const p = core.daytimePeriod(fx.daily, '2026-10-03');
  console.log('  Saturday, from the saved forecast:', v.a, v.b, '|', p && p.shortForecast, '| best window',
    w ? hhmm(w.start) + ' to ' + hhmm(w.end) : 'none',
    '\n  ' + sat.map((h) => core.hourLabel(h.start) + ' ' + h.temp + '° ' + h.pop + '% ' + h.icon).join(' · '));
  assert.ok(['storms', 'wet', 'early', 'late', 'window', 'good', 'cold', 'hot'].includes(v.key));
});

test('the day summary is the forecaster\'s first sentence', () => {
  const fx = require(path.join(__dirname, 'fixtures', 'nws-2026-10-02-2300.json'));
  const s = core.daySummary(core.daytimePeriod(fx.daily, '2026-10-03'));
  console.log('  Saturday summary:', s);
  assert.ok(s.endsWith('.') && s.length > 10 && s.length <= 110);
});
