import {
  CelestialStarDisplayPolicy,
  type CelestialStarDisplayGroup
} from './celestial-star-display-policy';

import type {
  CelestialSystemState,
  CelestialVector
} from './celestial-system-model';

export type CelestialSkyRayPhase =
  | 'below-horizon'
  | 'day'
  | 'twilight'
  | 'night';

export type CelestialSkyRayInput = {
  state: CelestialSystemState;
  rayDirection: CelestialVector;
  starHitAngleDeg?: number;
  maxStarHits?: number;
};

export type CelestialSkyRaySunSample = {
  angularRadiusDeg: number;
  angularSeparationDeg: number;
  diskHit: boolean;
  diskAlpha: number;
  glowStrength: number;
};

export type CelestialSkyRayStarHit = {
  group: CelestialStarDisplayGroup;
  angularSeparationDeg: number;
  relativeStrength: number;
};

export type CelestialSkyRaySample = {
  rayDirection: CelestialVector;
  altitudeDeg: number;
  azimuthDeg: number;
  aboveHorizon: boolean;
  phase: CelestialSkyRayPhase;
  starVisibility: number;
  atmosphericBrightness: number;
  sun: CelestialSkyRaySunSample;
  nearestStar: CelestialSkyRayStarHit | null;
  starHits: readonly CelestialSkyRayStarHit[];
};

// CELESTIAL_SKY_RAY_COEFFICIENT:
// Solar disk edge softness in degrees. The physical Sun has a hard disk,
// but a small model softness keeps future raster/sprite renderers stable.
const SUN_DISK_EDGE_SOFTNESS_DEG = 0.04;

// CELESTIAL_SKY_RAY_COEFFICIENT:
// Outer angular radius for non-physical visual sun glow.
// This is model metadata for renderers, not a physical solar radius.
const SUN_GLOW_OUTER_ANGLE_DEG = 8.0;

// CELESTIAL_SKY_RAY_COEFFICIENT:
// Apparent horizon day threshold. -0.833° approximates the Sun upper limb
// plus atmospheric refraction near sunrise/sunset.
const SUN_DAY_ALTITUDE_DEG = -0.833;

// CELESTIAL_SKY_RAY_COEFFICIENT:
// Astronomical twilight lower threshold. Below this, sky is treated as night
// and stars can reach full visibility.
const SUN_NIGHT_ALTITUDE_DEG = -18.0;

// CELESTIAL_SKY_RAY_COEFFICIENT:
// Star visibility is fully suppressed by this solar altitude.
// Keeps daytime/sunset labels from appearing before atmosphere logic exists.
const STAR_VISIBILITY_ZERO_SUN_ALTITUDE_DEG = -4.0;

// CELESTIAL_SKY_RAY_COEFFICIENT:
// Star visibility is full at and below this solar altitude.
const STAR_VISIBILITY_FULL_SUN_ALTITUDE_DEG = -18.0;

// CELESTIAL_SKY_RAY_COEFFICIENT:
// Fade stars near the local horizon to avoid hard popping.
// This is model-side metadata for renderers and future atmosphere sampling.
const STAR_HORIZON_FADE_ALTITUDE_DEG = 2.0;

// CELESTIAL_SKY_RAY_COEFFICIENT:
// Default angular hit radius for star tooltip/sampling in degrees.
// Rendering may use a wider screen-space radius, but the model stays angular.
const DEFAULT_STAR_HIT_ANGLE_DEG = 0.18;

// CELESTIAL_SKY_RAY_COEFFICIENT:
// Maximum star hits returned by default for one ray.
const DEFAULT_MAX_STAR_HITS = 6;

// CELESTIAL_SKY_RAY_COEFFICIENT:
// Practical naked-eye render limit used for ray hit candidates.
const DEFAULT_STAR_RENDER_MAGNITUDE_LIMIT = 6.2;

// CELESTIAL_SKY_RAY_COEFFICIENT:
// Duplicate grouping threshold reused by the display policy.
const DEFAULT_DUPLICATE_ANGLE_DEG = 0.03;

