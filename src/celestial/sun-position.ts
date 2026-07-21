// Shared solar position model used by globe, cave sky, and world lighting.

export type SunVector = {
  x: number;
  y: number;
  z: number;
};

export type SunLatLonDeg = {
  latDeg: number;
  lonDeg: number;
};

export class SunPosition {
  private readonly r2d = 180 / Math.PI;
  private readonly d2r = Math.PI / 180;

  public getSunLatLonDeg(date: Date = new Date()): SunLatLonDeg {
    const julianDay = this.getJulian(date);
    const gst = this.getGMST(julianDay);

    const sunEclPos = this.sunEclipticPosition(julianDay);
    const eclObliq = this.eclipticObliquity(julianDay);
    const sunEqPos = this.sunEquatorialPosition(
      sunEclPos.lambda,
      eclObliq
    );

    return {
      latDeg: sunEqPos.delta,
      lonDeg: this.normalizeLonDeg(sunEqPos.alpha - 15 * gst)
    };
  }

  public vectorToTheSun(
    shiftLongDeg: number,
    shiftLatDeg: number = 0,
    date: Date = new Date()
  ): SunVector {
    const sun = this.getSunLatLonDeg(date);

    const theta = this.toRadians(sun.latDeg + shiftLatDeg);
    const phi = this.toRadians(sun.lonDeg - shiftLongDeg);

    const cosTheta = Math.cos(theta);

    // Same Babylon coordinate system as GlobeController.latLonNormal(...)
    const x = -cosTheta * Math.cos(phi);
    const y = Math.sin(theta);
    const z = -cosTheta * Math.sin(phi);

    const len = Math.sqrt(x * x + y * y + z * z) || 1;

    return {
      x: x / len,
      y: y / len,
      z: z / len
    };
  }

  // Greenwich Mean Sidereal Time in hours (0..24). Public so the globe
  // starfield can place stars in the SAME inertial frame as the Sun.
  public getGmstHours(date: Date = new Date()): number {
    return this.getGMST(this.getJulian(date));
  }

  // Unit direction (Babylon frame) toward a star given its equatorial
  // coordinates. Uses the identical mapping as vectorToTheSun, so stars,
  // Sun and globe geography stay mutually consistent.
  // Star's instantaneous sub-point: (lat = decDeg, lon = raDeg - 15*GMST).
  public directionFromRaDec(
    raDeg: number,
    decDeg: number,
    shiftLongDeg: number,
    shiftLatDeg: number = 0,
    date: Date = new Date()
  ): SunVector {
    const gst = this.getGmstHours(date);
    const lonDeg = this.normalizeLonDeg(raDeg - 15 * gst);

    const theta = this.toRadians(decDeg + shiftLatDeg);
    const phi = this.toRadians(lonDeg - shiftLongDeg);

    const cosTheta = Math.cos(theta);

    // Same Babylon coordinate system as GlobeController.latLonNormal(...)
    const x = -cosTheta * Math.cos(phi);
    const y = Math.sin(theta);
    const z = -cosTheta * Math.sin(phi);

    const len = Math.sqrt(x * x + y * y + z * z) || 1;

    return {
      x: x / len,
      y: y / len,
      z: z / len
    };
  }

  private getJulian(date: Date): number {
    return date.getTime() / 86400000 + 2440587.5;
  }

  private getGMST(julianDay: number): number {
    const d = julianDay - 2451545.0;
    const value = 18.697374558 + 24.06570982441908 * d;
    const result = value % 24;

    return result < 0 ? result + 24 : result;
  }

  private sunEclipticPosition(
    julianDate: number
  ): { lambda: number; r: number } {
    const n = julianDate - 2451545.0;

    const l = this.normalizeDeg360(280.46 + 0.9856474 * n);
    const g = this.normalizeDeg360(357.528 + 0.9856003 * n);

    const lambda = this.normalizeDeg360(
      l +
        1.915 * Math.sin(g * this.d2r) +
        0.02 * Math.sin(2 * g * this.d2r)
    );

    const r =
      1.00014 -
      0.01671 * Math.cos(g * this.d2r) -
      0.0014 * Math.cos(2 * g * this.d2r);

    return {
      lambda,
      r
    };
  }

  private eclipticObliquity(julianDate: number): number {
    const n = julianDate - 2451545.0;
    const t = n / 36525;

    return (
      23.43929111 -
      t *
        (46.836769 / 3600 -
          t *
            (0.0001831 / 3600 +
              t *
                (0.0020034 / 3600 -
                  t * (0.576e-6 / 3600 - t * 4.34e-8 / 3600))))
    );
  }

  private sunEquatorialPosition(
    sunEclLng: number,
    eclObliq: number
  ): { alpha: number; delta: number } {
    let alpha =
      Math.atan(
        Math.cos(eclObliq * this.d2r) *
          Math.tan(sunEclLng * this.d2r)
      ) * this.r2d;

    const delta =
      Math.asin(
        Math.sin(eclObliq * this.d2r) *
          Math.sin(sunEclLng * this.d2r)
      ) * this.r2d;

    const lQuadrant = Math.floor(sunEclLng / 90) * 90;
    const raQuadrant = Math.floor(alpha / 90) * 90;

    alpha = alpha + (lQuadrant - raQuadrant);
    alpha = this.normalizeDeg360(alpha);

    return {
      alpha,
      delta
    };
  }

  private normalizeDeg360(value: number): number {
    let result = value % 360;

    if (result < 0) {
      result += 360;
    }

    return result;
  }

  private normalizeLonDeg(value: number): number {
    let result = value % 360;

    if (result > 180) {
      result -= 360;
    }

    if (result < -180) {
      result += 360;
    }

    return result;
  }

  private toRadians(value: number): number {
    return (value * Math.PI) / 180;
  }
}