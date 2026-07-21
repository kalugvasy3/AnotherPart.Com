import {
  SunPosition,
  type SunVector
} from './sun-position';

import {
  VISIBLE_STAR_CATALOG
} from './visible-star-catalog';

export type CelestialVector = {
  x: number;
  y: number;
  z: number;
};

export type CelestialObserver = {
  latDeg: number;
  lonDeg: number;
};

export type CelestialSkyPhase =
  | 'day'
  | 'twilight'
  | 'night';

export type CelestialBodyState = {
  directionWorld: CelestialVector;
  altitudeDeg: number;
  azimuthDeg: number;
  visible: boolean;
  intensity: number;
};

export type CelestialStarDefinition = {
  id: string;
  name: string;
  constellation: string;
  raHours: number;
  decDeg: number;
  magnitude: number;
  colorIndex?: number | null;
  spectralType?: string | null;
};

export type CelestialStarState = CelestialStarDefinition & {
  directionWorld: CelestialVector;
  altitudeDeg: number;
  azimuthDeg: number;
  visible: boolean;
  brightness: number;
};

export type CelestialState = {
  generatedAt: string;
  observer: CelestialObserver;
  skyPhase: CelestialSkyPhase;
  daylight: number;
  twilight: number;
  sun: CelestialBodyState;
  brightStars: CelestialStarState[];
};


export class CelestialEnvironment {
  private readonly sunPosition = new SunPosition();
  private cachedStateKey = '';
  private cachedState?: CelestialState;

  public constructor(
    // Zero since the Blue Marble globe (2026-07-09): the texture is
    // centered exactly on Greenwich. Keep in sync with GlobeController.
    private readonly shiftLongDeg = 0,
    private readonly shiftLatDeg = 0
  ) {}

  public createState(
    observer: CelestialObserver,
    date: Date = new Date()
  ): CelestialState {
    const cacheKey = [
      date.toISOString().slice(0, 16),
      observer.latDeg.toFixed(3),
      observer.lonDeg.toFixed(3)
    ].join(':');

    if (this.cachedState && this.cachedStateKey === cacheKey) {
      return this.cachedState;
    }
    const sunDirection = this.toCelestialVector(
      this.sunPosition.vectorToTheSun(
        this.shiftLongDeg,
        this.shiftLatDeg,
        date
      )
    );

    const sunAltitudeDeg = this.getAltitudeDeg(
      observer,
      sunDirection
    );

    const sunAzimuthDeg = this.getAzimuthDeg(
      observer,
      sunDirection
    );

    const daylight = this.smoothStep(
      -2,
      10,
      sunAltitudeDeg
    );

    const twilight =
      (1 - daylight) *
      this.smoothStep(
        -18,
        -4,
        sunAltitudeDeg
      );

    const skyPhase: CelestialSkyPhase = daylight > 0.55
      ? 'day'
      : twilight > 0.14
        ? 'twilight'
        : 'night';

    const starVisibility = this.clampNumber(
      1 - daylight * 1.25 - twilight * 0.35,
      0,
      1
    );

    const brightStars = VISIBLE_STAR_CATALOG.map((star: CelestialStarDefinition) => {
      return this.createStarState(
        star,
        observer,
        date,
        starVisibility
      );
    });

    const state: CelestialState = {
      generatedAt: date.toISOString(),
      observer,
      skyPhase,
      daylight,
      twilight,
      sun: {
        directionWorld: sunDirection,
        altitudeDeg: sunAltitudeDeg,
        azimuthDeg: sunAzimuthDeg,
        visible: sunAltitudeDeg > -0.75,
        intensity: this.clampNumber(
          daylight + twilight * 0.36,
          0,
          1
        )
      },
      brightStars
    };

    this.cachedStateKey = cacheKey;
    this.cachedState = state;

    return state;
  }

  private createStarState(
    star: CelestialStarDefinition,
    observer: CelestialObserver,
    date: Date,
    starVisibility: number
  ): CelestialStarState {
    const directionWorld = this.getStarDirectionWorld(
      star,
      date
    );

    const altitudeDeg = this.getAltitudeDeg(
      observer,
      directionWorld
    );

    const azimuthDeg = this.getAzimuthDeg(
      observer,
      directionWorld
    );

    const visible =
      altitudeDeg > -2 &&
      starVisibility > 0.02;

    const magnitudeBrightness = this.clampNumber(
      (2.20 - star.magnitude) / 3.80,
      0.06,
      1
    );

    return {
      ...star,
      directionWorld,
      altitudeDeg,
      azimuthDeg,
      visible,
      brightness: visible
        ? magnitudeBrightness * starVisibility
        : 0
    };
  }

