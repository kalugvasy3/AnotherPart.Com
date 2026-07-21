import type {
  CelestialSystemState,
  CelestialVector
} from './celestial-system-model';

export type CelestialRgb = {
  r: number;
  g: number;
  b: number;
};

export type CelestialSurfaceLightInput = {
  state: CelestialSystemState;
};

export type CelestialSurfaceLightState = {
  surfaceNormal: CelestialVector;
  sunDirection: CelestialVector;

  sunAltitudeDeg: number;
  sunAzimuthDeg: number;

  // Raw dot product between local surface normal and Sun direction.
  // This is the geometric "angle of light on this Earth surface point".
  sunIncidence: number;

  // Continuous normalized components.
  directSurfaceIllumination: number;
  diffuseSkyIllumination: number;
  horizonScatter: number;
  starVisibility: number;

  // Final continuous output for UI/rendering.
  exteriorBrightness: number;
  portalOpacity: number;
  diffuseLightIntensity: number;
  directLightIntensity: number;

  portalColor: CelestialRgb;
  lightColor: CelestialRgb;
};

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Minimum exterior brightness when the location is in deep night.
// Keeps the entrance perceptible without inventing daylight.
const SURFACE_NIGHT_BRIGHTNESS_FLOOR = 0.035;

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Weak contribution of clear starry sky to the exterior brightness.
// Stars are visually important but not a strong light source.
const SURFACE_STAR_LIGHT_GAIN = 0.025;

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Direct surface illumination exponent. Values below 1.0 make low Sun angles
// still visible without producing a hard black-to-white jump.
const SURFACE_DIRECT_LIGHT_GAMMA = 0.72;

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Brightness gain from direct Sun illumination on the surface.
const SURFACE_DIRECT_BRIGHTNESS_GAIN = 0.58;

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Brightness gain from daytime sky diffusion.
const SURFACE_DAY_SKY_BRIGHTNESS_GAIN = 0.32;

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Brightness gain from low-Sun horizon scattering.
const SURFACE_HORIZON_SCATTER_BRIGHTNESS_GAIN = 0.24;

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Sun altitude where useful horizon scattering begins.
const SURFACE_HORIZON_SCATTER_START_ALT_DEG = -18.0;

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Sun altitude where horizon scattering is strong.
const SURFACE_HORIZON_SCATTER_PEAK_ALT_DEG = -3.5;

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Sun altitude where horizon warmth starts to fade into normal daylight.
const SURFACE_HORIZON_WARMTH_FADE_START_ALT_DEG = 4.0;

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Sun altitude where horizon warmth is almost gone.
const SURFACE_HORIZON_WARMTH_FADE_END_ALT_DEG = 24.0;

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Sun altitude where daytime sky diffusion starts becoming visible.
const SURFACE_DAY_SKY_START_ALT_DEG = -6.0;

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Sun altitude where daytime sky diffusion reaches full strength.
const SURFACE_DAY_SKY_FULL_ALT_DEG = 12.0;

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Star visibility is full at and below this Sun altitude.
const SURFACE_STAR_VISIBILITY_FULL_ALT_DEG = -18.0;

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Star visibility is fully suppressed by this Sun altitude.
const SURFACE_STAR_VISIBILITY_ZERO_ALT_DEG = -4.0;

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Maximum diffuse light intensity that the entrance contributes to the tunnel.
const SURFACE_MAX_DIFFUSE_LIGHT_INTENSITY = 0.62;

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Maximum direct light intensity from actual surface illumination.
const SURFACE_MAX_DIRECT_LIGHT_INTENSITY = 1.00;

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Portal opacity floor. Even at night the entrance remains a visible boundary.
const SURFACE_PORTAL_OPACITY_FLOOR = 0.16;

// CELESTIAL_SURFACE_LIGHT_COEFFICIENT:
// Portal opacity gain from continuous exterior brightness.
const SURFACE_PORTAL_OPACITY_BRIGHTNESS_GAIN = 0.72;

const SURFACE_NIGHT_COLOR: CelestialRgb = {
  r: 0.045,
  g: 0.065,
  b: 0.115
};

const SURFACE_HORIZON_COLOR: CelestialRgb = {
  r: 0.88,
  g: 0.42,
  b: 0.18
};

const SURFACE_DAY_COLOR: CelestialRgb = {
  r: 0.52,
  g: 0.76,
  b: 1.00
};

const SURFACE_DIRECT_SUN_COLOR: CelestialRgb = {
  r: 1.00,
  g: 0.82,
  b: 0.42
};

