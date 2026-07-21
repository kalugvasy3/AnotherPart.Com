/**
 * Geocentric positions of the Moon and the five naked-eye planets
 * (Vasily, 2026-07-08: «Луна и пять основных планет»).
 *
 * Self-written from the classic Paul Schlyter / Meeus formulas ("How to
 * compute planetary positions") — Keplerian elements linear in time,
 * plus the major lunar perturbation terms. Accuracy: a few arc minutes
 * for planets, ~2 arc minutes for the Moon — far beyond what the eye
 * needs on the sky dome. No third-party code (MIT-clean by authorship).
 *
 * Output is RA/Dec in DEGREES — the same currency the star catalog and
 * SunPosition.directionFromRaDec() already speak.
 */

export interface SolarBodySky {
  id:
    | 'moon'
    | 'mercury'
    | 'venus'
    | 'mars'
    | 'jupiter'
    | 'saturn'
    // Galilean moons ride the same tooltip/card machinery.
    | 'io'
    | 'europa'
    | 'ganymede'
    | 'callisto';
  name: string;
  raDeg: number;
  decDeg: number;
  /** Human-readable distance: km for the Moon, AU for planets. */
  distanceLabel: string;
  /** TRUE apparent angular radius, degrees (Vasily, 2026-07-09: the
   *  Moon and the Sun must match their real ~0.25° — that is what
   *  makes total eclipses possible — and zooming in must magnify
   *  honestly). */
  angularRadiusDeg: number;
  /** Moon only: 0..1 of the disc lit. */
  illuminatedFraction?: number;
  /** Moon only: growing toward full? */
  waxing?: boolean;
  /** Moon only: 'Waxing crescent' … for the tooltip. */
  phaseName?: string;
  /** Moon only: the Earth's shadow, when the Moon is inside it. */
  eclipse?: LunarEclipseInfo;
  /** Saturn only: ring opening angle as seen from Earth, degrees
   *  (Meeus B): ~0° = edge-on needle (ring-plane crossing was March
   *  2025, so 2026 shows a THIN ring — honest and checkable). */
  ringTiltDeg?: number;
  /** Direction FROM the Sun TO the body (equatorial RA/Dec of that
   *  vector) — the honest illumination direction for 3D spheres.
   *  Parallel Earth→Sun rays are WRONG for other bodies: Venus showed
   *  a crescent while really gibbous, Jupiter near conjunction went
   *  black (Vasily, 2026-07-09). */
  sunDirRaDeg?: number;
  sunDirDecDeg?: number;
}

/** Earth's shadow at the Moon (Vasily, 2026-07-08: «тень Земли на
 *  Луне»). All angles in DEGREES, geocentric. */
export interface LunarEclipseInfo {
  kind: 'penumbral' | 'partial' | 'total';
  /** Angular separation Moon-center ↔ shadow-center. */
  separationDeg: number;
  umbraRadiusDeg: number;
  penumbraRadiusDeg: number;
  moonRadiusDeg: number;
  /** Direction from the Moon's center to the shadow's center in the
   *  (lon, lat) plane — for drawing the bite on the disc. */
  bearingRad: number;
}

const DEG = Math.PI / 180;

function rev(deg: number): number {
  const r = deg % 360;

  return r < 0 ? r + 360 : r;
}

/** Eccentric anomaly from Kepler's equation (degrees in/out). */
function eccentricAnomaly(mDeg: number, e: number): number {
  const m = rev(mDeg) * DEG;
  let ecc = m + e * Math.sin(m) * (1 + e * Math.cos(m));

  for (let iteration = 0; iteration < 8; iteration++) {
    const delta =
      (ecc - e * Math.sin(ecc) - m) / (1 - e * Math.cos(ecc));

    ecc -= delta;

    if (Math.abs(delta) < 1e-8) {
      break;
    }
  }

  return ecc;
}

interface Elements {
  N: number; // longitude of ascending node
  i: number; // inclination
  w: number; // argument of perihelion
  a: number; // semi-major axis (AU; Earth radii for the Moon)
  e: number; // eccentricity
  M: number; // mean anomaly
}

