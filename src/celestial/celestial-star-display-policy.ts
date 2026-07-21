import type {
  CelestialStarState,
  CelestialVector
} from './celestial-system-model';

export type CelestialStarDisplayOptions = {
  visibleOnly?: boolean;
  maxMagnitude?: number;
  duplicateAngleDeg?: number;
  requireHumanReadableName?: boolean;
  limit?: number;
};

export type CelestialStarDisplayGroup = {
  primary: CelestialStarState;
  members: readonly CelestialStarState[];
  label: string;
  memberCount: number;
  angularRadiusDeg: number;
};

// CELESTIAL_DISPLAY_POLICY_COEFFICIENT:
// Practical naked-eye render limit. This is a display policy limit only;
// it does not remove stars from the physical model.
const DEFAULT_RENDER_MAGNITUDE_LIMIT = 6.2;

// CELESTIAL_DISPLAY_POLICY_COEFFICIENT:
// Bright-star label limit. Permanent labels should be conservative;
// tooltips can still expose fainter stars later.
const DEFAULT_LABEL_MAGNITUDE_LIMIT = 2.5;

// CELESTIAL_DISPLAY_POLICY_COEFFICIENT:
// Duplicate angular threshold in degrees.
// 0.03° is 1.8 arcminutes: small enough for near-identical catalog rows,
// but large enough to group obvious HYG/proper-name duplicates.
const DEFAULT_DUPLICATE_ANGLE_DEG = 0.03;

// CELESTIAL_DISPLAY_POLICY_COEFFICIENT:
// Default number of permanent star labels. This keeps the sky readable.
// UI may override this in debug/famous-star modes.
const DEFAULT_LABEL_LIMIT = 40;

// CELESTIAL_DISPLAY_POLICY_COEFFICIENT:
// Numerical guard for vector calculations.
const VECTOR_EPSILON = 1e-12;

export class CelestialStarDisplayPolicy {
  public getDisplayGroups(
    stars: readonly CelestialStarState[],
    options: CelestialStarDisplayOptions = {}
  ): CelestialStarDisplayGroup[] {
    const maxMagnitude =
      options.maxMagnitude ?? DEFAULT_RENDER_MAGNITUDE_LIMIT;

    const duplicateAngleDeg =
      options.duplicateAngleDeg ?? DEFAULT_DUPLICATE_ANGLE_DEG;

    const visibleOnly =
      options.visibleOnly ?? false;

    const requireHumanReadableName =
      options.requireHumanReadableName ?? false;

    const candidates = stars
      .map((star, index) => {
        return {
          star,
          index
        };
      })
      .filter(({ star }) => {
        if (!Number.isFinite(star.magnitude)) {
          return false;
        }

        if (star.magnitude > maxMagnitude) {
          return false;
        }

        if (visibleOnly && !star.visibleAboveHorizon) {
          return false;
        }

        if (
          requireHumanReadableName &&
          !this.isHumanReadableStarName(star.name)
        ) {
          return false;
        }

        return this.vectorLength(star.directionFromObserver) > VECTOR_EPSILON;
      })
      .sort((a, b) => {
        if (a.star.magnitude !== b.star.magnitude) {
          return a.star.magnitude - b.star.magnitude;
        }

        return a.star.name.localeCompare(b.star.name);
      });

    const usedIndexes = new Set<number>();
    const groups: CelestialStarDisplayGroup[] = [];

    for (const candidate of candidates) {
      if (usedIndexes.has(candidate.index)) {
        continue;
      }

      const members: CelestialStarState[] = [];

      for (const other of candidates) {
        if (usedIndexes.has(other.index)) {
          continue;
        }

        const angleDeg = this.angleDegBetween(
          candidate.star.directionFromObserver,
          other.star.directionFromObserver
        );

        if (angleDeg <= duplicateAngleDeg) {
          usedIndexes.add(other.index);
          members.push(other.star);
        }
      }

      if (!members.length) {
        continue;
      }

      const primary =
        this.choosePrimaryStar(members);

      const angularRadiusDeg =
        members.reduce((maxAngle, member) => {
          return Math.max(
            maxAngle,
            this.angleDegBetween(
              primary.directionFromObserver,
              member.directionFromObserver
            )
          );
        }, 0);

      groups.push({
        primary,
        members: Object.freeze([...members]),
        label: this.getDisplayLabel(primary),
        memberCount: members.length,
        angularRadiusDeg
      });
    }

    groups.sort((a, b) => {
      if (a.primary.magnitude !== b.primary.magnitude) {
        return a.primary.magnitude - b.primary.magnitude;
      }

      return a.label.localeCompare(b.label);
    });

    const limit = options.limit;

    if (typeof limit === 'number' && Number.isFinite(limit)) {
      return groups.slice(
        0,
        Math.max(0, Math.floor(limit))
      );
    }

    return groups;
  }

  public getLabelGroups(
    stars: readonly CelestialStarState[],
    options: CelestialStarDisplayOptions = {}
  ): CelestialStarDisplayGroup[] {
    return this.getDisplayGroups(
      stars,
      {
        visibleOnly: true,
        maxMagnitude: DEFAULT_LABEL_MAGNITUDE_LIMIT,
        duplicateAngleDeg: DEFAULT_DUPLICATE_ANGLE_DEG,
        requireHumanReadableName: true,
        limit: DEFAULT_LABEL_LIMIT,
        ...options
      }
    );
  }

  public isHumanReadableStarName(
    name: string
  ): boolean {
    const normalized =
      String(name ?? '').trim();

    if (!normalized) {
      return false;
    }

    const upper =
      normalized.toUpperCase();

    if (/^\d+$/.test(upper)) {
      return false;
    }

    return !/^(HYG|HIP|HD|HR|SAO|TYC|GAIA|BD|CD|CPD|2MASS)\s*\d+/.test(upper);
  }

  private choosePrimaryStar(
    members: readonly CelestialStarState[]
  ): CelestialStarState {
    if (!members.length) {
      throw new Error('Cannot choose primary star from an empty group.');
    }

    const sorted = [...members].sort((a, b) => {
      const aHuman =
        this.isHumanReadableStarName(a.name);

      const bHuman =
        this.isHumanReadableStarName(b.name);

      if (aHuman !== bHuman) {
        return aHuman ? -1 : 1;
      }

      if (a.magnitude !== b.magnitude) {
        return a.magnitude - b.magnitude;
      }

      return a.name.localeCompare(b.name);
    });

    return sorted[0];
  }

  private getDisplayLabel(
    star: CelestialStarState
  ): string {
    return this.isHumanReadableStarName(star.name)
      ? star.name
      : star.id;
  }

  private angleDegBetween(
    a: CelestialVector,
    b: CelestialVector
  ): number {
    const normalizedA =
      this.normalizeVector(a);

    const normalizedB =
      this.normalizeVector(b);

    const dot =
      this.clampNumber(
        normalizedA.x * normalizedB.x +
          normalizedA.y * normalizedB.y +
          normalizedA.z * normalizedB.z,
        -1,
        1
      );

    return Math.acos(dot) * 180 / Math.PI;
  }

  private normalizeVector(
    vector: CelestialVector
  ): CelestialVector {
    const length =
      this.vectorLength(vector);

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

  private vectorLength(
    vector: CelestialVector
  ): number {
    return Math.sqrt(
      vector.x * vector.x +
        vector.y * vector.y +
        vector.z * vector.z
    );
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
