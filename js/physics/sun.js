// sun.js — solar geometry, clear-sky irradiance, daily air/sky temperature.
// Pure JS (no three.js). Units: degrees for angles, local clock hours, W/m², °C.
// Scene coords: +x = East, +y = Up, +z = South.
//
// References
//  - NOAA Global Monitoring Laboratory, "General Solar Position Calculations" (Spencer 1971 Fourier series)
//  - Hottel (1976) clear-sky beam transmittance; Liu & Jordan (1960) diffuse; Duffie & Beckman, Solar
//    Engineering of Thermal Processes, 4th ed., §2.8
//  - Kasten & Young (1989) relative air mass
//  - Swinbank (1963) clear-sky temperature

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** Day of year 1..365 (non-leap year). */
export function dayOfYear(month, day) {
  const m = clamp(Math.round(month), 1, 12);
  return clamp(CUM_DAYS[m - 1] + Math.round(day), 1, 365);
}

// NOAA fractional-year series → declination (rad) and equation of time (minutes)
function solarSeries(doy, hour) {
  const g = (2 * Math.PI / 365) * (doy - 1 + (hour - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  return { eqTime, decl };
}

// NOAA approximate atmospheric refraction (deg) for a true elevation e (deg)
function refraction(e) {
  if (e > 85) return 0;
  const te = Math.tan(e * D2R);
  let r;
  if (e > 5) r = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (e > -0.575) r = 1735 + e * (-518.2 + e * (103.4 + e * (-12.79 + e * 0.711)));
  else r = -20.772 / te;
  return r / 3600;
}

/**
 * Solar position (NOAA). hour = local clock time (decimal), tz = UTC offset (h), lon positive East.
 * azimuth: deg clockwise from North; elevation includes refraction; dir = unit vector toward the sun.
 */
export function solarPosition({ dayOfYear: doy, hour, lat, lon, tz }) {
  const { eqTime, decl } = solarSeries(doy, hour);
  const timeOffset = eqTime + 4 * lon - 60 * tz;            // minutes
  const tst = hour * 60 + timeOffset;                        // true solar time (min)
  const ha = (tst / 4 - 180) * D2R;                          // hour angle (rad), 0 at solar noon
  const phi = lat * D2R;
  const cosZ = clamp(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha), -1, 1);
  const zenTrue = Math.acos(cosZ) * R2D;
  const elTrue = 90 - zenTrue;
  const elevation = elTrue + refraction(elTrue);
  const zenith = 90 - elevation;
  // azimuth from North, clockwise (atan2 form: robust at all hours)
  let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) * R2D + 180;
  az = ((az % 360) + 360) % 360;
  const e = elevation * D2R, a = az * D2R;
  const dir = { x: Math.cos(e) * Math.sin(a), y: Math.sin(e), z: -Math.cos(e) * Math.cos(a) };
  return { azimuth: az, elevation, zenith, declination: decl * R2D, eqTime, dir };
}