// CELESTIAL_SKY_RAY_COEFFICIENT:
// Numerical guard for vector normalization.
const VECTOR_EPSILON = 1e-12;

export class CelestialSkyRaySampler {
  private readonly displayPolicy =
    new CelestialStarDisplayPolicy();

  public sample(
    input: CelestialSkyRayInput
  ): CelestialSkyRaySample {
    const rayDirection =
      this.normalizeVector(input.rayDirection);

    const horizontal =
      this.getHorizontalCoordinates(
        rayDirection,
        input.state
      );

    const aboveHorizon =
      horizontal.altitudeDeg > 0;

    const phase =
      this.getSkyPhase(
        input.state.sun.altitudeDeg,
        aboveHorizon
      );

    const starVisibility =
      this.getStarVisibility(
        input.state.sun.altitudeDeg,
        horizontal.altitudeDeg
      );

    const atmosphericBrightness =
      this.getAtmosphericBrightness(
        input.state.sun.altitudeDeg,
        aboveHorizon
      );

    const sun =
      this.sampleSun(
        input.state,
        rayDirection
      );

    const starHits =
      this.sampleStars(
        input.state,
        rayDirection,
        starVisibility,
        input.starHitAngleDeg ?? DEFAULT_STAR_HIT_ANGLE_DEG,
        input.maxStarHits ?? DEFAULT_MAX_STAR_HITS
      );

    return {
      rayDirection,
      altitudeDeg: horizontal.altitudeDeg,
      azimuthDeg: horizontal.azimuthDeg,
      aboveHorizon,
      phase,
      starVisibility,
      atmosphericBrightness,
      sun,
      nearestStar: starHits[0] ?? null,
      starHits
    };
  }

  private sampleSun(
    state: CelestialSystemState,
    rayDirection: CelestialVector
  ): CelestialSkyRaySunSample {
    const angularRadiusDeg =
      state.sun.angularDiameterDeg * 0.5;

    const angularSeparationDeg =
      this.angleDegBetween(
        rayDirection,
        state.sun.directionFromObserver
      );

    const diskAlpha =
      1 -
      this.smoothStep(
        angularRadiusDeg,
        angularRadiusDeg + SUN_DISK_EDGE_SOFTNESS_DEG,
        angularSeparationDeg
      );

    const glowStrength =
      1 -
      this.smoothStep(
        angularRadiusDeg,
        SUN_GLOW_OUTER_ANGLE_DEG,
        angularSeparationDeg
      );

    return {
      angularRadiusDeg,
      angularSeparationDeg,
      diskHit: angularSeparationDeg <= angularRadiusDeg,
      diskAlpha: this.clampNumber(diskAlpha, 0, 1),
      glowStrength: this.clampNumber(glowStrength, 0, 1)
    };
  }

  private sampleStars(
    state: CelestialSystemState,
    rayDirection: CelestialVector,
    starVisibility: number,
    starHitAngleDeg: number,
    maxStarHits: number
  ): CelestialSkyRayStarHit[] {
    if (starVisibility <= 0.0001 || starHitAngleDeg <= 0) {
      return [];
    }

    const groups =
      this.displayPolicy.getDisplayGroups(
        state.stars,
        {
          visibleOnly: true,
          maxMagnitude: DEFAULT_STAR_RENDER_MAGNITUDE_LIMIT,
          duplicateAngleDeg: DEFAULT_DUPLICATE_ANGLE_DEG
        }
      );

    const hits: CelestialSkyRayStarHit[] = [];

    for (const group of groups) {
      const angularSeparationDeg =
        this.angleDegBetween(
          rayDirection,
          group.primary.directionFromObserver
        );

      if (angularSeparationDeg > starHitAngleDeg) {
        continue;
      }

      const centerStrength =
        1 -
        this.smoothStep(
          0,
          starHitAngleDeg,
          angularSeparationDeg
        );

      hits.push({
        group,
        angularSeparationDeg,
        relativeStrength:
          starVisibility *
          group.primary.apparentBrightness *
          this.clampNumber(centerStrength, 0, 1)
      });
    }

    hits.sort((a, b) => {
      if (a.angularSeparationDeg !== b.angularSeparationDeg) {
        return a.angularSeparationDeg - b.angularSeparationDeg;
      }

      return a.group.primary.magnitude - b.group.primary.magnitude;
    });

    return hits.slice(
      0,
      Math.max(0, Math.floor(maxStarHits))
    );
  }

