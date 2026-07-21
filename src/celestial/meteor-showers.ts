// Major annual meteor showers. Radiant is the sky point meteors appear to
// stream from (RA/Dec, degrees). Dates are [month, day]. Deterministic: no
// live feed needed. Rendered on the globe sky via SunPosition.directionFromRaDec.

export type MeteorShower = {
  id: string;
  name: string;
  radiantRaDeg: number;
  radiantDecDeg: number;
  start: [number, number]; // active window start [month, day]
  end: [number, number];   // active window end [month, day]
  peak: [number, number];  // peak [month, day]
  zhr: number;             // zenithal hourly rate (approx. meteors/hour)
  parent: string;          // parent comet / asteroid
};

export const METEOR_SHOWERS: readonly MeteorShower[] = [
  { id: 'qua', name: 'Quadrantids', radiantRaDeg: 230, radiantDecDeg: 49, start: [12, 28], end: [1, 12], peak: [1, 3], zhr: 110, parent: '2003 EH1' },
  { id: 'lyr', name: 'Lyrids', radiantRaDeg: 271, radiantDecDeg: 34, start: [4, 16], end: [4, 25], peak: [4, 22], zhr: 18, parent: 'Comet Thatcher' },
  { id: 'eta', name: 'Eta Aquariids', radiantRaDeg: 338, radiantDecDeg: -1, start: [4, 19], end: [5, 28], peak: [5, 6], zhr: 50, parent: '1P/Halley' },
  { id: 'jbo', name: 'June Bootids', radiantRaDeg: 224, radiantDecDeg: 48, start: [6, 22], end: [7, 2], peak: [6, 27], zhr: 10, parent: '7P/Pons-Winnecke' },
  { id: 'cap', name: 'Alpha Capricornids', radiantRaDeg: 307, radiantDecDeg: -10, start: [7, 3], end: [8, 15], peak: [7, 30], zhr: 5, parent: '169P/NEAT' },
  { id: 'sda', name: 'Southern Delta Aquariids', radiantRaDeg: 340, radiantDecDeg: -16, start: [7, 12], end: [8, 23], peak: [7, 30], zhr: 25, parent: '96P/Machholz' },
  { id: 'per', name: 'Perseids', radiantRaDeg: 48, radiantDecDeg: 58, start: [7, 17], end: [8, 24], peak: [8, 12], zhr: 100, parent: '109P/Swift-Tuttle' },
  { id: 'dra', name: 'Draconids', radiantRaDeg: 262, radiantDecDeg: 54, start: [10, 6], end: [10, 10], peak: [10, 8], zhr: 10, parent: '21P/Giacobini-Zinner' },
  { id: 'ori', name: 'Orionids', radiantRaDeg: 95, radiantDecDeg: 16, start: [10, 2], end: [11, 7], peak: [10, 21], zhr: 20, parent: '1P/Halley' },
  { id: 'sta', name: 'Southern Taurids', radiantRaDeg: 52, radiantDecDeg: 13, start: [9, 10], end: [11, 20], peak: [10, 10], zhr: 5, parent: '2P/Encke' },
  { id: 'nta', name: 'Northern Taurids', radiantRaDeg: 58, radiantDecDeg: 22, start: [10, 20], end: [12, 10], peak: [11, 12], zhr: 5, parent: '2004 TG10' },
  { id: 'leo', name: 'Leonids', radiantRaDeg: 152, radiantDecDeg: 22, start: [11, 6], end: [11, 30], peak: [11, 17], zhr: 15, parent: '55P/Tempel-Tuttle' },
  { id: 'gem', name: 'Geminids', radiantRaDeg: 112, radiantDecDeg: 33, start: [12, 4], end: [12, 17], peak: [12, 14], zhr: 150, parent: '3200 Phaethon' },
  { id: 'urs', name: 'Ursids', radiantRaDeg: 217, radiantDecDeg: 76, start: [12, 17], end: [12, 26], peak: [12, 22], zhr: 10, parent: '8P/Tuttle' }
];

function md(month: number, day: number): number {
  return month * 100 + day;
}

export function isShowerActive(shower: MeteorShower, date: Date): boolean {
  const current = md(date.getMonth() + 1, date.getDate());
  const start = md(shower.start[0], shower.start[1]);
  const end = md(shower.end[0], shower.end[1]);

  if (start <= end) {
    return current >= start && current <= end;
  }

  // Window wraps the year end (e.g. Quadrantids: Dec 28 - Jan 12).
  return current >= start || current <= end;
}

// Signed days to peak (negative = peak already passed). Picks nearest year.
export function daysToPeak(shower: MeteorShower, date: Date): number {
  const dayMs = 86400000;
  const year = date.getFullYear();

  let best = Number.POSITIVE_INFINITY;

  for (const y of [year - 1, year, year + 1]) {
    const peak = new Date(y, shower.peak[0] - 1, shower.peak[1]);
    const diff = Math.round((peak.getTime() - date.getTime()) / dayMs);

    if (Math.abs(diff) < Math.abs(best)) {
      best = diff;
    }
  }

  return best;
}

// Signed HOURS to the nearest peak (negative = already passed). Unlike
// daysToPeak (whole days, only ticks at midnight), this changes every hour, so
// the tooltip visibly counts down through the day instead of looking frozen.
export function hoursToPeak(shower: MeteorShower, date: Date): number {
  const hourMs = 3600000;
  const year = date.getFullYear();

  let best = Number.POSITIVE_INFINITY;

  for (const y of [year - 1, year, year + 1]) {
    const peak = new Date(y, shower.peak[0] - 1, shower.peak[1]);
    const diff = (peak.getTime() - date.getTime()) / hourMs;

    if (Math.abs(diff) < Math.abs(best)) {
      best = diff;
    }
  }

  return best;
}

// Human "Nd Mh" (or "Mh" under a day) countdown string for the nearest peak.
export function peakCountdownLabel(shower: MeteorShower, date: Date): string {
  const totalHours = hoursToPeak(shower, date);
  const absHours = Math.abs(totalHours);

  let days = Math.floor(absHours / 24);
  let hours = Math.round(absHours % 24);

  if (hours === 24) {
    days += 1;
    hours = 0;
  }

  const human = days > 0 ? `${days}d ${hours}h` : `${hours}h`;

  if (absHours < 1) {
    return 'peaking now';
  }

  return totalHours > 0 ? `peak in ${human}` : `peak ${human} ago`;
}