export class CelestialSurfaceLightModel {
  public createState(
    input: CelestialSurfaceLightInput
  ): CelestialSurfaceLightState {
    const surfaceNormal =
      input.state.frame.up;

    const sunDirection =
      input.state.sun.directionFromObserver;

    const sunIncidence =
      this.clampNumber(
        this.dot(surfaceNormal, sunDirection),
        -1,
        1
      );

    const directRaw =
      this.clampNumber(
        sunIncidence,
        0,
        1
      );

    const directSurfaceIllumination =
      Math.pow(
        directRaw,
        SURFACE_DIRECT_LIGHT_GAMMA
      );

    const daySky =
      this.smoothStep(
        SURFACE_DAY_SKY_START_ALT_DEG,
        SURFACE_DAY_SKY_FULL_ALT_DEG,
        input.state.sun.altitudeDeg
      );

    const horizonRise =
      this.smoothStep(
        SURFACE_HORIZON_SCATTER_START_ALT_DEG,
        SURFACE_HORIZON_SCATTER_PEAK_ALT_DEG,
        input.state.sun.altitudeDeg
      );

    const horizonFade =
      1 -
      this.smoothStep(
        SURFACE_HORIZON_WARMTH_FADE_START_ALT_DEG,
        SURFACE_HORIZON_WARMTH_FADE_END_ALT_DEG,
        input.state.sun.altitudeDeg
      );

    const horizonScatter =
      this.clampNumber(
        horizonRise * horizonFade,
        0,
        1
      );

    const starVisibility =
      1 -
      this.smoothStep(
        SURFACE_STAR_VISIBILITY_FULL_ALT_DEG,
        SURFACE_STAR_VISIBILITY_ZERO_ALT_DEG,
        input.state.sun.altitudeDeg
      );

    const diffuseSkyIllumination =
      this.clampNumber(
        SURFACE_NIGHT_BRIGHTNESS_FLOOR +
          starVisibility * SURFACE_STAR_LIGHT_GAIN +
          horizonScatter * SURFACE_HORIZON_SCATTER_BRIGHTNESS_GAIN +
          daySky * SURFACE_DAY_SKY_BRIGHTNESS_GAIN,
        0,
        1
      );

    const exteriorBrightness =
      this.clampNumber(
        SURFACE_NIGHT_BRIGHTNESS_FLOOR +
          starVisibility * SURFACE_STAR_LIGHT_GAIN +
          horizonScatter * SURFACE_HORIZON_SCATTER_BRIGHTNESS_GAIN +
          daySky * SURFACE_DAY_SKY_BRIGHTNESS_GAIN +
          directSurfaceIllumination * SURFACE_DIRECT_BRIGHTNESS_GAIN,
        SURFACE_NIGHT_BRIGHTNESS_FLOOR,
        1
      );

    const diffuseLightIntensity =
      this.clampNumber(
        diffuseSkyIllumination * SURFACE_MAX_DIFFUSE_LIGHT_INTENSITY,
        0,
        SURFACE_MAX_DIFFUSE_LIGHT_INTENSITY
      );

    const directLightIntensity =
      this.clampNumber(
        directSurfaceIllumination * SURFACE_MAX_DIRECT_LIGHT_INTENSITY,
        0,
        SURFACE_MAX_DIRECT_LIGHT_INTENSITY
      );

    const portalOpacity =
      this.clampNumber(
        SURFACE_PORTAL_OPACITY_FLOOR +
          exteriorBrightness * SURFACE_PORTAL_OPACITY_BRIGHTNESS_GAIN,
        SURFACE_PORTAL_OPACITY_FLOOR,
        0.96
      );

    const nightToHorizon =
      this.mixColors(
        SURFACE_NIGHT_COLOR,
        SURFACE_HORIZON_COLOR,
        horizonScatter
      );

    const skyColor =
      this.mixColors(
        nightToHorizon,
        SURFACE_DAY_COLOR,
        daySky
      );

    const portalColor =
      this.mixColors(
        skyColor,
        SURFACE_DIRECT_SUN_COLOR,
        directSurfaceIllumination * 0.32
      );

    const lightColor =
      this.mixColors(
        portalColor,
        SURFACE_DIRECT_SUN_COLOR,
        directSurfaceIllumination * 0.38
      );

    return {
      surfaceNormal,
      sunDirection,
      sunAltitudeDeg: input.state.sun.altitudeDeg,
      sunAzimuthDeg: input.state.sun.azimuthDeg,
      sunIncidence,
      directSurfaceIllumination,
      diffuseSkyIllumination,
      horizonScatter,
      starVisibility,
      exteriorBrightness,
      portalOpacity,
      diffuseLightIntensity,
      directLightIntensity,
      portalColor,
      lightColor
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
