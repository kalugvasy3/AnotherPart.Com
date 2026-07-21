import {
  CelestialStarDisplayPolicy,
  type CelestialStarDisplayGroup
} from './celestial-star-display-policy';

import type {
  CelestialSystemState,
  CelestialStarState
} from './celestial-system-model';

export type CelestialSkyPreviewRendererOptions = {
  width?: number;
  height?: number;
  title?: string;
  showLabels?: boolean;
  labelLimit?: number;
  maxStarMagnitude?: number;
};

type PreviewPoint = {
  x: number;
  y: number;
};

type PreviewBounds = {
  width: number;
  height: number;
  minAltitudeDeg: number;
  maxAltitudeDeg: number;
};

// CELESTIAL_PREVIEW_RENDERER_COEFFICIENT:
// Preview image width in pixels. This is diagnostic output only;
// application renderers may use different dimensions.
const DEFAULT_PREVIEW_WIDTH = 1400;

// CELESTIAL_PREVIEW_RENDERER_COEFFICIENT:
// Preview image height in pixels. This is diagnostic output only.
const DEFAULT_PREVIEW_HEIGHT = 760;

// CELESTIAL_PREVIEW_RENDERER_COEFFICIENT:
// Lower altitude included in preview. -10° shows objects just below horizon
// for debugging sunrise/sunset and future atmosphere behaviour.
const PREVIEW_MIN_ALTITUDE_DEG = -10;

// CELESTIAL_PREVIEW_RENDERER_COEFFICIENT:
// Upper altitude included in preview. 90° is zenith.
const PREVIEW_MAX_ALTITUDE_DEG = 90;

// CELESTIAL_PREVIEW_RENDERER_COEFFICIENT:
// Default magnitude limit for preview stars. This uses real catalog stars only.
const DEFAULT_PREVIEW_MAX_STAR_MAGNITUDE = 6.2;

// CELESTIAL_PREVIEW_RENDERER_COEFFICIENT:
// Default number of constant-size star labels in preview.
const DEFAULT_PREVIEW_LABEL_LIMIT = 24;

// CELESTIAL_PREVIEW_RENDERER_COEFFICIENT:
// Minimum visible star radius in SVG pixels. This is a diagnostic readability
// value, not an astronomical angular size.
const MIN_STAR_RADIUS_PX = 0.45;

// CELESTIAL_PREVIEW_RENDERER_COEFFICIENT:
// Maximum visible star radius in SVG pixels. This keeps bright stars visible
// without turning them into blobs.
const MAX_STAR_RADIUS_PX = 2.8;

// CELESTIAL_PREVIEW_RENDERER_COEFFICIENT:
// Minimum preview Sun radius in SVG pixels. The physical angular Sun size is
// very small in an all-sky diagnostic map, so this is preview-only readability.
const MIN_SUN_RADIUS_PX = 5.0;

// CELESTIAL_PREVIEW_RENDERER_COEFFICIENT:
// Non-physical visual glow multiplier for the Sun in diagnostic SVG preview.
const SUN_PREVIEW_GLOW_MULTIPLIER = 4.5;

// CELESTIAL_PREVIEW_RENDERER_COEFFICIENT:
// Label font size in SVG pixels. Labels stay constant-size by design.
const LABEL_FONT_SIZE_PX = 12;

// CELESTIAL_PREVIEW_RENDERER_COEFFICIENT:
// Title font size in SVG pixels.
const TITLE_FONT_SIZE_PX = 15;

// CELESTIAL_PREVIEW_RENDERER_COEFFICIENT:
// Brightness normalization faint limit.
const PREVIEW_FAINT_MAGNITUDE = 6.2;

// CELESTIAL_PREVIEW_RENDERER_COEFFICIENT:
// Brightness normalization bright reference.
const PREVIEW_BRIGHT_MAGNITUDE = -1.5;

export class CelestialSkyPreviewRenderer {
  private readonly displayPolicy =
    new CelestialStarDisplayPolicy();

  public renderSvg(
    state: CelestialSystemState,
    options: CelestialSkyPreviewRendererOptions = {}
  ): string {
    const width =
      Math.max(360, Math.floor(options.width ?? DEFAULT_PREVIEW_WIDTH));

    const height =
      Math.max(220, Math.floor(options.height ?? DEFAULT_PREVIEW_HEIGHT));

    const bounds: PreviewBounds = {
      width,
      height,
      minAltitudeDeg: PREVIEW_MIN_ALTITUDE_DEG,
      maxAltitudeDeg: PREVIEW_MAX_ALTITUDE_DEG
    };

    const title =
      options.title ?? this.createDefaultTitle(state);

    const starGroups =
      this.displayPolicy.getDisplayGroups(
        state.stars,
        {
          visibleOnly: true,
          maxMagnitude: options.maxStarMagnitude ?? DEFAULT_PREVIEW_MAX_STAR_MAGNITUDE
        }
      );

    const labelGroups =
      options.showLabels === false
        ? []
        : this.displayPolicy.getLabelGroups(
            state.stars,
            {
              limit: options.labelLimit ?? DEFAULT_PREVIEW_LABEL_LIMIT
            }
          );

    const parts: string[] = [];

    parts.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    );