/** Heliocentric (geocentric for the Moon) ecliptic rectangular coords. */
function eclipticCoords(el: Elements): { x: number; y: number; z: number; r: number; v: number } {
  const E = eccentricAnomaly(el.M, el.e);
  const xv = el.a * (Math.cos(E) - el.e);
  const yv = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  const r = Math.sqrt(xv * xv + yv * yv);

  const N = rev(el.N) * DEG;
  const i = el.i * DEG;
  const vw = v + rev(el.w) * DEG;

  return {
    x: r * (Math.cos(N) * Math.cos(vw) - Math.sin(N) * Math.sin(vw) * Math.cos(i)),
    y: r * (Math.sin(N) * Math.cos(vw) + Math.cos(N) * Math.sin(vw) * Math.cos(i)),
    z: r * Math.sin(vw) * Math.sin(i),
    r,
    v
  };
}

/** Ecliptic rectangular → RA/Dec degrees. */
function toEquatorial(
  x: number,
  y: number,
  z: number,
  eclDeg: number
): { raDeg: number; decDeg: number } {
  const ecl = eclDeg * DEG;
  const xe = x;
  const ye = y * Math.cos(ecl) - z * Math.sin(ecl);
  const ze = y * Math.sin(ecl) + z * Math.cos(ecl);

  return {
    raDeg: rev(Math.atan2(ye, xe) / DEG),
    decDeg: Math.atan2(ze, Math.sqrt(xe * xe + ye * ye)) / DEG
  };
}

function moonPhaseName(k: number, waxing: boolean): string {
  if (k < 0.03) {
    return 'New Moon';
  }

  if (k > 0.97) {
    return 'Full Moon';
  }

  if (Math.abs(k - 0.5) < 0.04) {
    return waxing ? 'First quarter' : 'Last quarter';
  }

  if (k < 0.5) {
    return waxing ? 'Waxing crescent' : 'Waning crescent';
  }

  return waxing ? 'Waxing gibbous' : 'Waning gibbous';
}

// ---- Solar eclipse track on the Earth (Vasily, 2026-07-08: «полоса
//      затмения по земле») -------------------------------------------
//
// Honest cone geometry instead of Besselian elements: at each sampled
// moment take the geocentric equatorial positions of the Sun and the
// Moon in km, shoot the shadow axis Sun→Moon onward, intersect it with
// the Earth sphere, and convert the hit to geographic lat/lon via GMST.
// Total vs annular from the apparent radii AT the hit point.

export interface SolarEclipsePoint {
  latDeg: number;
  lonDeg: number;
  kind: 'total' | 'annular';
  /** Minutes relative to the reference date (for future tooltips). */
  minutesFromNow: number;
}

export interface SolarEclipseTrack {
  points: SolarEclipsePoint[];
  /** The umbra is on the Earth RIGHT NOW. */
  activeNow: boolean;
}

const AU_KM = 149597870.7;
const EARTH_RADIUS_KM = 6371;
const SUN_RADIUS_KM = 696000;
const MOON_RADIUS_KM = 1737.4;

