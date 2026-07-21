import {
  VISIBLE_STAR_CATALOG
} from './visible-star-catalog';

export type CelestialVector = {
  x: number;
  y: number;
  z: number;
};

export type CelestialObserverInput = {
  latDeg: number;
  lonDeg: number;
  date?: Date;

  // Optional future hook.
  // If the caller already has a better Earth heliocentric position,
  // pass it here in astronomical units. The Sun remains at origin.
  earthHeliocentricPositionAu?: CelestialVector;
};

export type CelestialObserverFrame = {
  observerLatDeg: number;
  observerLonDeg: number;
  date: Date;

  positionHeliocentricAu: CelestialVector;

  // Local observer basis in the same inertial frame as stars.
  up: CelestialVector;
  east: CelestialVector;
  north: CelestialVector;

  gmstHours: number;
  localSiderealTimeDeg: number;
};

export type CelestialEarthState = {
  heliocentricPositionAu: CelestialVector;
  sunDistanceAu: number;
  radiusAu: number;
  axialTiltDeg: number;
};

export type CelestialSunState = {
  directionFromObserver: CelestialVector;
  directionFromEarthCenter: CelestialVector;

  altitudeDeg: number;
  azimuthDeg: number;

  angularDiameterDeg: number;
  distanceAu: number;

  aboveHorizon: boolean;
};

export type CelestialStarState = {
  id: string;
  name: string;
  constellation?: string;

  directionFromSun: CelestialVector;
  directionFromObserver: CelestialVector;

  altitudeDeg: number;
  azimuthDeg: number;

  magnitude: number;
  colorIndex?: number;

  visibleAboveHorizon: boolean;
  apparentBrightness: number;
};

export type CelestialSystemState = {
  observer: CelestialObserverInput;
  earth: CelestialEarthState;
  frame: CelestialObserverFrame;
  sun: CelestialSunState;
  stars: CelestialStarState[];
};

type CatalogStarLike = {
  id?: string | number;
  name?: string;
  properName?: string;
  constellation?: string;
  raHours: number;
  decDeg: number;
  magnitude: number;
  colorIndex?: number;
};

type SolarApproximation = {
  apparentSunDirectionFromEarthCenter: CelestialVector;
  earthHeliocentricPositionAu: CelestialVector;
  sunDistanceAu: number;
};

// CELESTIAL_MODEL_COEFFICIENT:
// Astronomical unit in kilometers. This is the base relative distance unit:
// Sun-Earth mean distance = 1 AU.
const AU_KM = 149_597_870.7;

// CELESTIAL_MODEL_COEFFICIENT:
// Mean Earth radius in kilometers. Converted to AU for observer offset
// from Earth center.
const EARTH_RADIUS_KM = 6_371.0088;

// CELESTIAL_MODEL_COEFFICIENT:
// Mean Sun radius in kilometers. Used only for angular diameter.
// Render size is a separate visual concern.
const SUN_RADIUS_KM = 695_700;

// CELESTIAL_MODEL_COEFFICIENT:
// J2000 epoch Julian Day. Used by GMST and simple solar approximation.
const J2000_JULIAN_DAY = 2_451_545.0;

// CELESTIAL_MODEL_COEFFICIENT:
// Mean obliquity of the ecliptic near J2000.
// Later this can become date-dependent; for current geometry this is enough.
const MEAN_OBLIQUITY_DEG = 23.43929111;

// CELESTIAL_MODEL_COEFFICIENT:
// Star distance used when catalog has only direction RA/Dec.
// 1e9 AU is intentionally huge: Earth orbit parallax becomes visually negligible,
// but the math still treats each star as a real far-away source.
const DEFAULT_STAR_DISTANCE_AU = 1_000_000_000;

// CELESTIAL_MODEL_COEFFICIENT:
// Practical naked-eye magnitude limit used for model brightness normalization.
// It does not invent fake stars; it only maps real catalog magnitudes to 0..1.
const NAKED_EYE_MAGNITUDE_LIMIT = 6.2;

// CELESTIAL_MODEL_COEFFICIENT:
// Bright reference magnitude for brightness normalization.
// Sirius is near -1.46, so -1.5 is a stable practical lower bound.
const BRIGHT_REFERENCE_MAGNITUDE = -1.5;

// CELESTIAL_MODEL_COEFFICIENT:
// Stellar catalog guard. Entries brighter than -10m are not background stars;
// they are Solar-System placeholder records such as Sol. The Sun is modelled
// separately as state.sun with dynamic position and angular diameter.
const CATALOG_SOLAR_BODY_MAGNITUDE_LIMIT = -10;

// CELESTIAL_MODEL_COEFFICIENT:
// Degree/hour conversion for right ascension and sidereal time.
const DEGREES_PER_HOUR = 15;