/** Relative optical air mass, Kasten & Young (1989); finite down to the horizon. */
export function airMass(elevationDeg) {
  const z = 90 - elevationDeg;
  if (elevationDeg <= 0) return 38.1;
  return 1 / (Math.cos(z * D2R) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
}

/** Extraterrestrial normal irradiance (W/m²), Spencer-type eccentricity. */
export function extraterrestrial(doy) {
  return 1367 * (1 + 0.033 * Math.cos(2 * Math.PI * doy / 365));
}

/**
 * Clear-sky irradiance: Hottel (1976) beam transmittance for a 23 km visibility, sea-level
 * (A = 0.05 km) atmosphere with mid-latitude summer↔winter climate corrections (blended by season),
 * air mass after Kasten–Young; diffuse after Liu & Jordan (τd = 0.271 − 0.294 τb).
 * clearness c scales GHI by c and the beam by c² (haze/cloud removes beam first, part of it
 * reappears as diffuse): dni = c²·dni0, ghi = c·ghi0, dhi = ghi − dni·sinEl.
 */
export function clearSkyIrradiance({ elevationDeg, dayOfYear: doy, clearness = 1 }) {
  if (!(elevationDeg > 0)) return { dni: 0, dhi: 0, ghi: 0 };
  const A = 0.05; // site altitude (km)
  const a0s = 0.4237 - 0.00821 * (6 - A) ** 2;
  const a1s = 0.5055 + 0.00595 * (6.5 - A) ** 2;
  const ks = 0.2711 + 0.01858 * (2.5 - A) ** 2;
  // climate correction factors: mid-latitude summer (0.97, 0.99, 1.02) / winter (1.03, 1.01, 1.00)
  const w = (1 - Math.cos(2 * Math.PI * (doy - 15) / 365)) / 2;   // 0 mid-Jan → 1 mid-Jul
  const r0 = 1.03 + (0.97 - 1.03) * w, r1 = 1.01 + (0.99 - 1.01) * w, rk = 1.00 + (1.02 - 1.00) * w;
  const a0 = a0s * r0, a1 = a1s * r1, k = ks * rk;
  const m = airMass(elevationDeg);
  const tb = a0 + a1 * Math.exp(-k * m);
  const td = Math.max(0, 0.271 - 0.294 * tb);
  const Gon = extraterrestrial(doy);
  const s = Math.sin(elevationDeg * D2R);
  const dni0 = Gon * tb;
  const dhi0 = Gon * s * td;
  const ghi0 = dni0 * s + dhi0;
  const c = clamp(clearness, 0, 1.1);
  const dni = dni0 * c * c;
  const ghi = ghi0 * c;
  const dhi = Math.max(0, ghi - dni * s);
  return { dni, dhi, ghi };
}

/** Sunrise / sunset / solar noon in local clock hours (NOAA, zenith 90.833° incl. refraction). */
export function sunTimes({ dayOfYear: doy, lat, lon, tz }) {
  const phi = lat * D2R;
  let noon = 12, sunrise = 6, sunset = 18;
  for (let it = 0; it < 3; it++) {
    const s0 = solarSeries(doy, noon);
    noon = (720 - 4 * lon - s0.eqTime) / 60 + tz;
    const calc = (h0) => {
      const s = solarSeries(doy, h0);
      const cosH = Math.cos(90.833 * D2R) / (Math.cos(phi) * Math.cos(s.decl)) - Math.tan(phi) * Math.tan(s.decl);
      if (cosH > 1) return null;      // polar night
      if (cosH < -1) return Infinity; // midnight sun
      const Hd = Math.acos(cosH) * R2D;
      return { Hd, n: (720 - 4 * lon - s.eqTime) / 60 + tz };
    };
    const r = calc(sunrise), t = calc(sunset);
    if (r === null || t === null) return { sunrise: NaN, sunset: NaN, solarNoon: noon };
    if (r === Infinity || t === Infinity) return { sunrise: 0, sunset: 24, solarNoon: noon };
    sunrise = r.n - r.Hd / 15;
    sunset = t.n + t.Hd / 15;
  }
  return { sunrise, sunset, solarNoon: noon };
}

/**
 * Daily air-temperature cycle: minimum at 05:30, maximum at 15:00, two half-cosines
 * (rise 9.5 h, fall 14.5 h) → continuous with zero slope at both extremes (C¹-smooth, asymmetric).
 */
export const T_MIN_HOUR = 5.5;
export const T_MAX_HOUR = 15.0;
export function ambientTemperature(hour, Tmin, Tmax) {
  let h = ((hour % 24) + 24) % 24;
  const amp = Tmax - Tmin;
  if (h >= T_MIN_HOUR && h <= T_MAX_HOUR) {
    const x = (h - T_MIN_HOUR) / (T_MAX_HOUR - T_MIN_HOUR);
    return Tmin + amp * (1 - Math.cos(Math.PI * x)) / 2;
  }
  if (h < T_MIN_HOUR) h += 24;
  const x = (h - T_MAX_HOUR) / (24 + T_MIN_HOUR - T_MAX_HOUR);
  return Tmax - amp * (1 - Math.cos(Math.PI * x)) / 2;
}

/**
 * Effective clear-sky temperature (°C).
 *  - skyTemperature(Ta)       → Swinbank (1963): Tsky = 0.0552·Ta^1.5 (K)
 *  - skyTemperature(Ta, Tdp)  → Berdahl & Martin (1984): ε = 0.711 + 0.56(Tdp/100) + 0.73(Tdp/100)², Tsky = ε^¼·Ta
 */
export function skyTemperature(TaC, TdpC) {
  const TaK = TaC + 273.15;
  if (Number.isFinite(TdpC)) {
    const t = TdpC / 100;
    const eps = clamp(0.711 + 0.56 * t + 0.73 * t * t, 0.5, 1);
    return TaK * Math.pow(eps, 0.25) - 273.15;
  }
  return 0.0552 * Math.pow(TaK, 1.5) - 273.15;
}

/** Sun path for the day (only above-horizon points, sunrise/sunset endpoints included). */
export function sunPath({ dayOfYear: doy, lat, lon, tz, stepMin = 10 }) {
  const pts = [];
  const push = (h) => {
    const p = solarPosition({ dayOfYear: doy, hour: h, lat, lon, tz });
    pts.push({ hour: h, dir: p.dir, elevation: p.elevation, azimuth: p.azimuth });
  };
  const t = sunTimes({ dayOfYear: doy, lat, lon, tz });
  const step = Math.max(1, stepMin) / 60;
  if (Number.isFinite(t.sunrise) && t.sunrise > 0) push(t.sunrise);
  for (let h = 0; h <= 24 + 1e-9; h += step) {
    if (Number.isFinite(t.sunrise) && (h <= t.sunrise || h >= t.sunset)) continue;
    const p = solarPosition({ dayOfYear: doy, hour: h, lat, lon, tz });
    if (p.elevation < 0) continue;
    pts.push({ hour: h, dir: p.dir, elevation: p.elevation, azimuth: p.azimuth });
  }
  if (Number.isFinite(t.sunset) && t.sunset < 24) push(t.sunset);
  return pts;
}
