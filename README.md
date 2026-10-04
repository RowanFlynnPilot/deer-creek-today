# Today at Deer Creek (prototype)

A working prototype of a "Today" page for Deer Creek Golf Club in Crossville, Tennessee, built by Rowan Flynn. **It is not the club's website.** To book a round, use the club's [booking page](https://foreupsoftware.com/index.php/booking/22536/11099) or call (931) 710-0371.

**Live:** https://rowanflynnpilot.github.io/deer-creek-today/

## What it shows

| On the page | Where it comes from |
|---|---|
| The day's headline, hour-by-hour temperature and chance of rain, wind, and the best dry window | The [National Weather Service](https://www.weather.gov/ohx/) forecast for the course's own grid square (Nashville office, OHX 114,54), read in the browser and refreshed every 30 minutes |
| Sunrise, sunset, and the last tee time to finish 18 or nine holes in daylight | Calculated on the page for 445 Deer Creek Dr, using NOAA's solar equations |
| Green fees for the chosen day | The club's booking page as listed on September 30, 2026: $45 Monday to Thursday, $57 Friday to Sunday, $35 from 2:30 PM. Nine holes: $27, $35 and $25 |
| Booking | The club's own booking page |

It doesn't show open tee times. If the weather service is slow or down, the page shows the last forecast saved on that device and says when it was saved, or says the forecast is unavailable. Every time on the page is Central time.

## Run it locally

```bash
python -m http.server 5181 --bind 127.0.0.1
```

Then open http://127.0.0.1:5181/.

## Tests

```bash
node --test test-core.js
```

The tests cover the logic: sun times, day boundaries, green fees, tee-off-by times, the headline and the best window. They use made-up days and one real forecast saved in `fixtures/`.

For checking the page in a browser, add one of these to the address:
- `?now=2026-10-03T10:20:00-05:00` pins the clock
- `?offline` skips the weather service
- `?fixture` reads the saved forecast

## Credits

Forecast data: National Weather Service. The Deer Creek logo belongs to Deer Creek Golf Club. Type: Jost, from Google Fonts.
