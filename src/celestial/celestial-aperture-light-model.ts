import {
  CelestialSkyRaySampler
} from './celestial-sky-ray-sampler';

import type {
  CelestialSystemState,
  CelestialVector
} from './celestial-system-model';

export type CelestialAperturePhase =
  | 'day'
  | 'twilight'
  | 'night';

export type CelestialRgb = {
  r: number;
  g: number;
  b: number;
};

export type CelestialApertureLightInput = {
  state: CelestialSystemState;

  // If omitted, the aperture looks at local zenith.
  // This matches the first stable tunnel entrance model.
  apertureDirection?: CelestialVector;

  // Full opening is 2 * halfAngleDeg.
  halfAngleDeg?: number;
};

export type CelestialApertureLightState = {
  phase: CelestialAperturePhase;

  apertureDirection: CelestialVector;
  apertureHalfAngleDeg: number;

  centerAltitudeDeg: number;
  centerAzimuthDeg: number;

  sunAltitudeDeg: number;
  sunAzimuthDeg: number;
  sunAngularSeparationFromApertureDeg: number;
  sunInsideAperture: boolean;

  exteriorBrightness: number;
  apertureOpacity: number;

  diffuseLightIntensity: number;
  directSunIntensity: number;
  glareStrength: number;

  starVisibility: number;

  apertureColor: CelestialRgb;
  lightColor: CelestialRgb;
};

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Default tunnel entrance half-angle in degrees. The full cone is 116°,
// wide enough to read as a cave mouth without pretending to be full-sky.
const DEFAULT_APERTURE_HALF_ANGLE_DEG = 58;

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Minimum allowed aperture half-angle. Prevents degenerate zero-size portals.
const MIN_APERTURE_HALF_ANGLE_DEG = 3;

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Maximum allowed aperture half-angle. Keeps the portal from becoming a whole sky dome.
const MAX_APERTURE_HALF_ANGLE_DEG = 89;

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Apparent horizon day threshold. -0.833° approximates Sun upper limb plus
// atmospheric refraction near sunrise/sunset.
const SUN_DAY_ALTITUDE_DEG = -0.833;

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Astronomical twilight lower threshold. Below this value the entrance is
// treated as night-lit, not twilight-lit.
const SUN_NIGHT_ALTITUDE_DEG = -18.0;

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Daylight reaches full strength only after the Sun rises meaningfully
// above the horizon. This avoids a hard jump at sunrise.
const SUN_FULL_DAY_ALTITUDE_DEG = 8.0;

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Twilight reaches useful strength around this altitude. It makes sunset/sunrise
// aperture light warm and visible before full daylight.
const SUN_TWILIGHT_PEAK_ALTITUDE_DEG = -4.0;

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Minimum night brightness of the frosted cave entrance. This keeps the portal
// perceptible without making night sky a strong light source.
const NIGHT_APERTURE_BRIGHTNESS_FLOOR = 0.035;

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Base daylight brightness of the frosted entrance.
const DAY_APERTURE_BRIGHTNESS = 0.86;

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Base twilight brightness before direct Sun/glare contribution.
const TWILIGHT_APERTURE_BRIGHTNESS = 0.26;

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Weak stellar contribution to night entrance brightness. Stars are not a
// strong light source, so this remains intentionally small.
const STAR_LIGHT_BRIGHTNESS_SCALE = 0.025;

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Maximum diffuse light intensity emitted from the entrance into the tunnel.
const MAX_DIFFUSE_LIGHT_INTENSITY = 0.62;

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Maximum direct Sun light contribution when the Sun is inside the aperture.
const MAX_DIRECT_SUN_INTENSITY = 1.00;

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Direct Sun response uses the aperture edge plus the solar angular radius.
// This extra softness avoids hard on/off behaviour near the rim.
const SUN_APERTURE_EDGE_SOFTNESS_DEG = 1.25;

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Aperture opacity floor. Even at night the frosted glass/light portal should
// remain visually present.
const APERTURE_OPACITY_FLOOR = 0.16;

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Aperture opacity gain from exterior brightness.
const APERTURE_OPACITY_BRIGHTNESS_GAIN = 0.72;

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Exposure fade when an aperture points near or slightly below the horizon.
// Useful for future almost-surface-facing entrances.
const HORIZON_EXPOSURE_FADE_DEG = 6.0;

// CELESTIAL_APERTURE_LIGHT_COEFFICIENT:
// Numerical guard for vector normalization.
const VECTOR_EPSILON = 1e-12;

const NIGHT_APERTURE_COLOR: CelestialRgb = {
  r: 0.045,
  g: 0.065,
  b: 0.115
};

const TWILIGHT_APERTURE_COLOR: CelestialRgb = {
  r: 0.88,
  g: 0.42,
  b: 0.18
};

const DAY_APERTURE_COLOR: CelestialRgb = {
  r: 0.52,
  g: 0.76,
  b: 1.00
};

const DIRECT_SUN_COLOR: CelestialRgb = {
  r: 1.00,
  g: 0.82,
  b: 0.42
};

export class CelestialApertureLightModel {
  private readonly sampler =
    new CelestialSkyRaySampler();