/** Greenwich mean sidereal time, degrees. */
function gmstDeg(jd: number): number {
  return rev(280.46061837 + 360.98564736629 * (jd - 2451545.0));
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function eclToEq(v: Vec3, eclDeg: number): Vec3 {
  const ecl = eclDeg * DEG;

  return {
    x: v.x,
    y: v.y * Math.cos(ecl) - v.z * Math.sin(ecl),
    z: v.y * Math.sin(ecl) + v.z * Math.cos(ecl)
  };
}

/** Geocentric equatorial positions of the Sun and the Moon, km. */
function sunMoonEquatorialKm(d: number): { sun: Vec3; moon: Vec3 } {
  const ecl = 23.4393 - 3.563e-7 * d;

  const sunW = 282.9404 + 4.70935e-5 * d;
  const sunE = 0.016709 - 1.151e-9 * d;
  const sunM = 356.047 + 0.9856002585 * d;
  const sunEcc = eccentricAnomaly(sunM, sunE);
  const sunXv = Math.cos(sunEcc) - sunE;
  const sunYv = Math.sqrt(1 - sunE * sunE) * Math.sin(sunEcc);
  const sunV = Math.atan2(sunYv, sunXv);
  const sunR = Math.sqrt(sunXv * sunXv + sunYv * sunYv);
  const sunLon = sunV + rev(sunW) * DEG;

  const sunEcl: Vec3 = {
    x: sunR * Math.cos(sunLon) * AU_KM,
    y: sunR * Math.sin(sunLon) * AU_KM,
    z: 0
  };

  // Moon with the same perturbation set as computeSolarSystemSky.
  const N = 125.1228 - 0.0529538083 * d;
  const i = 5.1454;
  const w = 318.0634 + 0.1643573223 * d;
  const a = 60.2666;
  const e = 0.0549;
  const M = 115.3654 + 13.0649929509 * d;
  const raw = eclipticCoords({ N, i, w, a, e, M });

  let lon = Math.atan2(raw.y, raw.x) / DEG;
  let lat =
    Math.atan2(raw.z, Math.sqrt(raw.x * raw.x + raw.y * raw.y)) / DEG;
  let r = raw.r;

  const Ms = rev(sunM);
  const Mm = rev(M);
  const Ls = rev(sunM + sunW);
  const Lm = rev(M + w + N);
  const D = rev(Lm - Ls);
  const F = rev(Lm - N);
  const s = (deg: number): number => Math.sin(deg * DEG);
  const c = (deg: number): number => Math.cos(deg * DEG);

  lon +=
    -1.274 * s(Mm - 2 * D) +
    0.658 * s(2 * D) -
    0.186 * s(Ms) -
    0.059 * s(2 * Mm - 2 * D) -
    0.057 * s(Mm - 2 * D + Ms) +
    0.053 * s(Mm + 2 * D) +
    0.046 * s(2 * D - Ms) +
    0.041 * s(Mm - Ms) -
    0.035 * s(D) -
    0.031 * s(Mm + Ms);
  lat +=
    -0.173 * s(F - 2 * D) -
    0.055 * s(Mm - F - 2 * D) -
    0.046 * s(Mm + F - 2 * D) +
    0.033 * s(F + 2 * D) +
    0.017 * s(2 * Mm + F);
  r += -0.58 * c(Mm - 2 * D) - 0.46 * c(2 * D);

  const cosLat = Math.cos(lat * DEG);
  const moonEcl: Vec3 = {
    x: r * Math.cos(lon * DEG) * cosLat * EARTH_RADIUS_KM,
    y: r * Math.sin(lon * DEG) * cosLat * EARTH_RADIUS_KM,
    z: r * Math.sin(lat * DEG) * EARTH_RADIUS_KM
  };

  return { sun: eclToEq(sunEcl, ecl), moon: eclToEq(moonEcl, ecl) };
}

/** The umbra/antumbra ground point at one moment, or null. */
function shadowGroundPoint(
  jd: number
): { latDeg: number; lonDeg: number; kind: 'total' | 'annular' } | null {
  const d = jd - 2451543.5;
  const { sun, moon } = sunMoonEquatorialKm(d);

  const axis: Vec3 = {
    x: moon.x - sun.x,
    y: moon.y - sun.y,
    z: moon.z - sun.z
  };
  const axisLen = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const dir: Vec3 = {
    x: axis.x / axisLen,
    y: axis.y / axisLen,
    z: axis.z / axisLen
  };

  // |moon + k·dir|² = R²  →  k² + 2bk + c = 0.
  const b = moon.x * dir.x + moon.y * dir.y + moon.z * dir.z;
  const cTerm =
    moon.x * moon.x +
    moon.y * moon.y +
    moon.z * moon.z -
    EARTH_RADIUS_KM * EARTH_RADIUS_KM;
  const disc = b * b - cTerm;

  if (disc < 0) {
    return null;
  }

  const k = -b - Math.sqrt(disc);

  if (k <= 0) {
    return null;
  }

  const hit: Vec3 = {
    x: moon.x + k * dir.x,
    y: moon.y + k * dir.y,
    z: moon.z + k * dir.z
  };

  // Apparent radii from the hit point: total when the Moon covers the Sun.
  const distSun = Math.hypot(
    sun.x - hit.x,
    sun.y - hit.y,
    sun.z - hit.z
  );
  const distMoon = Math.hypot(
    moon.x - hit.x,
    moon.y - hit.y,
    moon.z - hit.z
  );
  const sunAppRad = Math.asin(SUN_RADIUS_KM / distSun);
  const moonAppRad = Math.asin(MOON_RADIUS_KM / distMoon);

  const latDeg = Math.asin(hit.z / EARTH_RADIUS_KM) / DEG;
  const raDeg = rev(Math.atan2(hit.y, hit.x) / DEG);
  let lonDeg = raDeg - gmstDeg(jd);

  lonDeg = ((lonDeg + 540) % 360) - 180;

  return {
    latDeg,
    lonDeg,
    kind: moonAppRad >= sunAppRad ? 'total' : 'annular'
  };
}

export function computeSolarEclipseTrack(
  date: Date,
  windowHours: number = 12,
  stepMinutes: number = 3
): SolarEclipseTrack {
  const jdNow = date.getTime() / 86400000 + 2440587.5;
  const points: SolarEclipsePoint[] = [];
  const steps = Math.round((windowHours * 60) / stepMinutes);

  for (let step = -steps; step <= steps; step++) {
    const minutes = step * stepMinutes;
    const hit = shadowGroundPoint(jdNow + minutes / 1440);

    if (hit) {
      points.push({ ...hit, minutesFromNow: minutes });
    }
  }

  return {
    points,
    activeNow: shadowGroundPoint(jdNow) !== null
  };
}

export function computeSolarSystemSky(date: Date): SolarBodySky[] {
  // Days from the Schlyter epoch (2000 Jan 0.0 TT ≈ J2000 - 1.5d).
  const jd = date.getTime() / 86400000 + 2440587.5;
  const d = jd - 2451543.5;

  const ecl = 23.4393 - 3.563e-7 * d;

  // ---- Sun (i.e. Earth) ----
  const sunW = 282.9404 + 4.70935e-5 * d;
  const sunE = 0.016709 - 1.151e-9 * d;
  const sunM = 356.047 + 0.9856002585 * d;

  const sunEcc = eccentricAnomaly(sunM, sunE);
  const sunXv = Math.cos(sunEcc) - sunE;
  const sunYv = Math.sqrt(1 - sunE * sunE) * Math.sin(sunEcc);
  const sunV = Math.atan2(sunYv, sunXv);
  const sunR = Math.sqrt(sunXv * sunXv + sunYv * sunYv);
  const sunLon = sunV + rev(sunW) * DEG; // geocentric ecliptic longitude
  const sunX = sunR * Math.cos(sunLon);
  const sunY = sunR * Math.sin(sunLon);

  const bodies: SolarBodySky[] = [];

  // ---- Moon (geocentric already; a in Earth radii) ----
  {
    const N = 125.1228 - 0.0529538083 * d;
    const i = 5.1454;
    const w = 318.0634 + 0.1643573223 * d;
    const a = 60.2666;
    const e = 0.0549;
    const M = 115.3654 + 13.0649929509 * d;

    const raw = eclipticCoords({ N, i, w, a, e, M });

    let lon = Math.atan2(raw.y, raw.x) / DEG;
    let lat =
      Math.atan2(raw.z, Math.sqrt(raw.x * raw.x + raw.y * raw.y)) / DEG;
    let r = raw.r;

    // Major perturbations (Schlyter): evection, variation, yearly
    // equation and friends — degrees.
    const Ms = rev(sunM);
    const Mm = rev(M);
    const Ls = rev(sunM + sunW);
    const Lm = rev(M + w + N);
    const D = rev(Lm - Ls);
    const F = rev(Lm - N);
    const s = (deg: number): number => Math.sin(deg * DEG);
    const c = (deg: number): number => Math.cos(deg * DEG);

    lon +=
      -1.274 * s(Mm - 2 * D) +
      0.658 * s(2 * D) -
      0.186 * s(Ms) -
      0.059 * s(2 * Mm - 2 * D) -
      0.057 * s(Mm - 2 * D + Ms) +
      0.053 * s(Mm + 2 * D) +
      0.046 * s(2 * D - Ms) +
      0.041 * s(Mm - Ms) -
      0.035 * s(D) -
      0.031 * s(Mm + Ms);
    lat +=
      -0.173 * s(F - 2 * D) -
      0.055 * s(Mm - F - 2 * D) -
      0.046 * s(Mm + F - 2 * D) +
      0.033 * s(F + 2 * D) +
      0.017 * s(2 * Mm + F);
    r += -0.58 * c(Mm - 2 * D) - 0.46 * c(2 * D);

    const cosLat = Math.cos(lat * DEG);
    const x = r * Math.cos(lon * DEG) * cosLat;
    const y = r * Math.sin(lon * DEG) * cosLat;
    const z = r * Math.sin(lat * DEG);
    const eq = toEquatorial(x, y, z, ecl);

    // Phase: elongation Moon–Sun in ecliptic coords → lit fraction.
    const elongation = Math.acos(
      Math.cos((lon - sunLon / DEG) * DEG) * cosLat
    );
    const k = (1 - Math.cos(elongation)) / 2;
    const waxing = Math.sin((lon - sunLon / DEG) * DEG) > 0;

    // ---- Earth's shadow (lunar eclipse) ----
    // Shadow center = the antisolar point; radii from the parallaxes
    // (classic Meeus approximations, ×1.02 for the atmosphere).
    const moonParallaxDeg = Math.asin(1 / r) / DEG;
    const moonRadiusDeg = 0.2725 * moonParallaxDeg;
    const sunRadiusDeg = 0.266563 / sunR;
    const sunParallaxDeg = 0.0024428 / sunR;
    const umbraRadiusDeg =
      1.02 * (moonParallaxDeg + sunParallaxDeg - sunRadiusDeg);
    const penumbraRadiusDeg =
      1.02 * (moonParallaxDeg + sunParallaxDeg + sunRadiusDeg);

    const sunLonDeg = sunLon / DEG;
    const dLon =
      ((lon - (sunLonDeg + 180) + 540) % 360) - 180; // shortest arc
    const separationDeg =
      Math.acos(
        Math.min(1, Math.max(-1, Math.cos(dLon * DEG) * cosLat))
      ) / DEG;

    let eclipse: LunarEclipseInfo | undefined;

    if (separationDeg < penumbraRadiusDeg + moonRadiusDeg) {
      const kind: LunarEclipseInfo['kind'] =
        separationDeg < umbraRadiusDeg - moonRadiusDeg
          ? 'total'
          : separationDeg < umbraRadiusDeg + moonRadiusDeg
            ? 'partial'
            : 'penumbral';

      eclipse = {
        kind,
        separationDeg,
        umbraRadiusDeg,
        penumbraRadiusDeg,
        moonRadiusDeg,
        // From the Moon toward the shadow center: Δlon shrinks with
        // cos(lat), the shadow sits at ecliptic latitude 0.
        bearingRad: Math.atan2(-lat, -dLon * cosLat)
      };
    }

    // Honest illumination: Sun→Moon, ecliptic AU (the Moon's x,y,z are
    // in Earth radii — a whisper against the Sun's 1 AU, but exact).
    const earthRadiusAu = 6371 / AU_KM;
    const moonSunDir = toEquatorial(
      x * earthRadiusAu - sunR * Math.cos(sunLon),
      y * earthRadiusAu - sunR * Math.sin(sunLon),
      z * earthRadiusAu,
      ecl
    );

    bodies.push({
      id: 'moon',
      name: 'Moon',
      raDeg: eq.raDeg,
      decDeg: eq.decDeg,
      distanceLabel: `${Math.round(r * 6371).toLocaleString('en-US')} km`,
      angularRadiusDeg: moonRadiusDeg,
      illuminatedFraction: k,
      waxing,
      phaseName: moonPhaseName(k, waxing),
      eclipse,
      sunDirRaDeg: moonSunDir.raDeg,
      sunDirDecDeg: moonSunDir.decDeg
    });
  }

  // ---- The five naked-eye planets ----
  const planetElements: {
    id: SolarBodySky['id'];
    name: string;
    radiusKm: number;
    el: Elements;
  }[] = [
    {
      id: 'mercury',
      name: 'Mercury',
      radiusKm: 2439.7,
      el: {
        N: 48.3313 + 3.24587e-5 * d,
        i: 7.0047 + 5.0e-8 * d,
        w: 29.1241 + 1.01444e-5 * d,
        a: 0.387098,
        e: 0.205635 + 5.59e-10 * d,
        M: 168.6562 + 4.0923344368 * d
      }
    },
    {
      id: 'venus',
      name: 'Venus',
      radiusKm: 6051.8,
      el: {
        N: 76.6799 + 2.4659e-5 * d,
        i: 3.3946 + 2.75e-8 * d,
        w: 54.891 + 1.38374e-5 * d,
        a: 0.72333,
        e: 0.006773 - 1.302e-9 * d,
        M: 48.0052 + 1.6021302244 * d
      }
    },
    {
      id: 'mars',
      name: 'Mars',
      radiusKm: 3389.5,
      el: {
        N: 49.5574 + 2.11081e-5 * d,
        i: 1.8497 - 1.78e-8 * d,
        w: 286.5016 + 2.92961e-5 * d,
        a: 1.523688,
        e: 0.093405 + 2.516e-9 * d,
        M: 18.6021 + 0.5240207766 * d
      }
    },
    {
      id: 'jupiter',
      name: 'Jupiter',
      radiusKm: 69911,
      el: {
        N: 100.4542 + 2.76854e-5 * d,
        i: 1.303 - 1.557e-7 * d,
        w: 273.8777 + 1.64505e-5 * d,
        a: 5.20256,
        e: 0.048498 + 4.469e-9 * d,
        M: 19.895 + 0.0830853001 * d
      }
    },
    {
      id: 'saturn',
      name: 'Saturn',
      radiusKm: 58232,
      el: {
        N: 113.6634 + 2.3898e-5 * d,
        i: 2.4886 - 1.081e-7 * d,
        w: 339.3939 + 2.97661e-5 * d,
        a: 9.55475,
        e: 0.055546 - 9.499e-9 * d,
        M: 316.967 + 0.0334442282 * d
      }
    }
  ];

  for (const planet of planetElements) {
    const h = eclipticCoords(planet.el);
    const xg = h.x + sunX;
    const yg = h.y + sunY;
    const zg = h.z;
    const eq = toEquatorial(xg, yg, zg, ecl);
    const distance = Math.sqrt(xg * xg + yg * yg + zg * zg);
    // Sun→planet = the heliocentric position vector itself.
    const planetSunDir = toEquatorial(h.x, h.y, h.z, ecl);

    const body: SolarBodySky = {
      id: planet.id,
      name: planet.name,
      sunDirRaDeg: planetSunDir.raDeg,
      sunDirDecDeg: planetSunDir.decDeg,
      raDeg: eq.raDeg,
      decDeg: eq.decDeg,
      distanceLabel: `${distance.toFixed(2)} AU`,
      angularRadiusDeg:
        Math.asin(planet.radiusKm / (distance * AU_KM)) / DEG
    };

    if (planet.id === 'saturn') {
      // Ring opening (Meeus): B from the geocentric ecliptic position
      // and the ring-plane pole (i = 28.075°, Ω = 169.508°, J2000).
      const lambda = Math.atan2(yg, xg);
      const beta = Math.atan2(zg, Math.sqrt(xg * xg + yg * yg));
      const ringI = 28.075 * DEG;
      const ringNode = 169.508 * DEG;

      body.ringTiltDeg =
        Math.asin(
          Math.sin(ringI) * Math.cos(beta) * Math.sin(lambda - ringNode) -
            Math.cos(ringI) * Math.sin(beta)
        ) / DEG;
    }

    bodies.push(body);
  }

  return bodies;
}

// ---- GALILEAN MOONS (Vasily, 2026-07-09: «сайт можно будет использовать
//      в школах на уроке астрономии… вопрос про Галилеевы спутники»).
//      Self-written from Meeus, Astronomical Algorithms ch. 44 (the
//      lower-accuracy method): apparent X/Y offsets of Io, Europa,
//      Ganymede and Callisto from Jupiter's center, in Jupiter
//      equatorial radii. X runs along Jupiter's equator (the line the
//      moons dance on), Y is the small offset across it. Accuracy is
//      ~0.1 Jupiter radius — plenty for the school-lesson picture.
//      Verified against JPL Horizons (see PROJECT_CONTEXT). ----

export interface GalileanMoonSky {
  id: 'io' | 'europa' | 'ganymede' | 'callisto';
  name: string;
  /** Offset along Jupiter's equator, Jupiter radii. POSITIVE = WEST
   *  (verified against JPL Horizons 2026-07-09: |r| agrees to 0.02 R_J,
   *  Meeus' X sign is opposite to the east-positive sky offset). */
  xJupiterRadii: number;
  /** Offset across the equator line, Jupiter radii. */
  yJupiterRadii: number;
  /** Same as Jupiter's distance for any human purpose. */
  distanceLabel: string;
  /** TRUE apparent angular radius, degrees (0.2–0.8 arcsec). */
  angularRadiusDeg: number;
}

const GALILEAN_RADII_KM = {
  io: 1821.6,
  europa: 1560.8,
  ganymede: 2631.2,
  callisto: 2410.3
} as const;

export function computeGalileanMoons(date: Date): GalileanMoonSky[] {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const d = jd - 2451545.0;

  const V = (172.74 + 0.00111588 * d) * DEG; // Long-period term.
  const M = (357.529 + 0.9856003 * d) * DEG; // Sun mean anomaly.
  const N = (20.02 + 0.0830853 * d + 0.329 * Math.sin(V)) * DEG; // Jupiter.
  const J = (66.115 + 0.9025179 * d - 0.329 * Math.sin(V)) * DEG;

  const A = (1.915 * Math.sin(M) + 0.02 * Math.sin(2 * M)) * DEG;
  const B = (5.555 * Math.sin(N) + 0.168 * Math.sin(2 * N)) * DEG;
  const K = J + A - B;

  const R = 1.00014 - 0.01671 * Math.cos(M) - 0.00014 * Math.cos(2 * M);
  const r = 5.20872 - 0.25208 * Math.cos(N) - 0.00611 * Math.cos(2 * N);
  const delta = Math.sqrt(r * r + R * R - 2 * r * R * Math.cos(K));

  const psi = Math.asin(Math.min(1, Math.max(-1, (R / delta) * Math.sin(K))));

  // Planetocentric declination of the Earth — tilts the moons' line.
  const lambda = (34.35 + 0.083091 * d + 0.329 * Math.sin(V)) * DEG + B;
  const Ds = 3.12 * DEG * Math.sin(lambda + 42.8 * DEG);
  const Dx =
    2.22 * DEG * Math.sin(psi) * Math.cos(lambda + 22 * DEG);
  const Dy =
    1.3 * DEG * ((r - delta) / delta) * Math.sin(lambda - 100.5 * DEG);
  const De = Ds - Dx - Dy;

  // Light-time corrected day count.
  const t = d - delta / 173;
  const psiB = (psi - B) / DEG;

  let u1 = rev(163.8069 + 203.4058646 * t + psiB);
  let u2 = rev(358.414 + 101.2916335 * t + psiB);
  let u3 = rev(5.7176 + 50.234518 * t + psiB);
  let u4 = rev(224.8092 + 21.48798 * t + psiB);

  const G = rev(331.18 + 50.310482 * t);
  const H = rev(87.45 + 21.569231 * t);

  // Meeus' perturbation corrections (degrees).
  u1 += 0.473 * Math.sin(2 * (u1 - u2) * DEG);
  u2 += 1.065 * Math.sin(2 * (u2 - u3) * DEG);
  u3 += 0.165 * Math.sin(G * DEG);
  u4 += 0.843 * Math.sin(H * DEG);

  const r1 = 5.9057 - 0.0244 * Math.cos(2 * (u1 - u2) * DEG);
  const r2 = 9.3966 - 0.0882 * Math.cos(2 * (u2 - u3) * DEG);
  const r3 = 14.9883 - 0.0216 * Math.cos(G * DEG);
  const r4 = 26.3627 - 0.1939 * Math.cos(H * DEG);

  const moon = (
    id: GalileanMoonSky['id'],
    name: string,
    rr: number,
    u: number
  ): GalileanMoonSky => ({
    id,
    name,
    xJupiterRadii: rr * Math.sin(u * DEG),
    yJupiterRadii: -rr * Math.cos(u * DEG) * Math.sin(De),
    distanceLabel: `${delta.toFixed(2)} AU`,
    angularRadiusDeg:
      Math.asin(GALILEAN_RADII_KM[id] / (delta * AU_KM)) / DEG
  });

  return [
    moon('io', 'Io', r1, u1),
    moon('europa', 'Europa', r2, u2),
    moon('ganymede', 'Ganymede', r3, u3),
    moon('callisto', 'Callisto', r4, u4)
  ];
}
