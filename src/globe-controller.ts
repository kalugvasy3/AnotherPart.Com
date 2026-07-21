// Ported VERBATIM from AnotherPart.Me globe-controller.ts (byte-for-byte,
// Angular import + unused SunPosition import + unused renderCanvasRef field
// removed — nothing else touched). Do not hand-edit the math.

export class GlobeController {
    // Texture alignment. The old political map (world.png) was drawn
    // shifted 12.1° in longitude and 0.55° in latitude — these constants
    // compensated for it everywhere. NASA Blue Marble (Vasily,
    // 2026-07-09: «мир без границ») is centered exactly on Greenwich,
    // so both shifts are ZERO now. If the globe texture ever changes,
    // these two constants are the only alignment knobs.
    public readonly shiftLongDeg = 0;
    public readonly shiftLatDeg = 0;

    public readonly earthRadius = 100;
    public readonly cameraRadius = 1000;

    public myLat = 0;
    public myLon = 0;

    public xRad = 0;
    public yRad = 0;

    public xCurrent = 0;
    public yCurrent = 0;
    public zCurrent = 0;

    public readonly baseMaxAngleViewCamera = Math.PI / 9;
    // Allow the Earth to be zoomed out smaller so more sky/stars are visible.
    // NOTE: zoom is FOV-based (camera.fov = angleViewCamera). base = 20°, so
    // factor 4 = 80°. Earth size ~ 1/tan(fov), and tan flips sign at 90°, i.e.
    // factor > ~4.5 pushes the FOV past 90° where the size/drag math breaks.
    // Safe ceiling ~4.4 (FOV ~88°, just under the 90° tan singularity).
    public readonly globeZoomOutLimitFactor = 4.4;
    public readonly maxAngleViewCamera =
        this.baseMaxAngleViewCamera * this.globeZoomOutLimitFactor;

    public angleViewCamera = this.baseMaxAngleViewCamera;
    public angleFullEarth = Math.PI / 6;
    public aspect = 1;

    public earthCurrentSize = 1;
    public distancePerPixel = 1;

    private heightPrev = 1;

    public constructor() {
        this.angleFullEarth = 2 * Math.atan(this.earthRadius / this.cameraRadius);
        this.updateCamera();
    }

    public setCentralPosition(
        latDeg: number,
        lonDeg: number,
        width: number,
        height: number
    ): void {
        this.yRad = this.toRadians(latDeg);

        // Без +180.
        this.xRad = this.toRadians(lonDeg - this.shiftLongDeg);

        this.calcCamera(0, 0, 0, 0, width, height);
    }

    public resetZoomAndCenter(
        latDeg: number,
        lonDeg: number,
        width: number,
        height: number
    ): void {
        this.angleViewCamera = Math.PI / 90;
        this.setCentralPosition(latDeg, lonDeg, width, height);
    }

    public getCurrentLatLonDeg(): { latDeg: number; lonDeg: number } {
        return {
            latDeg: this.toDegrees(this.yRad),
            lonDeg: this.normalizeLonDeg(
                this.toDegrees(this.xRad) + this.shiftLongDeg
            )
        };
    }



    public resize(width: number, height: number): void {
        const safeWidth = Math.max(1, width);
        const safeHeight = Math.max(1, height);

        this.aspect = safeWidth / safeHeight;

        this.angleViewCamera +=
            (this.angleViewCamera * (safeHeight - this.heightPrev)) /
            Math.max(1, this.heightPrev);

        this.heightPrev = safeHeight;

        this.angleViewCamera = this.clamp(
            this.angleViewCamera,
            Math.PI / 180 / 100,
            this.maxAngleViewCamera
        );
    }

    public zoomByWheel(deltaY: number): void {
        this.angleViewCamera += this.sign(deltaY) * this.angleViewCamera / 9;

        this.angleViewCamera = this.clamp(
            this.angleViewCamera,
            Math.PI / 180 / 100,
            this.maxAngleViewCamera
        );
    }

    public drag(
        currentX: number,
        currentY: number,
        prevX: number,
        prevY: number,
        width: number,
        height: number
    ): void {
        this.calcCamera(currentX, currentY, prevX, prevY, width, height);
    }

    public latLonNormal(
        latDeg: number,
        lonDeg: number
    ): { x: number; y: number; z: number } {
        const theta = this.toRadians(latDeg + this.shiftLatDeg);
        const phi = this.toRadians(lonDeg - this.shiftLongDeg);

        const cosTheta = Math.cos(theta);

        // Babylon: долгота идет через cos/sin, не через sin/cos как в p5.
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

    private calcCamera(
        X: number,
        Y: number,
        pX: number,
        pY: number,
        width: number,
        height: number
    ): void {
        this.earthCurrentSize =
            this.cameraRadius * 2 * Math.tan(this.angleViewCamera);

        this.distancePerPixel =
            this.earthCurrentSize / Math.max(1, height);

        // Как в p5:
        // const dX = X - pX;
        // const dY = Y - pY;
        const dX = X - pX;
        const dY = Y - pY;

        if (this.angleViewCamera >= this.angleFullEarth) {
            this.xRad -= (dX / Math.max(1, width)) * 2 * Math.PI;
            this.yRad += (dY / Math.max(1, height)) * Math.PI;
        } else {
            this.yRad += Math.asin(
                (dY * this.distancePerPixel) / this.earthRadius / 2
            );

            this.xRad -=
                Math.asin(
                    (dX * this.distancePerPixel) / this.earthRadius / 2
                ) * this.latCoeff(this.yRad);
        }

        const eps = this.toRadians(1);

        this.yRad = Math.min(
            Math.max(this.yRad, -Math.PI / 2 + eps),
            Math.PI / 2 - eps
        );

        this.xRad = this.xRad % (Math.PI * 2);

        this.updateCamera();
    }

    private updateCamera(): void {
        const cosLat = Math.cos(this.yRad);

        this.xCurrent =
            -this.cameraRadius * cosLat * Math.cos(this.xRad);

        this.yCurrent =
            this.cameraRadius * Math.sin(this.yRad);

        this.zCurrent =
            -this.cameraRadius * cosLat * Math.sin(this.xRad);
    }

    private latCoeff(latRad: number): number {
        return Math.sqrt(Math.abs(1 / Math.cos(latRad)));
    }

    private sign(x: number): number {
        return x >= 0 ? 1 : -1;
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(Math.max(value, min), max);
    }

    private toRadians(value: number): number {
        return (value * Math.PI) / 180;
    }


    public getCurrentShiftedLatLonDeg(): { latDeg: number; lonDeg: number } {
        return {
            latDeg: this.toDegrees(this.yRad),
            lonDeg: this.normalizeLonDeg(
                this.toDegrees(this.xRad) + this.shiftLongDeg
            )
        };
    }

    public latLonPosition(
        latDeg: number,
        lonDeg: number,
        radius: number = this.earthRadius
    ): { x: number; y: number; z: number } {
        const normal = this.latLonNormal(latDeg, lonDeg);

        return {
            x: normal.x * radius,
            y: normal.y * radius,
            z: normal.z * radius
        };
    }



    private toDegrees(value: number): number {
        return (value * 180) / Math.PI;
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





}