  public createState(
    input: CelestialApertureLightInput
  ): CelestialApertureLightState {
    const apertureDirection =
      this.normalizeVector(
        input.apertureDirection ?? input.state.frame.up
      );

    const halfAngleDeg =
      this.clampNumber(
        input.halfAngleDeg ?? DEFAULT_APERTURE_HALF_ANGLE_DEG,
        MIN_APERTURE_HALF_ANGLE_DEG,
        MAX_APERTURE_HALF_ANGLE_DEG
      );

    const centerSample =
      this.sampler.sample({
        state: input.state,
        rayDirection: apertureDirection
      });

    const phase =
      this.getAperturePhase(input.state.sun.altitudeDeg);

    const daylight =
      this.smoothStep(
        SUN_DAY_ALTITUDE_DEG,
        SUN_FULL_DAY_ALTITUDE_DEG,
        input.state.sun.altitudeDeg
      );

    const twilight =
      (1 - daylight) *
      this.smoothStep(
        SUN_NIGHT_ALTITUDE_DEG,
        SUN_TWILIGHT_PEAK_ALTITUDE_DEG,
        input.state.sun.altitudeDeg
      );

    const night =
      this.clampNumber(
        1 - daylight - twilight,
        0,
        1
      );

    const skyExposure =
      this.getSkyExposure(
        centerSample.altitudeDeg,
        halfAngleDeg
      );

    const sunAngularRadiusDeg =
      input.state.sun.angularDiameterDeg * 0.5;

    const sunAngularSeparationFromApertureDeg =
      this.angleDegBetween(
        apertureDirection,
        input.state.sun.directionFromObserver
      );

    const sunInsideAperture =
      input.state.sun.aboveHorizon &&
      sunAngularSeparationFromApertureDeg <=
        halfAngleDeg + sunAngularRadiusDeg;

    const directSunFactor =
      sunInsideAperture
        ? 1 -
          this.smoothStep(
            0,
            halfAngleDeg +
              sunAngularRadiusDeg +
              SUN_APERTURE_EDGE_SOFTNESS_DEG,
            sunAngularSeparationFromApertureDeg
          )
        : 0;

    const glareStrength =
      this.clampNumber(
        directSunFactor *
          (daylight + twilight * 0.45),
        0,
        1
      );

    const starVisibility =
      centerSample.starVisibility * skyExposure;

    const baseBrightness =
      skyExposure *
      (
        night * NIGHT_APERTURE_BRIGHTNESS_FLOOR +
        twilight * TWILIGHT_APERTURE_BRIGHTNESS +
        daylight * DAY_APERTURE_BRIGHTNESS
      );

    const exteriorBrightness =
      this.clampNumber(
        baseBrightness +
          glareStrength * 0.42 +
          starVisibility * STAR_LIGHT_BRIGHTNESS_SCALE,
        NIGHT_APERTURE_BRIGHTNESS_FLOOR,
        1
      );

    const diffuseLightIntensity =
      this.clampNumber(
        exteriorBrightness * MAX_DIFFUSE_LIGHT_INTENSITY,
        0,
        MAX_DIFFUSE_LIGHT_INTENSITY
      );

    const directSunIntensity =
      this.clampNumber(
        glareStrength * MAX_DIRECT_SUN_INTENSITY,
        0,
        MAX_DIRECT_SUN_INTENSITY
      );

    const apertureOpacity =
      this.clampNumber(
        APERTURE_OPACITY_FLOOR +
          exteriorBrightness * APERTURE_OPACITY_BRIGHTNESS_GAIN,
        APERTURE_OPACITY_FLOOR,
        0.96
      );

    const baseColor =
      this.mixColors(
        NIGHT_APERTURE_COLOR,
        TWILIGHT_APERTURE_COLOR,
        twilight
      );

    const dayColor =
      this.mixColors(
        baseColor,
        DAY_APERTURE_COLOR,
        daylight
      );

    const apertureColor =
      this.mixColors(
        dayColor,
        DIRECT_SUN_COLOR,
        glareStrength * 0.55
      );

    const lightColor =
      this.mixColors(
        apertureColor,
        DIRECT_SUN_COLOR,
        directSunIntensity * 0.35
      );

    return {
      phase,
      apertureDirection,
      apertureHalfAngleDeg: halfAngleDeg,
      centerAltitudeDeg: centerSample.altitudeDeg,
      centerAzimuthDeg: centerSample.azimuthDeg,
      sunAltitudeDeg: input.state.sun.altitudeDeg,
      sunAzimuthDeg: input.state.sun.azimuthDeg,
      sunAngularSeparationFromApertureDeg,
      sunInsideAperture,
      exteriorBrightness,
      apertureOpacity,
      diffuseLightIntensity,
      directSunIntensity,
      glareStrength,
      starVisibility,
      apertureColor,
      lightColor
    };
  }

  private getAperturePhase(
    sunAltitudeDeg: number
  ): CelestialAperturePhase {
    if (sunAltitudeDeg >= SUN_DAY_ALTITUDE_DEG) {
      return 'day';
    }

    if (sunAltitudeDeg >= SUN_NIGHT_ALTITUDE_DEG) {
      return 'twilight';
    }

    return 'night';
  }

  private getSkyExposure(
    centerAltitudeDeg: number,
    halfAngleDeg: number
  ): number {
    if (centerAltitudeDeg >= HORIZON_EXPOSURE_FADE_DEG) {
      return 1;
    }

    return this.clampNumber(
      this.smoothStep(
        -halfAngleDeg,
        HORIZON_EXPOSURE_FADE_DEG,
        centerAltitudeDeg
      ),
      0,
      1
    );
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

    return Math.acos(dot) * 180 / Math.PI;
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

  private mixColors(
    a: CelestialRgb,
    b: CelestialRgb,
    t: number
  ): CelestialRgb {
    const k =
      this.clampNumber(t, 0, 1);

    return {
      r: a.r + (b.r - a.r) * k,
      g: a.g + (b.g - a.g) * k,
      b: a.b + (b.b - a.b) * k
    };
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
}