// CELESTIAL_MODEL_COEFFICIENT:
// Numerical epsilon for vector normalization. Keeps zero/invalid vectors safe.
const VECTOR_EPSILON = 1e-12;

export class CelestialSystemModel {
  public createState(
    input: CelestialObserverInput
  ): CelestialSystemState {
    const date = input.date ?? new Date();
    const julianDay = this.getJulianDay(date);
    const gmstHours = this.getGmstHours(julianDay);

    const solar = this.createSolarApproximation(
      julianDay,
      input.earthHeliocentricPositionAu
    );

    const earth: CelestialEarthState = {
      heliocentricPositionAu: solar.earthHeliocentricPositionAu,
      sunDistanceAu: solar.sunDistanceAu,
      radiusAu: EARTH_RADIUS_KM / AU_KM,
      axialTiltDeg: MEAN_OBLIQUITY_DEG
    };

    const frame = this.createObserverFrame(
      input,
      date,
      gmstHours,
      earth
    );

    const sun = this.createSunState(
      frame,
      earth
    );

    const stars = this.createStarStates(
      frame
    );

    return {
      observer: {
        ...input,
        date
      },
      earth,
      frame,
      sun,
      stars
    };
  }

  public getVisibleStars(
    state: CelestialSystemState
  ): CelestialStarState[] {
    return state.stars.filter((star) => star.visibleAboveHorizon);
  }

  public getBrightVisibleStars(
    state: CelestialSystemState,
    limit = 16
  ): CelestialStarState[] {
    return this.getVisibleStars(state)
      .sort((a, b) => {
        if (a.magnitude !== b.magnitude) {
          return a.magnitude - b.magnitude;
        }

        return a.name.localeCompare(b.name);
      })
      .slice(0, limit);
  }

  private createObserverFrame(
    input: CelestialObserverInput,
    date: Date,
    gmstHours: number,
    earth: CelestialEarthState
  ): CelestialObserverFrame {
    const latRad =
      this.toRadians(this.clampNumber(input.latDeg, -90, 90));

    const lonDeg =
      this.normalizeLonDeg(input.lonDeg);

    // Local sidereal time: GMST + observer longitude.
    // East longitude is positive. This matches common astronomical convention.
    const localSiderealTimeDeg =
      this.normalizeDeg360(gmstHours * DEGREES_PER_HOUR + lonDeg);

    const theta =
      this.toRadians(localSiderealTimeDeg);

    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);

    const up = this.normalizeVector({
      x: cosLat * Math.cos(theta),
      y: sinLat,
      z: cosLat * Math.sin(theta)
    });

    const east = this.normalizeVector({
      x: -Math.sin(theta),
      y: 0,
      z: Math.cos(theta)
    });

    const north = this.normalizeVector({
      x: -sinLat * Math.cos(theta),
      y: cosLat,
      z: -sinLat * Math.sin(theta)
    });

    const observerSurfaceOffsetAu =
      this.scaleVector(
        up,
        earth.radiusAu
      );

    const positionHeliocentricAu =
      this.addVectors(
        earth.heliocentricPositionAu,
        observerSurfaceOffsetAu
      );