    parts.push(
      '<rect x="0" y="0" width="100%" height="100%" fill="rgb(0,0,0)"/>'
    );

    parts.push(
      this.renderGrid(bounds)
    );

    parts.push(
      this.renderStars(
        starGroups,
        bounds
      )
    );

    parts.push(
      this.renderSun(
        state,
        bounds
      )
    );

    parts.push(
      this.renderLabels(
        labelGroups,
        bounds
      )
    );

    parts.push(
      this.renderTitle(
        title,
        state,
        width
      )
    );

    parts.push('</svg>');

    return parts.join('\n');
  }

  private renderGrid(
    bounds: PreviewBounds
  ): string {
    const parts: string[] = [];

    for (const altitude of [0, 30, 60]) {
      const y =
        this.projectAltitudeToY(
          altitude,
          bounds
        );

      const opacity =
        altitude === 0 ? 0.42 : 0.18;

      parts.push(
        `<line x1="0" y1="${this.fmt(y)}" x2="${bounds.width}" y2="${this.fmt(y)}" stroke="rgba(120,180,210,${opacity})" stroke-width="1"/>`
      );

      parts.push(
        `<text x="8" y="${this.fmt(y - 4)}" fill="rgba(170,220,245,0.58)" font-family="Consolas, Monaco, monospace" font-size="11">${altitude}°</text>`
      );
    }

    for (const azimuth of [0, 90, 180, 270]) {
      const x =
        (azimuth / 360) * bounds.width;

      parts.push(
        `<line x1="${this.fmt(x)}" y1="0" x2="${this.fmt(x)}" y2="${bounds.height}" stroke="rgba(120,180,210,0.13)" stroke-width="1"/>`
      );

      parts.push(
        `<text x="${this.fmt(x + 5)}" y="${bounds.height - 8}" fill="rgba(170,220,245,0.48)" font-family="Consolas, Monaco, monospace" font-size="11">az ${azimuth}°</text>`
      );
    }

    return parts.join('\n');
  }

  private renderStars(
    groups: readonly CelestialStarDisplayGroup[],
    bounds: PreviewBounds
  ): string {
    const parts: string[] = [];

    for (const group of groups) {
      const star =
        group.primary;

      const point =
        this.projectAltAz(
          star.altitudeDeg,
          star.azimuthDeg,
          bounds
        );

      if (!point) {
        continue;
      }

      const radius =
        this.getStarRadius(star);

      const opacity =
        this.getStarOpacity(star);

      parts.push(
        `<circle cx="${this.fmt(point.x)}" cy="${this.fmt(point.y)}" r="${this.fmt(radius)}" fill="${this.getStarColor(star, opacity)}"/>`
      );
    }

    return parts.join('\n');
  }

  private renderSun(
    state: CelestialSystemState,
    bounds: PreviewBounds
  ): string {
    const point =
      this.projectAltAz(
        state.sun.altitudeDeg,
        state.sun.azimuthDeg,
        bounds
      );

    if (!point) {
      return '';
    }

    const physicalRadius =
      (state.sun.angularDiameterDeg * 0.5) *
      (bounds.width / 360);

    const radius =
      Math.max(
        MIN_SUN_RADIUS_PX,
        physicalRadius
      );

    const glowRadius =
      radius * SUN_PREVIEW_GLOW_MULTIPLIER;

    const sunOpacity =
      state.sun.aboveHorizon ? 0.96 : 0.34;

    const glowOpacity =
      state.sun.aboveHorizon ? 0.28 : 0.10;

    return [
      `<circle cx="${this.fmt(point.x)}" cy="${this.fmt(point.y)}" r="${this.fmt(glowRadius)}" fill="rgba(255,205,78,${glowOpacity})"/>`,
      `<circle cx="${this.fmt(point.x)}" cy="${this.fmt(point.y)}" r="${this.fmt(radius)}" fill="rgba(255,245,190,${sunOpacity})"/>`,
      `<text x="${this.fmt(point.x + radius + 6)}" y="${this.fmt(point.y - radius - 4)}" fill="rgba(255,235,170,0.92)" font-family="Consolas, Monaco, monospace" font-size="${LABEL_FONT_SIZE_PX}">Sun</text>`
    ].join('\n');
  }

  private renderLabels(
    groups: readonly CelestialStarDisplayGroup[],
    bounds: PreviewBounds
  ): string {
    const parts: string[] = [];

    for (const group of groups) {
      const star =
        group.primary;

      const point =
        this.projectAltAz(
          star.altitudeDeg,
          star.azimuthDeg,
          bounds
        );

      if (!point) {
        continue;
      }

      const x =
        this.clampNumber(
          point.x + 6,
          3,
          bounds.width - 120
        );

      const y =
        this.clampNumber(
          point.y - 5,
          16,
          bounds.height - 5
        );

      parts.push(
        `<text x="${this.fmt(x)}" y="${this.fmt(y)}" fill="rgba(220,242,255,0.84)" font-family="Consolas, Monaco, monospace" font-size="${LABEL_FONT_SIZE_PX}">${this.escapeXml(group.label)}</text>`
      );
    }

    return parts.join('\n');
  }

  private renderTitle(
    title: string,
    state: CelestialSystemState,
    width: number
  ): string {
    const subtitle = [
      `lat ${state.frame.observerLatDeg.toFixed(3)}°`,
      `lon ${state.frame.observerLonDeg.toFixed(3)}°`,
      `Sun alt ${state.sun.altitudeDeg.toFixed(2)}°`,
      `az ${state.sun.azimuthDeg.toFixed(2)}°`,
      `diam ${state.sun.angularDiameterDeg.toFixed(4)}°`
    ].join(' · ');

    return [
      `<text x="12" y="22" fill="rgba(235,250,255,0.94)" font-family="Consolas, Monaco, monospace" font-size="${TITLE_FONT_SIZE_PX}" font-weight="700">${this.escapeXml(title)}</text>`,
      `<text x="12" y="42" fill="rgba(190,220,235,0.78)" font-family="Consolas, Monaco, monospace" font-size="12">${this.escapeXml(subtitle)}</text>`,
      `<text x="${width - 12}" y="22" text-anchor="end" fill="rgba(190,220,235,0.58)" font-family="Consolas, Monaco, monospace" font-size="12">azimuth map · black sky preview</text>`
    ].join('\n');
  }

  private createDefaultTitle(
    state: CelestialSystemState
  ): string {
    return `Celestial sky preview · ${state.frame.date.toISOString()}`;
  }

  private projectAltAz(
    altitudeDeg: number,
    azimuthDeg: number,
    bounds: PreviewBounds
  ): PreviewPoint | null {
    if (
      altitudeDeg < bounds.minAltitudeDeg ||
      altitudeDeg > bounds.maxAltitudeDeg
    ) {
      return null;
    }

    return {
      x: (this.normalizeDeg360(azimuthDeg) / 360) * bounds.width,
      y: this.projectAltitudeToY(
        altitudeDeg,
        bounds
      )
    };
  }

  private projectAltitudeToY(
    altitudeDeg: number,
    bounds: PreviewBounds
  ): number {
    const t =
      (bounds.maxAltitudeDeg - altitudeDeg) /
      (bounds.maxAltitudeDeg - bounds.minAltitudeDeg);

    return this.clampNumber(t, 0, 1) * bounds.height;
  }

  private getStarRadius(
    star: CelestialStarState
  ): number {
    const brightness =
      this.getMagnitudeBrightness(star.magnitude);

    return this.clampNumber(
      MIN_STAR_RADIUS_PX + brightness * (MAX_STAR_RADIUS_PX - MIN_STAR_RADIUS_PX),
      MIN_STAR_RADIUS_PX,
      MAX_STAR_RADIUS_PX
    );
  }

  private getStarOpacity(
    star: CelestialStarState
  ): number {
    const brightness =
      this.getMagnitudeBrightness(star.magnitude);

    return this.clampNumber(
      0.34 + brightness * 0.58,
      0.16,
      0.96
    );
  }

  private getMagnitudeBrightness(
    magnitude: number
  ): number {
    return this.clampNumber(
      (PREVIEW_FAINT_MAGNITUDE - magnitude) /
        (PREVIEW_FAINT_MAGNITUDE - PREVIEW_BRIGHT_MAGNITUDE),
      0,
      1
    );
  }

  private getStarColor(
    star: CelestialStarState,
    opacity: number
  ): string {
    const colorIndex =
      Number(star.colorIndex ?? 0.42);

    if (!Number.isFinite(colorIndex)) {
      return `rgba(238,246,255,${this.fmt(opacity)})`;
    }

    if (colorIndex < 0) {
      return `rgba(210,228,255,${this.fmt(opacity)})`;
    }

    if (colorIndex > 1.25) {
      return `rgba(255,214,166,${this.fmt(opacity)})`;
    }

    if (colorIndex > 0.75) {
      return `rgba(255,234,194,${this.fmt(opacity)})`;
    }

    return `rgba(238,246,255,${this.fmt(opacity)})`;
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

  private escapeXml(
    value: string
  ): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
  }

  private fmt(
    value: number
  ): string {
    return Number.isFinite(value)
      ? value.toFixed(3)
      : '0';
  }
}