  private getSkyPhase(
    sunAltitudeDeg: number,
    aboveHorizon: boolean
  ): CelestialSkyRayPhase {
    if (!aboveHorizon) {
      return 'below-horizon';
    }

    if (sunAltitudeDeg >= SUN_DAY_ALTITUDE_DEG) {
      return 'day';
    }

    if (sunAltitudeDeg >= SUN_NIGHT_ALTITUDE_DEG) {
      return 'twilight';
    }

    return 'night';
  }

  private getStarVisibility(
    sunAltitudeDeg: number,
    rayAltitudeDeg: number
  ): number {
    if (rayAltitudeDeg <= 0) {
      return 0;
    }

    const nightFactor =
      1 -
      this.smoothStep(
        STAR_VISIBILITY_FULL_SUN_ALTITUDE_DEG,
        STAR_VISIBILITY_ZERO_SUN_ALTITUDE_DEG,
        sunAltitudeDeg
      );

    const horizonFactor =
      this.smoothStep(
        0,
        STAR_HORIZON_FADE_ALTITUDE_DEG,
        rayAltitudeDeg
      );

    return this.clampNumber(
      nightFactor * horizonFactor,
      0,
      1
    );
  }

  private getAtmosphericBrightness(
    sunAltitudeDeg: number,
    aboveHorizon: boolean
  ): number {
    if (!aboveHorizon) {
      return 0;
    }

    return this.clampNumber(
      this.smoothStep(
        SUN_NIGHT_ALTITUDE_DEG,
        SUN_DAY_ALTITUDE_DEG,
        sunAltitudeDeg
      ),
      0,
      1
    );
  }

  private getHorizontalCoordinates(
    direction: CelestialVector,
    state: CelestialSystemState
  ): {
    altitudeDeg: number;
    azimuthDeg: number;
  } {
    const altitudeRad =
      Math.asin(
        this.clampNumber(
          this.dot(direction, state.frame.up),
          -1,
          1
        )
      );

    const eastComponent =
      this.dot(direction, state.frame.east);

    const northComponent =
      this.dot(direction, state.frame.north);

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

  private angleDegBetween(
    a: CelestialVector,
    b: CelestialVector
  ): number {
    const dot =
      this.clampNumber(
        this.dot(
          this.normalizeVector(a),
          this.normalizeVector(b)
        ),
        -1,
        1
      );

    return this.toDegrees(
      Math.acos(dot)
    );
  }

  private normalizeVector(
    vector: CelestialVector
  ): CelestialVector {
    const length =
      Math.sqrt(
        vector.x * vector.x +
          vector.y * vector.y +
          vector.z * vector.z
      );

    if (!Number.isFinite(length) || length < VECTOR_EPSILON) {
      return {
        x: 0,
        y: 0,
        z: 0
      };
    }

    return {
      x: vector.x / length,
      y: vector.y / length,
      z: vector.z / length
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
    if (edge0 === edge1) {
      return value < edge0 ? 0 : 1;
    }

    const t =
      this.clampNumber(
        (value - edge0) / (edge1 - edge0),
        0,
        1
      );

    return t * t * (3 - 2 * t);
  }

  private normalizeDeg360(
    value: number
  ): number {
    const result =
      value % 360;

    return result < 0
      ? result + 360
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

  private toDegrees(
    radians: number
  ): number {
    return radians * 180 / Math.PI;
  }
}