    return {
      observerLatDeg: input.latDeg,
      observerLonDeg: lonDeg,
      date,
      positionHeliocentricAu,
      up,
      east,
      north,
      gmstHours,
      localSiderealTimeDeg
    };
  }

  private createSunState(
    frame: CelestialObserverFrame,
    earth: CelestialEarthState
  ): CelestialSunState {
    const sunPosition = this.zeroVector();

    const directionFromObserver =
      this.normalizeVector(
        this.subtractVectors(
          sunPosition,
          frame.positionHeliocentricAu
        )
      );

    const directionFromEarthCenter =
      this.normalizeVector(
        this.scaleVector(
          earth.heliocentricPositionAu,
          -1
        )
      );

    const horizontal =
      this.getHorizontalCoordinates(
        directionFromObserver,
        frame
      );

    const angularDiameterDeg =
      this.toDegrees(
        2 *
          Math.atan(
            (SUN_RADIUS_KM / AU_KM) /
              Math.max(VECTOR_EPSILON, earth.sunDistanceAu)
          )
      );

    return {
      directionFromObserver,
      directionFromEarthCenter,
      altitudeDeg: horizontal.altitudeDeg,
      azimuthDeg: horizontal.azimuthDeg,
      angularDiameterDeg,
      distanceAu: earth.sunDistanceAu,
      aboveHorizon: horizontal.altitudeDeg > 0
    };
  }

  private createStarStates(
    frame: CelestialObserverFrame
  ): CelestialStarState[] {
    const result: CelestialStarState[] = [];

    for (const raw of VISIBLE_STAR_CATALOG) {
      const source = raw as CatalogStarLike;

      if (
        !Number.isFinite(source.raHours) ||
        !Number.isFinite(source.decDeg) ||
        !Number.isFinite(source.magnitude)
      ) {
        continue;
      }

      if (this.isCatalogSolarBody(source)) {
        continue;
      }

      const directionFromSun =
        this.raDecToVector(
          source.raHours,
          source.decDeg
        );

      const starPositionHeliocentricAu =
        this.scaleVector(
          directionFromSun,
          DEFAULT_STAR_DISTANCE_AU
        );

      const directionFromObserver =
        this.normalizeVector(
          this.subtractVectors(
            starPositionHeliocentricAu,
            frame.positionHeliocentricAu
          )
        );

      const horizontal =
        this.getHorizontalCoordinates(
          directionFromObserver,
          frame
        );

      const apparentBrightness =
        this.getMagnitudeBrightness(source.magnitude);

      const name =
        source.name ??
        source.properName ??
        String(source.id ?? 'star');

      result.push({
        id: String(source.id ?? name),
        name,
        constellation: source.constellation,
        directionFromSun,
        directionFromObserver,
        altitudeDeg: horizontal.altitudeDeg,
        azimuthDeg: horizontal.azimuthDeg,
        magnitude: source.magnitude,
        colorIndex: source.colorIndex,
        visibleAboveHorizon: horizontal.altitudeDeg > 0,
        apparentBrightness
      });
    }

    return result;
  }

  private isCatalogSolarBody(
    source: CatalogStarLike
  ): boolean {
    return source.magnitude <= CATALOG_SOLAR_BODY_MAGNITUDE_LIMIT;
  }

  private createSolarApproximation(
    julianDay: number,
    earthHeliocentricOverride?: CelestialVector
  ): SolarApproximation {
    if (earthHeliocentricOverride) {
      const earthPosition =
        this.normalizeFiniteVectorOrNull(earthHeliocentricOverride);

      if (earthPosition) {
        const distance =
          this.vectorLength(earthHeliocentricOverride);

        const sunDirection =
          this.normalizeVector(
            this.scaleVector(
              earthHeliocentricOverride,
              -1
            )
          );

        return {
          apparentSunDirectionFromEarthCenter: sunDirection,
          earthHeliocentricPositionAu: earthHeliocentricOverride,
          sunDistanceAu: Math.max(VECTOR_EPSILON, distance)
        };
      }
    }

    const n =
      julianDay - J2000_JULIAN_DAY;

    // CELESTIAL_MODEL_COEFFICIENT:
    // Solar mean longitude approximation coefficients, degrees.
    // Good enough for scene geometry and consistent debugging.
    const meanLongitudeDeg =
      this.normalizeDeg360(280.46 + 0.9856474 * n);

    // CELESTIAL_MODEL_COEFFICIENT:
    // Solar mean anomaly approximation coefficients, degrees.
    const meanAnomalyDeg =
      this.normalizeDeg360(357.528 + 0.9856003 * n);

    const meanAnomalyRad =
      this.toRadians(meanAnomalyDeg);

    // CELESTIAL_MODEL_COEFFICIENT:
    // Equation-of-center terms for apparent solar ecliptic longitude.
    // Units: degrees.
    const apparentEclipticLongitudeDeg =
      this.normalizeDeg360(
        meanLongitudeDeg +
          1.915 * Math.sin(meanAnomalyRad) +
          0.020 * Math.sin(2 * meanAnomalyRad)
      );

    // CELESTIAL_MODEL_COEFFICIENT:
    // Approximate Earth-Sun distance in AU.
    // This affects solar angular diameter, not star geometry.
    const sunDistanceAu =
      1.00014 -
      0.01671 * Math.cos(meanAnomalyRad) -
      0.00014 * Math.cos(2 * meanAnomalyRad);

    const sunDirectionFromEarthCenter =
      this.eclipticLonToEquatorialVector(
        apparentEclipticLongitudeDeg
      );

    const earthHeliocentricPositionAu =
      this.scaleVector(
        sunDirectionFromEarthCenter,
        -sunDistanceAu
      );

    return {
      apparentSunDirectionFromEarthCenter: sunDirectionFromEarthCenter,
      earthHeliocentricPositionAu,
      sunDistanceAu
    };
  }

  private raDecToVector(
    raHours: number,
    decDeg: number
  ): CelestialVector {
    const raRad =
      this.toRadians(raHours * DEGREES_PER_HOUR);

    const decRad =
      this.toRadians(decDeg);

    const cosDec =
      Math.cos(decRad);

    return this.normalizeVector({
      x: cosDec * Math.cos(raRad),
      y: Math.sin(decRad),
      z: cosDec * Math.sin(raRad)
    });
  }

  private eclipticLonToEquatorialVector(
    eclipticLonDeg: number
  ): CelestialVector {
    const lonRad =
      this.toRadians(eclipticLonDeg);

    const obliquityRad =
      this.toRadians(MEAN_OBLIQUITY_DEG);

    return this.normalizeVector({
      x: Math.cos(lonRad),
      y: Math.sin(obliquityRad) * Math.sin(lonRad),
      z: Math.cos(obliquityRad) * Math.sin(lonRad)
    });
  }

  private getHorizontalCoordinates(
    direction: CelestialVector,
    frame: CelestialObserverFrame
  ): {
    altitudeDeg: number;
    azimuthDeg: number;
  } {
    const altitudeRad =
      Math.asin(
        this.clampNumber(
          this.dot(direction, frame.up),
          -1,
          1
        )
      );

    const eastComponent =
      this.dot(direction, frame.east);

    const northComponent =
      this.dot(direction, frame.north);

    const azimuthRad =
      Math.atan2(
        eastComponent,
        northComponent
      );

    return {
      altitudeDeg: this.toDegrees(altitudeRad),
      azimuthDeg: this.normalizeDeg360(
        this.toDegrees(azimuthRad)
      )
    };
  }

  private getMagnitudeBrightness(
    magnitude: number
  ): number {
    return this.clampNumber(
      (NAKED_EYE_MAGNITUDE_LIMIT - magnitude) /
        (NAKED_EYE_MAGNITUDE_LIMIT - BRIGHT_REFERENCE_MAGNITUDE),
      0,
      1
    );
  }

  private getJulianDay(date: Date): number {
    return date.getTime() / 86_400_000 + 2_440_587.5;
  }

  private getGmstHours(julianDay: number): number {
    const d =
      julianDay - J2000_JULIAN_DAY;

    // CELESTIAL_MODEL_COEFFICIENT:
    // GMST approximation:
    // 18.697374558 hours at J2000 plus 24.06570982441908 sidereal hours/day.
    const value =
      18.697374558 + 24.06570982441908 * d;

    return this.normalizeHours(value);
  }

  private zeroVector(): CelestialVector {
    return {
      x: 0,
      y: 0,
      z: 0
    };
  }

  private addVectors(
    a: CelestialVector,
    b: CelestialVector
  ): CelestialVector {
    return {
      x: a.x + b.x,
      y: a.y + b.y,
      z: a.z + b.z
    };
  }

  private subtractVectors(
    a: CelestialVector,
    b: CelestialVector
  ): CelestialVector {
    return {
      x: a.x - b.x,
      y: a.y - b.y,
      z: a.z - b.z
    };
  }

  private scaleVector(
    value: CelestialVector,
    scale: number
  ): CelestialVector {
    return {
      x: value.x * scale,
      y: value.y * scale,
      z: value.z * scale
    };
  }

  private dot(
    a: CelestialVector,
    b: CelestialVector
  ): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  private vectorLength(
    value: CelestialVector
  ): number {
    return Math.sqrt(
      value.x * value.x +
        value.y * value.y +
        value.z * value.z
    );
  }

  private normalizeVector(
    value: CelestialVector
  ): CelestialVector {
    const length =
      this.vectorLength(value);

    if (!Number.isFinite(length) || length < VECTOR_EPSILON) {
      return this.zeroVector();
    }

    return {
      x: value.x / length,
      y: value.y / length,
      z: value.z / length
    };
  }

  private normalizeFiniteVectorOrNull(
    value: CelestialVector
  ): CelestialVector | null {
    if (
      !Number.isFinite(value.x) ||
      !Number.isFinite(value.y) ||
      !Number.isFinite(value.z)
    ) {
      return null;
    }

    const normalized =
      this.normalizeVector(value);

    if (this.vectorLength(normalized) < VECTOR_EPSILON) {
      return null;
    }

    return normalized;
  }

  private normalizeDeg360(value: number): number {
    const result =
      value % 360;

    return result < 0
      ? result + 360
      : result;
  }

  private normalizeLonDeg(value: number): number {
    let result =
      value % 360;

    if (result > 180) {
      result -= 360;
    }

    if (result < -180) {
      result += 360;
    }

    return result;
  }

  private normalizeHours(value: number): number {
    const result =
      value % 24;

    return result < 0
      ? result + 24
      : result;
  }

  private clampNumber(
    value: number,
    min: number,
    max: number
  ): number {
    return Math.max(
      min,
      Math.min(max, value)
    );
  }

  private toRadians(value: number): number {
    return value * Math.PI / 180;
  }

  private toDegrees(value: number): number {
    return value * 180 / Math.PI;
  }
}