  private getStarDirectionWorld(
    star: CelestialStarDefinition,
    date: Date
  ): CelestialVector {
    const julianDay = this.getJulian(date);
    const gmstHours = this.getGMST(julianDay);
    const raDeg = star.raHours * 15;

    const lonDeg = this.normalizeLonDeg(
      raDeg - gmstHours * 15
    );

    return this.latLonNormal(
      star.decDeg,
      lonDeg
    );
  }

  private getAltitudeDeg(
    observer: CelestialObserver,
    directionWorld: CelestialVector
  ): number {
    const up = this.latLonNormal(
      observer.latDeg,
      observer.lonDeg
    );

    return this.toDegrees(
      Math.asin(
        this.clampNumber(
          this.dot(up, directionWorld),
          -1,
          1
        )
      )
    );
  }

  private getAzimuthDeg(
    observer: CelestialObserver,
    directionWorld: CelestialVector
  ): number {
    const basis = this.getObserverBasis(observer);

    const eastComponent =
      this.dot(directionWorld, basis.east);

    const northComponent =
      this.dot(directionWorld, basis.north);

    return this.normalizeDeg360(
      this.toDegrees(
        Math.atan2(
          eastComponent,
          northComponent
        )
      )
    );
  }

  private getObserverBasis(
    observer: CelestialObserver
  ): {
    east: CelestialVector;
    north: CelestialVector;
    up: CelestialVector;
  } {
    const up = this.latLonNormal(
      observer.latDeg,
      observer.lonDeg
    );

    const eastForward = this.latLonNormal(
      observer.latDeg,
      observer.lonDeg + 0.01
    );

    const eastBack = this.latLonNormal(
      observer.latDeg,
      observer.lonDeg - 0.01
    );

    const northForward = this.latLonNormal(
      observer.latDeg + 0.01,
      observer.lonDeg
    );

    const northBack = this.latLonNormal(
      observer.latDeg - 0.01,
      observer.lonDeg
    );

    return {
      up,
      east: this.normalize({
        x: eastForward.x - eastBack.x,
        y: eastForward.y - eastBack.y,
        z: eastForward.z - eastBack.z
      }),
      north: this.normalize({
        x: northForward.x - northBack.x,
        y: northForward.y - northBack.y,
        z: northForward.z - northBack.z
      })
    };
  }

  private latLonNormal(
    latDeg: number,
    lonDeg: number
  ): CelestialVector {
    const theta = this.toRadians(latDeg + this.shiftLatDeg);
    const phi = this.toRadians(lonDeg - this.shiftLongDeg);

    const cosTheta = Math.cos(theta);

    return this.normalize({
      x: -cosTheta * Math.cos(phi),
      y: Math.sin(theta),
      z: -cosTheta * Math.sin(phi)
    });
  }

  private getJulian(date: Date): number {
    return date.getTime() / 86400000 + 2440587.5;
  }

  private getGMST(julianDay: number): number {
    const d = julianDay - 2451545.0;
    const value = 18.697374558 + 24.06570982441908 * d;
    const result = value % 24;

    return result < 0
      ? result + 24
      : result;
  }

  private toCelestialVector(value: SunVector): CelestialVector {
    return {
      x: value.x,
      y: value.y,
      z: value.z
    };
  }

  private normalize(value: CelestialVector): CelestialVector {
    const length = Math.sqrt(
      value.x * value.x +
      value.y * value.y +
      value.z * value.z
    ) || 1;

    return {
      x: value.x / length,
      y: value.y / length,
      z: value.z / length
    };
  }

  private dot(
    a: CelestialVector,
    b: CelestialVector
  ): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  private smoothStep(
    edge0: number,
    edge1: number,
    value: number
  ): number {
    const t = this.clampNumber(
      (value - edge0) / Math.max(0.0001, edge1 - edge0),
      0,
      1
    );

    return t * t * (3 - 2 * t);
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

  private toDegrees(value: number): number {
    return (value * 180) / Math.PI;
  }
}
