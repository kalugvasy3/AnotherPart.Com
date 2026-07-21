/**
 * WIKI ON THE GLOBUS — Stage 1 (Vasily, 2026-07-20).
 *
 * Built AROUND the .Me astronomy math and ported VERBATIM (Angular/API/DB
 * stripped, everything else identical — «один в один это закон»):
 *  - GlobeController: FOV-based zoom, fixed radius, resize keeps the globe
 *    a constant size;
 *  - the Earth is the .Me `globeDayNight` ShaderMaterial (texture flip in the
 *    shader, day/night terminator, dusk band, ocean glint, aerial haze, a
 *    procedural deep-zoom detail layer) — NOT a flat material;
 *  - the Sun is the real subsolar direction.
 *
 * Stage 1 = Earth from space, centred on the viewer's geolocation
 * (Greenwich/equator if unknown). Stars, planets, surface, Wikipedia next.
 */

import {
  ArcRotateCamera,
  type CloudPoint,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Effect,
  Engine,
  HemisphericLight,
  type LinesMesh,
  Matrix,
  Mesh,
  MeshBuilder,
  PointsCloudSystem,
  Quaternion,
  Scene,
  ShaderMaterial,
  Space,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector2,
  Vector3
} from '@babylonjs/core';

import { GlobeController } from './globe-controller';
import { GlobeWiki, type WikiSummary } from './globe-wiki';
import { ASTERISM_FIGURES } from './celestial/asterism-lines';
import { CITY_LABELS } from './celestial/city-labels.catalog';
import type { CelestialStarDefinition } from './celestial/celestial-environment';
import { CONSTELLATION_INFO } from './celestial/constellation-info';
import { CONSTELLATION_FIGURES } from './celestial/constellation-lines';
import {
  METEOR_SHOWERS,
  type MeteorShower,
  daysToPeak,
  isShowerActive,
  peakCountdownLabel
} from './celestial/meteor-showers';
import {
  type SolarBodySky,
  computeGalileanMoons,
  computeSolarSystemSky
} from './celestial/solar-system-positions';
import { SunPosition } from './celestial/sun-position';
import { VISIBLE_STAR_CATALOG } from './celestial/visible-star-catalog';

const canvas = document.getElementById('globeCanvas') as HTMLCanvasElement;

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
  antialias: true
});

const scene = new Scene(engine);
scene.clearColor = new Color4(2 / 255, 6 / 255, 14 / 255, 1);

const controller = new GlobeController();
const sunPosition = new SunPosition();

const RENDER_EARTH_RADIUS = 1.625;
const renderScale = RENDER_EARTH_RADIUS / controller.earthRadius;

const camera = new ArcRotateCamera(
  'globe-camera',
  0,
  0,
  controller.cameraRadius * renderScale,
  Vector3.Zero(),
  scene
);
camera.inputs.clear();
camera.minZ = 0.01;
camera.maxZ = 100;

// Faint ambient + a Sun directional light for FUTURE standard-lit bodies
// (planets); the globe itself is lit entirely by its own shader.
const ambient = new HemisphericLight('ambient-light', new Vector3(0, 1, 0), scene);
ambient.intensity = 0.34;
ambient.diffuse = new Color3(0.62, 0.72, 0.82);
ambient.groundColor = new Color3(0.035, 0.045, 0.065);

const sunLight = new DirectionalLight('sun', new Vector3(0, -1, 0), scene);
sunLight.intensity = 0.88;
sunLight.diffuse = new Color3(1, 1, 1);
sunLight.specular = new Color3(0.05, 0.05, 0.05);

// ---- The .Me globeDayNight shader (verbatim) ----------------------

Effect.ShadersStore['globeDayNightVertexShader'] = `
  precision highp float;
  attribute vec3 position;
  attribute vec3 normal;
  attribute vec2 uv;
  uniform mat4 world;
  uniform mat4 worldViewProjection;
  varying vec3 vNormalW;
  varying vec3 vPositionW;
  varying vec2 vUV;
  void main() {
    gl_Position = worldViewProjection * vec4(position, 1.0);
    vNormalW = normalize((world * vec4(normal, 0.0)).xyz);
    vPositionW = (world * vec4(position, 1.0)).xyz;
    vUV = uv;
  }`;

Effect.ShadersStore['globeDayNightFragmentShader'] = `
  precision highp float;
  varying vec3 vNormalW;
  varying vec3 vPositionW;
  varying vec2 vUV;
  uniform sampler2D diffuseSampler;
  uniform sampler2D detailSampler;
  uniform vec3 cameraPosition;
  uniform vec3 sunDirection;
  uniform float dayBoost;
  uniform float nightLevel;
  uniform float detailGate;
  uniform float deepGate;
  uniform vec2 twilightEdges;
  void main() {
    vec2 uv = vec2(1.0 - vUV.x, 1.0 - vUV.y);
    vec3 map = texture2D(diffuseSampler, uv).rgb;

    if (deepGate > 0.001) {
      vec2 ts = vec2(1.0 / 8192.0, 1.0 / 4096.0);
      vec3 smoothed = map * 0.25;
      smoothed += texture2D(diffuseSampler, uv + vec2(ts.x, 0.0)).rgb * 0.125;
      smoothed += texture2D(diffuseSampler, uv - vec2(ts.x, 0.0)).rgb * 0.125;
      smoothed += texture2D(diffuseSampler, uv + vec2(0.0, ts.y)).rgb * 0.125;
      smoothed += texture2D(diffuseSampler, uv - vec2(0.0, ts.y)).rgb * 0.125;
      smoothed += texture2D(diffuseSampler, uv + ts).rgb * 0.0625;
      smoothed += texture2D(diffuseSampler, uv - ts).rgb * 0.0625;
      smoothed += texture2D(diffuseSampler, uv + vec2(ts.x, -ts.y)).rgb * 0.0625;
      smoothed += texture2D(diffuseSampler, uv + vec2(-ts.x, ts.y)).rgb * 0.0625;

      float gx = length(
        texture2D(diffuseSampler, uv + vec2(ts.x, 0.0)).rgb -
        texture2D(diffuseSampler, uv - vec2(ts.x, 0.0)).rgb);
      float gy = length(
        texture2D(diffuseSampler, uv + vec2(0.0, ts.y)).rgb -
        texture2D(diffuseSampler, uv - vec2(0.0, ts.y)).rgb);
      float edge = smoothstep(0.10, 0.38, gx + gy);

      map = mix(map, smoothed * (1.0 - 0.30 * edge), deepGate);
    }

    if (detailGate > 0.001) {
      float d1 = texture2D(detailSampler, uv * 180.0).r;
      float d2 = texture2D(detailSampler, uv * 47.0).r;
      float detail = d1 * 0.6 + d2 * 0.4;
      map *= mix(1.0, 0.84 + 0.32 * detail, detailGate);
    }
    vec3 n = normalize(vNormalW);
    vec3 viewDir = normalize(cameraPosition - vPositionW);
    float ndl = dot(n, sunDirection);
    float lit = smoothstep(twilightEdges.x, twilightEdges.y, ndl);
    float dayShade = 0.82 + 0.18 * clamp(ndl, 0.0, 1.0);

    float duskBand =
      (1.0 - abs(clamp(ndl * 4.0, -1.0, 1.0))) * lit;
    vec3 sunset = vec3(1.14, 0.92, 0.74);
    vec3 day = map * dayBoost * dayShade;
    day = mix(day, day * sunset, duskBand);

    float oceanMask = smoothstep(0.05, 0.2, map.b - map.r);
    vec3 reflected = reflect(-sunDirection, n);
    float glint =
      pow(clamp(dot(reflected, viewDir), 0.0, 1.0), 300.0) *
      oceanMask * clamp(ndl, 0.0, 1.0);
    day += vec3(1.0, 0.88, 0.62) * glint * 0.5;

    float camGate = smoothstep(3.0, 9.0, length(cameraPosition));
    vec3 night = map * nightLevel;
    vec3 color = mix(night, day, lit);

    float haze = pow(1.0 - clamp(dot(viewDir, n), 0.0, 1.0), 2.2);
    vec3 hazeColor = vec3(0.45, 0.62, 0.85) * (0.2 + 0.8 * lit);
    color = mix(color, hazeColor, haze * 0.3 * camGate);

    gl_FragColor = vec4(color, 1.0);
  }`;

/** Procedural two-frequency luminance detail (the .Me anti-pixel trick). */
function createGlobeDetailTexture(): DynamicTexture {
  const size = 512;
  const texture = new DynamicTexture(
    'globe-detail',
    { width: size, height: size },
    scene,
    true
  );
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;

  const seed = document.createElement('canvas');
  seed.width = 64;
  seed.height = 64;
  const seedCtx = seed.getContext('2d');

  if (seedCtx) {
    const img = seedCtx.createImageData(64, 64);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 96 + Math.floor(Math.random() * 96);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    seedCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(seed, 0, 0, 64, 64, 0, 0, size, size);
  }

  const base = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < base.data.length; i += 4) {
    const jitter = (Math.random() - 0.5) * 34;
    const v = Math.min(255, Math.max(0, base.data[i] + jitter));
    base.data[i] = v;
    base.data[i + 1] = v;
    base.data[i + 2] = v;
  }

  ctx.putImageData(base, 0, 0);
  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;

  return texture;
}

const globe = MeshBuilder.CreateSphere(
  'globe',
  { diameter: RENDER_EARTH_RADIUS * 2, segments: 64 },
  scene
);

const globeTexture = new Texture('/assets/world-blue-marble.jpg', scene);
globeTexture.anisotropicFilteringLevel = 16;

const globeMaterial = new ShaderMaterial('globe-material', scene, 'globeDayNight', {
  attributes: ['position', 'normal', 'uv'],
  uniforms: [
    'world',
    'worldViewProjection',
    'cameraPosition',
    'sunDirection',
    'dayBoost',
    'nightLevel',
    'detailGate',
    'deepGate',
    'twilightEdges'
  ],
  samplers: ['diffuseSampler', 'detailSampler']
});

globeMaterial.setTexture('diffuseSampler', globeTexture);
globeMaterial.setTexture('detailSampler', createGlobeDetailTexture());
globeMaterial.setFloat('detailGate', 0);
globeMaterial.setFloat('deepGate', 0);
globeMaterial.setFloat('dayBoost', 0.85);
globeMaterial.setFloat('nightLevel', 0.1);
globeMaterial.setVector2('twilightEdges', new Vector2(-0.12, 0.22));
globeMaterial.backFaceCulling = true;
globe.material = globeMaterial;

// ---- Atmosphere rim (globeAtmosphere shader, verbatim) ------------

const atmosphere = MeshBuilder.CreateSphere(
  'atmosphere',
  { diameter: RENDER_EARTH_RADIUS * 2.36, segments: 64 },
  scene
);
atmosphere.isPickable = false;

Effect.ShadersStore['globeAtmosphereVertexShader'] = `
  precision highp float;
  attribute vec3 position;
  attribute vec3 normal;
  uniform mat4 world;
  uniform mat4 worldViewProjection;
  varying vec3 vNormalW;
  varying vec3 vPositionW;
  void main() {
    gl_Position = worldViewProjection * vec4(position, 1.0);
    vNormalW = normalize((world * vec4(normal, 0.0)).xyz);
    vPositionW = (world * vec4(position, 1.0)).xyz;
  }`;

Effect.ShadersStore['globeAtmosphereFragmentShader'] = `
  precision highp float;
  varying vec3 vNormalW;
  varying vec3 vPositionW;
  uniform vec3 cameraPosition;
  uniform vec3 sunDirection;
  uniform float earthRadius;
  void main() {
    vec3 rayDir = normalize(vPositionW - cameraPosition);
    float tca = dot(-cameraPosition, rayDir);
    vec3 closest = cameraPosition + rayDir * tca;
    float b = length(closest);
    float h = (b - earthRadius) / earthRadius;
    float outerFade = exp(-max(h, 0.0) / 0.045);
    float innerBand = smoothstep(-0.22, 0.0, min(h, 0.0));
    float profile = outerFade * mix(0.22, 1.0, innerBand);
    vec3 airNormal = normalize(closest);
    float ndl = dot(airNormal, sunDirection);
    float day = smoothstep(-0.25, 0.25, ndl);
    float dusk = 1.0 - abs(clamp(ndl * 3.0, -1.0, 1.0));
    vec3 color =
      vec3(0.35, 0.6, 1.0) * day + vec3(0.55, 0.35, 0.25) * dusk * 0.5;
    float camGate = smoothstep(3.0, 9.0, length(cameraPosition));
    float intensity =
      profile * (0.1 + 0.9 * max(day, dusk * 0.35)) * 0.85 * camGate;
    gl_FragColor = vec4(color * intensity, intensity);
  }`;

const atmosphereMaterial = new ShaderMaterial(
  'atmosphere-material',
  scene,
  'globeAtmosphere',
  {
    attributes: ['position', 'normal'],
    uniforms: [
      'world',
      'worldViewProjection',
      'cameraPosition',
      'sunDirection',
      'earthRadius'
    ],
    samplers: [],
    needAlphaBlending: true
  }
);
atmosphereMaterial.alphaMode = 1; // ALPHA_ADD — the glow adds light.
atmosphereMaterial.disableDepthWrite = true;
atmosphereMaterial.backFaceCulling = true;
atmosphereMaterial.setFloat('earthRadius', RENDER_EARTH_RADIUS);
atmosphere.material = atmosphereMaterial;

const sunDiscRadius = 58;
let sunDiscMesh: Mesh | null = null;
let sunLabelMesh: Mesh | null = null;
let sunDiscMaterial: StandardMaterial | null = null;
// Base on-screen radius of the sun disc mesh — updateSolarBodyScales
// rescales the sun disc relative to this so it keeps a constant angular
// size as the FOV zoom changes.
let sunDiscBaseRadius = 0;

// A NOAA active-region passport for the sunspot hover tooltip
// (fractions of the inner disc radius — resolution-free).
type AppSunspotRegion = {
  fx: number;
  fy: number;
  radiusFrac: number;
  region: string;
  location: string;
  area: number;
  count: number;
  spotClass: string | null;
  magClass: string | null;
  observed: string;
};

let sunspotHitRegions: AppSunspotRegion[] = [];

function updateSun(): void {
  const toSun = sunPosition.vectorToTheSun(0, 0, new Date());
  // Shader wants the TOWARD-sun vector; the light wants the ray direction.
  globeMaterial.setVector3('sunDirection', new Vector3(toSun.x, toSun.y, toSun.z));
  atmosphereMaterial.setVector3(
    'sunDirection',
    new Vector3(toSun.x, toSun.y, toSun.z)
  );
  sunLight.direction.copyFromFloats(-toSun.x, -toSun.y, -toSun.z);
  sunLight.position.copyFromFloats(
    toSun.x * RENDER_EARTH_RADIUS * 10,
    toSun.y * RENDER_EARTH_RADIUS * 10,
    toSun.z * RENDER_EARTH_RADIUS * 10
  );

  if (sunDiscMesh) {
    sunDiscMesh.position.copyFromFloats(
      toSun.x * sunDiscRadius,
      toSun.y * sunDiscRadius,
      toSun.z * sunDiscRadius
    );
  }

  if (sunLabelMesh) {
    sunLabelMesh.position.copyFromFloats(
      toSun.x * sunDiscRadius,
      toSun.y * sunDiscRadius - 1.4,
      toSun.z * sunDiscRadius
    );
  }
}

updateSun();
window.setInterval(updateSun, 60_000);

// ---- Star field + sky rotation (verbatim from .Me) ----------------
// Stars live on a `skyRoot` TransformNode that turns with sidereal time
// (GMST); each star is placed by directionFromRaDec at starFieldRadius.

const STAR_FIELD_RADIUS = 60;
const starHitPoints: { position: Vector3; star: CelestialStarDefinition }[] = [];

const skyRoot = new TransformNode('sky-root', scene);
const skyRotationBaseGmstHours = sunPosition.getGmstHours(new Date());

function getStarColor(star: CelestialStarDefinition): Color4 {
  const magnitude = Number(star.magnitude);

  const brightness = Number.isFinite(magnitude)
    ? Math.max(0.42, Math.min(1, (5.8 - magnitude) / 5.0))
    : 0.55;

  const colorIndex = Number(star.colorIndex ?? 0.5);

  let r = 1.0;
  let g = 1.0;
  let b = 1.0;

  if (Number.isFinite(colorIndex)) {
    if (colorIndex < 0) {
      r = 0.82;
      g = 0.89;
      b = 1.0;
    } else if (colorIndex > 1.25) {
      r = 1.0;
      g = 0.84;
      b = 0.66;
    } else if (colorIndex > 0.75) {
      r = 1.0;
      g = 0.92;
      b = 0.78;
    }
  }

  return new Color4(r * brightness, g * brightness, b * brightness, 1);
}

function placeStarParticle(
  particle: CloudPoint,
  star: CelestialStarDefinition,
  date: Date
): void {
  const direction = sunPosition.directionFromRaDec(
    star.raHours * 15,
    star.decDeg,
    controller.shiftLongDeg,
    controller.shiftLatDeg,
    date
  );

  particle.position = new Vector3(
    direction.x * STAR_FIELD_RADIUS,
    direction.y * STAR_FIELD_RADIUS,
    direction.z * STAR_FIELD_RADIUS
  );

  particle.color = getStarColor(star);

  starHitPoints.push({ position: particle.position, star });
}

async function createStarField(): Promise<void> {
  const stars = VISIBLE_STAR_CATALOG;
  const date = new Date();

  const pcs = new PointsCloudSystem('globe-starfield', 3, scene);

  pcs.addPoints(stars.length, (particle: CloudPoint, index: number) => {
    placeStarParticle(particle, stars[index], date);
  });

  const mesh = await pcs.buildMeshAsync();

  mesh.isPickable = false;
  mesh.renderingGroupId = 0;
  mesh.alwaysSelectAsActiveMesh = true;

  if (mesh.material instanceof StandardMaterial) {
    mesh.material.disableLighting = true;
    mesh.material.pointSize = 3;
  }

  mesh.parent = skyRoot;
}

void createStarField();

// ---- Bright-star name labels (verbatim from .Me) ------------------
// Proper-named stars brighter than the limit (plus Polaris by right)
// carry a bluish name label parented to skyRoot, so it tracks the sky.
// The TELESCOPE tier (~1800 faint names revealed on zoom) is COMMENTED
// PORT-LATER — it needs updateTelescopeStarLabels + the star pool.

const brightStarLabelMagLimit = 1.65;
const brightStarLabelMeshes: Mesh[] = [];

const STAR_DESIGNATION_RE =
  /^(?:\d|HYG |(?:Alp|Bet|Gam|Del|Eps|Zet|Eta|The|Iot|Kap|Lam|Mu|Nu|Xi|Omi|Pi|Rho|Sig|Tau|Ups|Phi|Chi|Psi|Ome)[\d-]* )/;

function starHasProperName(star: CelestialStarDefinition): boolean {
  return !!star.name && !STAR_DESIGNATION_RE.test(star.name);
}

function brightStarLabelStars(): CelestialStarDefinition[] {
  return VISIBLE_STAR_CATALOG.filter(
    (star) =>
      star.id !== 'sol' &&
      // Polaris (1.97m) misses the brightness cut, but it IS the
      // orientation star — named by right, not by magnitude.
      (star.id === 'polaris' ||
        star.magnitude <= brightStarLabelMagLimit) &&
      starHasProperName(star)
  );
}

function brightStarLabelPosition(
  star: CelestialStarDefinition,
  date: Date
): Vector3 {
  const dir = starSkyLocalDirection(star, date);

  // Just below the star point (the same trick as the planet labels —
  // a world-down offset clears the star in both views).
  return new Vector3(
    dir.x * STAR_FIELD_RADIUS,
    dir.y * STAR_FIELD_RADIUS - 0.62,
    dir.z * STAR_FIELD_RADIUS
  );
}

/** Star direction in the skyRoot LOCAL frame for "now": the node has
 *  rotated since the minute baseline, so a fresh directionFromRaDec
 *  must be counter-rotated. */
function starSkyLocalDirection(
  star: CelestialStarDefinition,
  date: Date
): Vector3 {
  const d = sunPosition.directionFromRaDec(
    star.raHours * 15,
    star.decDeg,
    controller.shiftLongDeg,
    controller.shiftLatDeg,
    date
  );

  let dir = new Vector3(d.x, d.y, d.z);
  const rot = skyRoot?.rotation.y ?? 0;

  if (rot !== 0) {
    dir = Vector3.TransformCoordinates(dir, Matrix.RotationY(-rot));
  }

  return dir;
}

function createStarNameLabel(
  scene: Scene,
  star: CelestialStarDefinition,
  date: Date,
  options: {
    texWidth: number;
    texHeight: number;
    fontPx: number;
    planeWidth: number;
    planeHeight: number;
    alpha: number;
    color?: string;
  }
): Mesh {
  const texture = new DynamicTexture(
    `star-name-label-tex-${star.id}`,
    { width: options.texWidth, height: options.texHeight },
    scene,
    false
  );

  texture.hasAlpha = true;

  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;

  ctx.clearRect(0, 0, options.texWidth, options.texHeight);
  ctx.font = `bold ${options.fontPx}px Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 7;
  // BRIGHT BLUE starlight; how much it GLOWS is the material alpha ∝
  // brightness below.
  ctx.fillStyle = options.color ?? 'rgba(140, 205, 255, 1)';
  ctx.fillText(star.name, options.texWidth / 2, options.texHeight / 2);
  texture.update();

  const material = new StandardMaterial(
    `star-name-label-mat-${star.id}`,
    scene
  );

  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.emissiveColor = new Color3(1, 1, 1);
  material.useAlphaFromDiffuseTexture = true;
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.specularColor = new Color3(0, 0, 0);
  material.alpha = options.alpha;

  const plane = MeshBuilder.CreatePlane(
    `star-name-label-${star.id}`,
    { width: options.planeWidth, height: options.planeHeight },
    scene
  );

  plane.material = material;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.isPickable = false;
  plane.renderingGroupId = 0;
  plane.position.copyFrom(brightStarLabelPosition(star, date));
  plane.metadata = { brightStarId: star.id };
  plane.parent = skyRoot;

  return plane;
}

function createBrightStarLabels(scene: Scene): void {
  const date = new Date();

  for (const star of brightStarLabelStars()) {
    const plane = createStarNameLabel(scene, star, date, {
      texWidth: 512,
      texHeight: 128,
      fontPx: 36,
      planeWidth: 3.4,
      planeHeight: 0.85,
      alpha: 1
    });

    plane.alwaysSelectAsActiveMesh = true;
    brightStarLabelMeshes.push(plane);
  }

  // PORT-LATER: TELESCOPE tier — the lazy staircase of ~1800 faint
  // proper-name + designation labels revealed by zoom. Needs the
  // telescopeStarPool build here plus updateTelescopeStarLabels(fov)
  // in the render pulse (see .Me createBrightStarLabels tail).
}

// Labels repositioned live on the same 60s tick as the stars themselves.
function refreshBrightStarLabels(): void {
  const date = new Date();
  const byId = new Map(
    brightStarLabelStars().map((star) => [star.id, star] as const)
  );

  for (const label of brightStarLabelMeshes) {
    const id = (label.metadata as { brightStarId?: string } | undefined)
      ?.brightStarId;
    const star = id ? byId.get(id) : undefined;

    if (star) {
      label.position.copyFrom(brightStarLabelPosition(star, date));
    }
  }
}

createBrightStarLabels(scene);
window.setInterval(refreshBrightStarLabels, 60_000);

// ---- Sun disc + «SUN» label (verbatim; sunspots are a later step) --

function createSunDisc(): void {
  const diameter = 2 * sunDiscRadius * Math.tan((0.27 * Math.PI) / 180);

  const disc = MeshBuilder.CreateDisc(
    'sun-disc',
    { radius: diameter * 0.5, tessellation: 48 },
    scene
  );

  const material = new StandardMaterial('sun-disc-material', scene);
  material.disableLighting = true;
  material.emissiveColor = new Color3(1.0, 0.96, 0.82);
  material.diffuseColor = new Color3(0, 0, 0);
  material.specularColor = new Color3(0, 0, 0);

  disc.material = material;
  disc.billboardMode = Mesh.BILLBOARDMODE_ALL;
  disc.isPickable = false;
  disc.renderingGroupId = 0;
  disc.parent = skyRoot;

  sunDiscMesh = disc;
  sunDiscMaterial = material;
  sunDiscBaseRadius = diameter * 0.5;

  const labelTexture = new DynamicTexture(
    'sun-label-tex',
    { width: 512, height: 128 },
    scene,
    false
  );
  labelTexture.hasAlpha = true;

  const ctx = labelTexture.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 512, 128);
  ctx.font = '44px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = 'rgba(255, 214, 70, 0.95)';
  ctx.fillText('SUN', 256, 64);
  labelTexture.update();

  const labelMaterial = new StandardMaterial('sun-label-material', scene);
  labelMaterial.diffuseTexture = labelTexture;
  labelMaterial.emissiveTexture = labelTexture;
  labelMaterial.emissiveColor = new Color3(1, 1, 1);
  labelMaterial.useAlphaFromDiffuseTexture = true;
  labelMaterial.disableLighting = true;
  labelMaterial.backFaceCulling = false;
  labelMaterial.specularColor = new Color3(0, 0, 0);

  const label = MeshBuilder.CreatePlane(
    'sun-label',
    { width: 6.4, height: 1.6 },
    scene
  );
  label.material = labelMaterial;
  label.billboardMode = Mesh.BILLBOARDMODE_ALL;
  label.isPickable = false;
  label.renderingGroupId = 0;
  label.parent = skyRoot;

  sunLabelMesh = label;
}

createSunDisc();
updateSun();

// ---- Sunspots (verbatim from .Me) ---------------------------------
// NOAA SWPC publishes active regions daily as machine JSON. We DRAW the
// schematic onto the sun disc: black umbra cores at the REAL positions,
// sized by area/count. Hover → the region's passport. The .Me backend
// image-proxy is replaced by a DIRECT CORS fetch (NOAA sends
// Access-Control-Allow-Origin: *), since we have no backend.

function applySunSpotsTexture(scene: Scene): void {
  const material = sunDiscMaterial;

  if (!material) {
    return;
  }

  const url = 'https://services.swpc.noaa.gov/json/solar_regions.json';

  void fetch(url)
    .then((response) => response.json())
    .then(
      (
        regions: Array<{
          observed_date?: string;
          region?: number | string | null;
          location?: string | null;
          area?: number | null;
          number_spots?: number | null;
          spot_class?: string | null;
          mag_class?: string | null;
        }>
      ) => {
        if (!sunDiscMaterial || sunDiscMaterial !== material) {
          return;
        }

        if (!Array.isArray(regions) || regions.length === 0) {
          return;
        }

        // The latest observation day only.
        let latest = '';

        for (const entry of regions) {
          if ((entry.observed_date ?? '') > latest) {
            latest = entry.observed_date ?? '';
          }
        }

        const spots: Array<{
          fx: number;
          fy: number;
          area: number;
          count: number;
          region: string;
          location: string;
          spotClass: string | null;
          magClass: string | null;
        }> = [];

        for (const entry of regions) {
          if (entry.observed_date !== latest) {
            continue;
          }

          const area = entry.area ?? 0;
          const numberSpots = entry.number_spots ?? 0;
          const match = /([NS])(\d+)([EW])(\d+)/.exec(entry.location ?? '');

          if (area <= 0 || numberSpots <= 0 || !match) {
            continue;
          }

          const latDeg = (match[1] === 'N' ? 1 : -1) * Number(match[2]);
          const lonDeg = (match[3] === 'W' ? 1 : -1) * Number(match[4]);

          if (Math.abs(lonDeg) > 88) {
            continue; // On the limb — hidden edge-on.
          }

          // Orthographic disc projection, north up, west limb right.
          const lat = (latDeg * Math.PI) / 180;
          const lon = (lonDeg * Math.PI) / 180;

          spots.push({
            fx: Math.cos(lat) * Math.sin(lon),
            fy: Math.sin(lat),
            area,
            count: numberSpots,
            region: String(entry.region ?? '?'),
            location: entry.location ?? '',
            spotClass: entry.spot_class ?? null,
            magClass: entry.mag_class ?? null
          });
        }

        const size = 1024;
        const texture = new DynamicTexture(
          'sun-spots-tex',
          { width: size, height: size },
          scene,
          true
        );

        texture.hasAlpha = true;

        const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
        const r = size / 2;
        const rIn = r - 6;

        ctx.clearRect(0, 0, size, size);
        ctx.beginPath();
        ctx.arc(r, r, rIn, 0, Math.PI * 2);
        // Our cream — the disc's own colour, baked in (emissiveTexture
        // ignores emissiveColor, the familiar trap).
        ctx.fillStyle = 'rgb(255, 245, 209)';
        ctx.fill();

        for (const spot of spots) {
          const x = r + spot.fx * rIn;
          const y = r - spot.fy * rIn;
          // Millionths of the HEMISPHERE → linear disc fraction.
          const radius = Math.max(
            6,
            rIn * Math.sqrt((2 * spot.area) / 1_000_000) * 3.2
          );

          // AREA → penumbra size, COUNT → cluster of umbra cores,
          // INTENSITY → the near-zero darkness of the cores. Cores
          // scatter on a deterministic golden-angle spiral.
          const cores = Math.max(1, Math.min(9, spot.count));
          const coreRadius = Math.max(3.5, (radius * 0.55) / Math.sqrt(cores));

          ctx.fillStyle = 'rgb(0, 0, 0)';

          for (let k = 0; k < cores; k++) {
            const angle = k * 2.399963; // The golden angle.
            const dist =
              cores === 1 ? 0 : radius * 0.55 * Math.sqrt((k + 0.5) / cores);

            ctx.beginPath();
            ctx.arc(
              x + Math.cos(angle) * dist,
              y + Math.sin(angle) * dist,
              coreRadius,
              0,
              Math.PI * 2
            );
            ctx.fill();
          }
        }

        texture.update();

        // The regions' passports for the hover tooltip.
        sunspotHitRegions = spots.map((spot) => ({
          fx: spot.fx,
          fy: spot.fy,
          radiusFrac:
            Math.max(6, rIn * Math.sqrt((2 * spot.area) / 1_000_000) * 3.2) /
            rIn,
          region: spot.region,
          location: spot.location,
          area: spot.area,
          count: spot.count,
          spotClass: spot.spotClass,
          magClass: spot.magClass,
          observed: latest
        }));

        // On this path emissiveColor ADDS to emissiveTexture — the cream
        // lives in the canvas now; the color goes to zero.
        material.emissiveColor = new Color3(0, 0, 0);
        material.emissiveTexture = texture;
        material.opacityTexture = texture;
        console.log(
          `[sky] sunspots drawn from NOAA data: ${spots.length} region(s), ${latest}`
        );
      }
    )
    .catch((error) =>
      console.warn('[sky] sunspot data failed — plain disc stays:', error)
    );
}

function findSunspotAtScreenPoint(x: number, y: number): AppSunspotRegion | null {
  if (!sunDiscMesh || sunspotHitRegions.length === 0) {
    return null;
  }

  const pick = scene.pick(x, y, (mesh) => mesh === sunDiscMesh);

  if (!pick?.hit) {
    return null;
  }

  const uv = pick.getTextureCoordinates();

  if (!uv) {
    return null;
  }

  // UV center (0.5, 0.5) = disc center; +u right = +fx (west limb),
  // +v up = +fy (north up).
  const fx = (uv.x - 0.5) * 2;
  const fy = (uv.y - 0.5) * 2;

  let best: { spot: AppSunspotRegion; dist: number } | null = null;

  for (const spot of sunspotHitRegions) {
    const dist = Math.hypot(fx - spot.fx, fy - spot.fy);

    if (dist <= spot.radiusFrac + 0.035 && (!best || dist < best.dist)) {
      best = { spot, dist };
    }
  }

  return best?.spot ?? null;
}

function showSunspotTooltip(e: PointerEvent, spot: AppSunspotRegion): void {
  const point = tooltipPointerPoint(e);

  const rows: string[] = [
    `<strong>Active region ${escapeHtml(spot.region)}</strong>`,
    `sunspot group · ${escapeHtml(spot.location)}`,
    `area: ${spot.area} millionths of the solar hemisphere`,
    `spots in the group: ${spot.count}`
  ];

  if (spot.spotClass) {
    rows.push(`spot class: ${escapeHtml(spot.spotClass)} (McIntosh)`);
  }

  if (spot.magClass) {
    rows.push(`magnetic class: ${escapeHtml(spot.magClass)}`);
  }

  rows.push(`observed: ${escapeHtml(spot.observed)} · NOAA SWPC`);

  starTooltipEl.innerHTML = rows.join('<br>');
  placeOverlayByQuadrant(starTooltipEl, point.x, point.y, 14);
  starTooltipEl.style.display = 'block';
}

applySunSpotsTexture(scene);

// ---- Solar-system bodies (verbatim from .Me globe-stage) -----------
// Moon, planets and Saturn's rings as textured spheres, each lit by its
// OWN sun-direction light (honest phases); Galilean moons as a line of
// four dots. Ported one-to-one; the un-portable telescope faint-star
// tier is COMMENTED with a PORT-LATER note for a quick uncomment.

// True IAU rotation poles [RA°, Dec°] — the texture axis aims here.
const PLANET_POLE_RADEC: Partial<Record<string, [number, number]>> = {
  moon: [269.995, 66.539],
  mercury: [281.01, 61.414],
  venus: [272.76, 67.16],
  mars: [317.681, 52.887],
  jupiter: [268.057, 64.495]
};

// Characteristic tints; SIZES are honest — the true angular radius from
// the ephemeris, with a small pixel floor so a body never vanishes.
const SOLAR_BODY_STYLE: Record<string, { color: [number, number, number] }> = {
  moon: { color: [0.93, 0.94, 0.9] },
  mercury: { color: [0.78, 0.75, 0.7] },
  venus: { color: [1.0, 0.97, 0.88] },
  mars: { color: [1.0, 0.5, 0.3] },
  jupiter: { color: [0.96, 0.9, 0.75] },
  saturn: { color: [0.94, 0.88, 0.65] }
};

// Nothing on the sky shrinks below this on-screen size.
const SOLAR_BODY_MIN_RADIUS_PX = 3;

const solarBodyMeshes: Mesh[] = [];
const solarBodyHits: { position: Vector3; body: SolarBodySky }[] = [];
const solarBodyLights: DirectionalLight[] = [];

function createMoonMesh(
  scene: Scene,
  body: SolarBodySky,
  radius: number
): Mesh {
  const mesh = MeshBuilder.CreateSphere(
    'solar-body-moon',
    { diameter: radius * 2, segments: 64 },
    scene
  );

  const material = new StandardMaterial('solar-body-mat-moon', scene);

  material.diffuseTexture = new Texture(
    'assets/celestial/lroc_color_2k.jpg',
    scene
  );
  material.specularColor = new Color3(0, 0, 0);
  // A whisper of earthshine so the dark side reads as a silhouette.
  material.emissiveColor = new Color3(0.045, 0.05, 0.06);

  // Eclipse tint: the umbra bite became a whole-disc tone for the
  // sphere — copper for the blood moon, near-dark for partial, a
  // gentle dusk for penumbral.
  if (body.eclipse) {
    material.diffuseColor =
      body.eclipse.kind === 'total'
        ? new Color3(0.85, 0.35, 0.2)
        : body.eclipse.kind === 'partial'
          ? new Color3(0.5, 0.4, 0.38)
          : new Color3(0.75, 0.72, 0.7);
  } else {
    material.diffuseColor = new Color3(1, 1, 1);
  }

  mesh.material = material;

  // The ambient hemispheric light would gray the night side and eat
  // the terminator — only the sun light shapes the Moon.
  const ambientLight = scene.getLightByName('ambient-light');

  if (ambientLight && !ambientLight.excludedMeshes.includes(mesh)) {
    ambientLight.excludedMeshes.push(mesh);
  }

  return mesh;
}

/** Textured planet spheres. Jupiter — the Cassini map (NASA/JPL
 *  PIA07782), Mars — the Viking MDIM mosaic, Mercury — MESSENGER MDIS.
 *  Venus is a featureless cloud ball, so her texture is drawn by hand —
 *  but the SPHERE gives her honest phases from the sun light. */
function createTexturedPlanetMesh(
  scene: Scene,
  id: 'jupiter' | 'mars' | 'venus' | 'mercury'
): Mesh {
  const mesh = MeshBuilder.CreateSphere(
    `solar-body-${id}`,
    { diameter: 2, segments: 48 },
    scene
  );
  const material = new StandardMaterial(`solar-body-mat-${id}`, scene);

  if (id === 'venus') {
    material.diffuseTexture = createVenusCloudTexture(scene);
  } else {
    material.diffuseTexture = new Texture(
      id === 'jupiter'
        ? 'assets/celestial/PIA07782.jpg'
        : id === 'mars'
          ? 'assets/celestial/mars_viking_4k.jpg'
          : 'assets/celestial/mercury_messenger_clrmosaic_global_1024.jpg',
      scene
    );
  }

  material.specularColor = new Color3(0, 0, 0);
  material.diffuseColor = new Color3(1, 1, 1);
  // A whisper of self-light so the night side reads as a silhouette.
  material.emissiveColor = new Color3(0.035, 0.035, 0.04);
  mesh.material = material;

  // Only the sun shapes the disc — the ambient light would flatten
  // the phase (same rule as the Moon).
  const ambientLight = scene.getLightByName('ambient-light');

  if (ambientLight && !ambientLight.excludedMeshes.includes(mesh)) {
    ambientLight.excludedMeshes.push(mesh);
  }

  return mesh;
}

/** Venus: soft cream cloud bands, hand-drawn. */
function createVenusCloudTexture(scene: Scene): DynamicTexture {
  const texture = new DynamicTexture(
    'solar-body-tex-venus',
    { width: 512, height: 256 },
    scene,
    false
  );
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;

  ctx.fillStyle = '#f0e4c4';
  ctx.fillRect(0, 0, 512, 256);

  // Gentle chevron bands — the Y-shaped cloud pattern Venus is known
  // for, abstracted to a few soft strokes.
  const bands = [
    { y: 40, tone: 'rgba(214, 196, 158, 0.5)', height: 26 },
    { y: 92, tone: 'rgba(224, 205, 164, 0.55)', height: 34 },
    { y: 128, tone: 'rgba(206, 186, 148, 0.45)', height: 30 },
    { y: 170, tone: 'rgba(222, 204, 166, 0.5)', height: 32 },
    { y: 214, tone: 'rgba(212, 194, 156, 0.45)', height: 24 }
  ];

  for (const band of bands) {
    ctx.fillStyle = band.tone;
    ctx.beginPath();

    for (let x = 0; x <= 512; x += 8) {
      const bow = Math.sin((x / 512) * Math.PI * 2) * 10;
      const y = band.y + bow * Math.sin((band.y / 256) * Math.PI);

      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    for (let x = 512; x >= 0; x -= 8) {
      const bow = Math.sin((x / 512) * Math.PI * 2) * 10;
      const y =
        band.y +
        band.height +
        bow * Math.sin(((band.y + band.height) / 256) * Math.PI);

      ctx.lineTo(x, y);
    }

    ctx.closePath();
    ctx.fill();
  }

  texture.update();

  return texture;
}

/** Saturn WITH its rings at the honest opening angle. Back half → ball
 *  with faint bands → front half, classic occlusion. */
function createSaturnMesh(scene: Scene, body: SolarBodySky): Mesh {
  const texture = new DynamicTexture(
    'solar-body-tex-saturn',
    { width: 256, height: 256 },
    scene,
    false
  );

  texture.hasAlpha = true;

  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  const cx = 128;
  const cy = 128;
  const planetR = 52;
  const outerRx = 118;
  const innerRx = 78;
  const squash = Math.max(
    Math.abs(Math.sin(((body.ringTiltDeg ?? 12) * Math.PI) / 180)),
    0.035
  );
  const outerRy = outerRx * squash;
  const innerRy = innerRx * squash;

  ctx.clearRect(0, 0, 256, 256);

  const annulusPath = (): void => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, outerRx, outerRy, 0, 0, Math.PI * 2);
    ctx.ellipse(cx, cy, innerRx, innerRy, 0, 0, Math.PI * 2);
  };

  // Back half of the rings (behind the ball).
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, 256, cy);
  ctx.clip();
  annulusPath();
  ctx.fillStyle = 'rgba(205, 192, 158, 0.75)';
  ctx.fill('evenodd');
  ctx.restore();

  // The ball with faint bands.
  ctx.beginPath();
  ctx.arc(cx, cy, planetR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(240, 224, 180, 0.98)';
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, planetR, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(190, 168, 120, 0.32)';
  ctx.fillRect(cx - planetR, cy - 38, planetR * 2, 6);
  ctx.fillRect(cx - planetR, cy - 16, planetR * 2, 9);
  ctx.fillRect(cx - planetR, cy + 10, planetR * 2, 7);
  ctx.restore();

  // Front half of the rings (over the ball) + a Cassini-division hint.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, cy, 256, 128);
  ctx.clip();
  annulusPath();
  ctx.fillStyle = 'rgba(232, 220, 186, 0.92)';
  ctx.fill('evenodd');
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy,
    (outerRx + innerRx) / 2,
    (outerRy + innerRy) / 2,
    0,
    0,
    Math.PI * 2
  );
  ctx.strokeStyle = 'rgba(60, 50, 35, 0.55)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  texture.update();

  const material = new StandardMaterial('solar-body-mat-saturn', scene);

  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.emissiveColor = new Color3(1, 1, 1);
  material.useAlphaFromDiffuseTexture = true;
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.specularColor = new Color3(0, 0, 0);

  const mesh = MeshBuilder.CreatePlane(
    'solar-body-saturn',
    { size: 2 },
    scene
  );

  mesh.material = material;

  return mesh;
}

/** GALILEAN MOONS — four pale dots on Jupiter's equator line, the dance
 *  Galileo saw in January 1610. Positions self-computed (Meeus ch. 44),
 *  verified against JPL Horizons. Dots appear only when the system spans
 *  ≥ 12 px on screen (see updateSolarBodyScales). */
function createGalileanMoonDots(
  scene: Scene,
  jupiter: SolarBodySky,
  date: Date
): void {
  const moons = computeGalileanMoons(date);
  const jd = sunPosition.directionFromRaDec(
    jupiter.raDeg,
    jupiter.decDeg,
    controller.shiftLongDeg,
    controller.shiftLatDeg,
    date
  );
  const j = new Vector3(jd.x, jd.y, jd.z);
  // The SAME true IAU pole the textured globe uses — the moon line and
  // the bands share one frame now.
  const jupiterPole = PLANET_POLE_RADEC['jupiter']!;
  const pd = sunPosition.directionFromRaDec(
    jupiterPole[0],
    jupiterPole[1],
    controller.shiftLongDeg,
    controller.shiftLatDeg,
    date
  );
  const pole = new Vector3(pd.x, pd.y, pd.z);
  // Cross ORDER verified numerically against Horizons: Cross(j, pole)
  // points toward increasing RA.
  let east = Vector3.Cross(j, pole);

  if (east.lengthSquared() < 1e-6) {
    return; // Degenerate geometry — skip this tick.
  }

  east = east.normalize();

  const north = Vector3.Cross(j, east).normalize();
  const jupAngRad = (jupiter.angularRadiusDeg * Math.PI) / 180;

  for (const gm of moons) {
    const dir = j
      .add(east.scale(-gm.xJupiterRadii * jupAngRad))
      .add(north.scale(gm.yJupiterRadii * jupAngRad))
      .normalize();
    const position = dir.scale(STAR_FIELD_RADIUS * 0.98);

    const mesh = MeshBuilder.CreateDisc(
      `solar-body-${gm.id}`,
      { radius: 1, tessellation: 24 },
      scene
    );
    const material = new StandardMaterial(
      `solar-body-mat-${gm.id}`,
      scene
    );

    material.emissiveColor = new Color3(0.88, 0.9, 0.92);
    material.diffuseColor = new Color3(0, 0, 0);
    material.specularColor = new Color3(0, 0, 0);
    material.disableLighting = true;
    mesh.material = material;
    mesh.position = position;
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.isPickable = false;
    mesh.renderingGroupId = 0;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.metadata = {
      solarAngularRad: (gm.angularRadiusDeg * Math.PI) / 180,
      galilean: true,
      // Callisto's orbit spans ±26.4 R_J — the whole system's width.
      galileanSystemSpreadRad: 26.4 * jupAngRad
    };
    mesh.parent = skyRoot;

    solarBodyMeshes.push(mesh);
    solarBodyHits.push({
      position,
      body: {
        id: gm.id,
        name: gm.name,
        raDeg: jupiter.raDeg,
        decDeg: jupiter.decDeg,
        distanceLabel: gm.distanceLabel,
        angularRadiusDeg: gm.angularRadiusDeg
      } as SolarBodySky
    });
  }
}

function createSolarSystemBodies(scene: Scene): void {
  const date = new Date();
  const bodies = computeSolarSystemSky(date);

  for (const body of bodies) {
    const style = SOLAR_BODY_STYLE[body.id];

    if (!style) {
      continue;
    }

    const direction = sunPosition.directionFromRaDec(
      body.raDeg,
      body.decDeg,
      controller.shiftLongDeg,
      controller.shiftLatDeg,
      date
    );

    const position = new Vector3(
      direction.x,
      direction.y,
      direction.z
    ).scale(STAR_FIELD_RADIUS * 0.98);

    let bodyMesh: Mesh;

    if (body.id === 'moon') {
      // UNIT half-size — the true scale comes from updateSolarBodyScales.
      bodyMesh = createMoonMesh(scene, body, 1);
    } else if (body.id === 'saturn') {
      bodyMesh = createSaturnMesh(scene, body);
    } else if (
      body.id === 'jupiter' ||
      body.id === 'mars' ||
      body.id === 'venus' ||
      body.id === 'mercury'
    ) {
      bodyMesh = createTexturedPlanetMesh(scene, body.id);
    } else {
      bodyMesh = MeshBuilder.CreateDisc(
        `solar-body-${body.id}`,
        { radius: 1, tessellation: 32 },
        scene
      );

      const material = new StandardMaterial(
        `solar-body-mat-${body.id}`,
        scene
      );

      material.emissiveColor = new Color3(...style.color);
      material.diffuseColor = new Color3(0, 0, 0);
      material.specularColor = new Color3(0, 0, 0);
      material.disableLighting = true;
      bodyMesh.material = material;
    }

    bodyMesh.position = position;
    bodyMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;

    if (
      body.id === 'moon' ||
      body.id === 'jupiter' ||
      body.id === 'mars' ||
      body.id === 'venus' ||
      body.id === 'mercury'
    ) {
      // REAL textured spheres — billboarding would spin the map. Turn
      // the map center (local −X) toward the Earth's center AND aim the
      // sphere's axis at the body's TRUE pole — the bands lie along the
      // moon line, Mars' caps and the Moon's craters stand honestly.
      bodyMesh.billboardMode = Mesh.BILLBOARDMODE_NONE;

      const toEarth = position.clone().normalize().scale(-1);
      const poleRaDec = PLANET_POLE_RADEC[body.id];
      let oriented = false;

      if (poleRaDec) {
        const p = sunPosition.directionFromRaDec(
          poleRaDec[0],
          poleRaDec[1],
          controller.shiftLongDeg,
          controller.shiftLatDeg,
          date
        );
        const pole = new Vector3(p.x, p.y, p.z);
        // Project the pole off the line of sight → the sphere's up.
        const up = pole.subtract(
          toEarth.scale(Vector3.Dot(pole, toEarth))
        );

        if (up.lengthSquared() > 1e-6) {
          up.normalize();
          // 180° roll — the sphere's texture V-axis runs opposite to
          // the assumed north; flipping the projected pole turns the
          // disc around the line of sight WITHOUT mirroring. The spin
          // sign flips with it below.
          up.scaleInPlace(-1);

          // Local −X → Earth, local +Y → (anti)pole, +Z completes.
          const xAxis = toEarth.scale(-1);
          const zAxis = Vector3.Cross(xAxis, up);

          bodyMesh.rotationQuaternion =
            Quaternion.RotationQuaternionFromAxis(xAxis, up, zAxis);
          oriented = true;
        }
      }

      if (!oriented) {
        const facing = new Quaternion();

        Quaternion.FromUnitVectorsToRef(
          new Vector3(-1, 0, 0),
          toEarth,
          facing
        );
        bodyMesh.rotationQuaternion = facing;
      }

      // Jupiter turns in 9h55m — on the minute tick the Great Red Spot
      // honestly drifts across the disc. Mars gets its 24.6h day too.
      const rotationPeriodH =
        body.id === 'jupiter' ? 9.925 : body.id === 'mars' ? 24.6229 : 0;

      if (rotationPeriodH > 0) {
        const spin =
          (((date.getTime() / 3600000) % rotationPeriodH) /
            rotationPeriodH) *
          Math.PI *
          2;

        // MINUS: local +Y is the flipped pole (see the 180° roll above)
        // — the drift direction stays physically honest.
        bodyMesh.rotate(new Vector3(0, 1, 0), -spin, Space.LOCAL);
      }

      // HONEST LIGHT: a dedicated sun for this body, aimed along the
      // true Sun→body direction from the ephemeris. The global sun
      // light (Earth's direction) is excluded.
      if (
        body.sunDirRaDeg !== undefined &&
        body.sunDirDecDeg !== undefined
      ) {
        const ld = sunPosition.directionFromRaDec(
          body.sunDirRaDeg,
          body.sunDirDecDeg,
          controller.shiftLongDeg,
          controller.shiftLatDeg,
          date
        );
        const light = new DirectionalLight(
          `solar-sunlight-${body.id}`,
          new Vector3(ld.x, ld.y, ld.z),
          scene
        );

        light.intensity = 1.1;
        light.diffuse = new Color3(1, 1, 1);
        light.specular = new Color3(0, 0, 0);
        light.includedOnlyMeshes.push(bodyMesh);
        solarBodyLights.push(light);
        sunLight.excludedMeshes.push(bodyMesh);
      }
    }

    bodyMesh.isPickable = false;
    bodyMesh.renderingGroupId = 0;
    bodyMesh.metadata = {
      // Saturn's texture spans the RINGS (2.27× the planet), so its
      // plane scales accordingly — the ball inside stays honest.
      solarAngularRad:
        ((body.angularRadiusDeg * Math.PI) / 180) *
        (body.id === 'saturn' ? 2.27 : 1),
      // Textured globes glow like markers at wide view and go dark for
      // the honest sunlight when resolved.
      texturedGlobe: ['moon', 'mercury', 'venus', 'mars', 'jupiter'].includes(
        body.id
      ),
      markerColor: style.color
    };

    // Name label just below the body.
    const labelTexture = new DynamicTexture(
      `solar-label-tex-${body.id}`,
      { width: 256, height: 64 },
      scene,
      false
    );

    labelTexture.hasAlpha = true;

    const ctx = labelTexture.getContext() as unknown as CanvasRenderingContext2D;

    ctx.clearRect(0, 0, 256, 64);
    // AMBER and bold: solar-system names must be clearly distinct from
    // the bluish star/constellation labels.
    ctx.font = 'bold 34px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = 7;
    ctx.fillStyle = 'rgba(255, 214, 130, 0.96)';
    ctx.fillText(body.name.toUpperCase(), 128, 32);
    labelTexture.update();

    const labelMaterial = new StandardMaterial(
      `solar-label-mat-${body.id}`,
      scene
    );

    labelMaterial.diffuseTexture = labelTexture;
    labelMaterial.emissiveTexture = labelTexture;
    labelMaterial.emissiveColor = new Color3(1, 1, 1);
    labelMaterial.useAlphaFromDiffuseTexture = true;
    labelMaterial.disableLighting = true;
    labelMaterial.backFaceCulling = false;
    labelMaterial.specularColor = new Color3(0, 0, 0);

    const label = MeshBuilder.CreatePlane(
      `solar-label-${body.id}`,
      { width: 3.6, height: 0.9 },
      scene
    );

    label.material = labelMaterial;
    label.billboardMode = Mesh.BILLBOARDMODE_ALL;
    label.isPickable = false;
    label.renderingGroupId = 0;
    // BELOW the body, not across it.
    label.position = position.add(new Vector3(0, -0.85, 0));

    bodyMesh.parent = skyRoot;
    label.parent = bodyMesh.parent;

    solarBodyMeshes.push(bodyMesh, label);
    solarBodyHits.push({ position, body });
  }

  const jupiter = bodies.find((b) => b.id === 'jupiter');

  if (jupiter) {
    createGalileanMoonDots(scene, jupiter, date);
  }

  updateSolarBodyScales();
}

/** True-size scaling: world radius = max(real angular radius, the pixel
 *  floor at the CURRENT fov) × distance. Runs on every frame. */
function updateSolarBodyScales(): void {
  const fov = controller.angleViewCamera;

  // PORT-LATER: telescope faint-star names not ported yet — uncomment
  // once updateTelescopeStarLabels is brought over from .Me.
  // updateTelescopeStarLabels(fov);

  const floorRad =
    (SOLAR_BODY_MIN_RADIUS_PX / Math.max(1, canvas.clientHeight)) * fov;

  for (const mesh of solarBodyMeshes) {
    const meta = mesh.metadata as
      | {
          solarAngularRad?: number;
          galilean?: boolean;
          galileanSystemSpreadRad?: number;
        }
      | undefined;

    if (!meta?.solarAngularRad) {
      continue; // Labels keep their own size.
    }

    if (meta.galilean) {
      // The moons show up only once the system is resolvable —
      // otherwise four dots pile onto Jupiter's marker.
      const spreadPx =
        ((meta.galileanSystemSpreadRad ?? 0) / fov) *
        Math.max(1, canvas.clientHeight);

      mesh.isVisible = spreadPx >= 12;

      // Smaller pixel floor than the planets: satellites, not stars.
      const moonFloorRad =
        (1.5 / Math.max(1, canvas.clientHeight)) * fov;

      mesh.scaling.setAll(
        Math.max(meta.solarAngularRad, moonFloorRad) *
          STAR_FIELD_RADIUS *
          0.98
      );
      continue;
    }

    const angular = Math.max(meta.solarAngularRad, floorRad);

    mesh.scaling.setAll(angular * STAR_FIELD_RADIUS * 0.98);

    // MARKER ↔ GLOBE emissive blend: while the body sits at the pixel
    // floor its phase is invisible anyway — let it glow like the old
    // marker discs; as the zoom resolves the true disc, the glow fades
    // and the per-body sunlight draws the honest phase.
    const metaGlobe = meta as {
      texturedGlobe?: boolean;
      markerColor?: [number, number, number];
    };

    if (
      metaGlobe.texturedGlobe &&
      mesh.material instanceof StandardMaterial
    ) {
      const resolved = Math.min(1, meta.solarAngularRad / floorRad);
      const glow = 0.62 * (1 - resolved) + 0.05 * resolved;
      const mc = metaGlobe.markerColor ?? [1, 1, 1];

      mesh.material.emissiveColor.copyFromFloats(
        glow * mc[0],
        glow * mc[1],
        glow * mc[2]
      );
    }
  }

  if (sunDiscMesh && sunDiscBaseRadius > 0) {
    const sunAngularRad = 0.2666 * (Math.PI / 180);
    const angular = Math.max(sunAngularRad, floorRad);
    const distance = sunDiscMesh.position.length() || 1;

    sunDiscMesh.scaling.setAll(
      (angular * distance) / sunDiscBaseRadius
    );
  }
}

createSolarSystemBodies(scene);

function updateSkyRotation(): void {
  const dHours =
    sunPosition.getGmstHours(new Date()) - skyRotationBaseGmstHours;
  const wrapped = ((((dHours + 12) % 24) + 24) % 24) - 12;
  skyRoot.rotation.y = (wrapped * 15 * Math.PI) / 180;
}

// ---- Constellation + asterism lines (verbatim from .Me) -----------

const constellationRadius = 59.4;
// 0 = off · 1 = asterisms · 2 = full figures (default).
let constellationLineMode = 2;
let constellationLinesMesh: LinesMesh | null = null;
let asterismLinesMesh: LinesMesh | null = null;

function buildConstellationLinePointSets(): Vector3[][] {
  const date = new Date();
  const lines: Vector3[][] = [];

  for (const figure of CONSTELLATION_FIGURES) {
    if (figure.rank > 2) {
      continue;
    }

    for (const polyline of figure.lines) {
      const points: Vector3[] = [];

      for (const vertex of polyline) {
        const direction = sunPosition.directionFromRaDec(
          vertex[0],
          vertex[1],
          controller.shiftLongDeg,
          controller.shiftLatDeg,
          date
        );

        points.push(
          new Vector3(
            direction.x * constellationRadius,
            direction.y * constellationRadius,
            direction.z * constellationRadius
          )
        );
      }

      if (points.length >= 2) {
        lines.push(points);
      }
    }
  }

  return lines;
}

function buildConstellationLineColorSets(hoveredId: string | null): Color4[][] {
  const base = new Color4(0.17, 0.26, 0.37, 1);
  const lit = new Color4(0.88, 0.93, 0.96, 1);
  const colors: Color4[][] = [];

  for (const figure of CONSTELLATION_FIGURES) {
    if (figure.rank > 2) {
      continue;
    }

    const color = figure.id === hoveredId ? lit : base;

    for (const polyline of figure.lines) {
      if (polyline.length >= 2) {
        colors.push(polyline.map(() => color));
      }
    }
  }

  return colors;
}

function buildAsterismLinePointSets(): Vector3[][] {
  const date = new Date();
  const lines: Vector3[][] = [];

  for (const figure of ASTERISM_FIGURES) {
    for (const polyline of figure.lines) {
      const points: Vector3[] = [];

      for (const vertex of polyline) {
        const direction = sunPosition.directionFromRaDec(
          vertex[0],
          vertex[1],
          controller.shiftLongDeg,
          controller.shiftLatDeg,
          date
        );

        points.push(
          new Vector3(
            direction.x * constellationRadius,
            direction.y * constellationRadius,
            direction.z * constellationRadius
          )
        );
      }

      if (points.length >= 2) {
        lines.push(points);
      }
    }
  }

  return lines;
}

function buildAsterismLineColorSets(hoveredId: string | null): Color4[][] {
  const base = new Color4(0.53, 0.66, 0.82, 1);
  const lit = new Color4(0.95, 0.98, 1.0, 1);
  const colors: Color4[][] = [];

  for (const figure of ASTERISM_FIGURES) {
    const color = figure.id === hoveredId ? lit : base;

    for (const polyline of figure.lines) {
      if (polyline.length >= 2) {
        colors.push(polyline.map(() => color));
      }
    }
  }

  return colors;
}

function createConstellationLines(): void {
  const mesh = MeshBuilder.CreateLineSystem(
    'constellation-lines',
    {
      lines: buildConstellationLinePointSets(),
      colors: buildConstellationLineColorSets(null),
      updatable: true
    },
    scene
  );

  mesh.alpha = 1;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.isVisible = constellationLineMode === 2;
  mesh.parent = skyRoot;

  constellationLinesMesh = mesh;
}

function createAsterismLines(): void {
  const mesh = MeshBuilder.CreateLineSystem(
    'asterism-lines',
    {
      lines: buildAsterismLinePointSets(),
      colors: buildAsterismLineColorSets(null),
      updatable: true
    },
    scene
  );

  mesh.alpha = 1;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.isVisible = constellationLineMode === 1;
  mesh.parent = skyRoot;

  asterismLinesMesh = mesh;
}

createConstellationLines();
createAsterismLines();

// Cycles the line layer: 0 off → 1 asterisms → 2 full figures → 0. Bound to
// «C» in the .Me sky (the toolbar constellation button drives it too, later).
function setConstellationLineMode(mode: number): void {
  constellationLineMode = ((mode % 3) + 3) % 3;

  if (asterismLinesMesh) {
    asterismLinesMesh.isVisible = constellationLineMode === 1;
  }

  if (constellationLinesMesh) {
    constellationLinesMesh.isVisible = constellationLineMode === 2;
  }
  // (hover re-highlight is added with the constellation-tooltip stage)
}

function cycleConstellationLines(): void {
  setConstellationLineMode((constellationLineMode + 1) % 3);
}

function getConstellationLineMode(): number {
  return constellationLineMode;
}

window.addEventListener('keydown', (event) => {
  if (
    event.key === 'c' ||
    event.key === 'C' ||
    event.key === 'с' ||
    event.key === 'С'
  ) {
    cycleConstellationLines();
  }
});

// ---- Constellation name labels (verbatim from .Me) ----------------

const constellationLabelMeshes: Mesh[] = [];

function createConstellationLabelTexture(
  name: string,
  index: number
): DynamicTexture {
  const width = 512;
  const height = 128;

  const texture = new DynamicTexture(
    `constellation-label-tex-${index}`,
    { width, height },
    scene,
    false
  );
  texture.hasAlpha = true;

  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  context.clearRect(0, 0, width, height);

  context.font = '44px Consolas, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = 'rgba(0, 0, 0, 0.9)';
  context.shadowBlur = 8;
  // CYAN — planets amber, stars bright blue, constellations sea-green cyan.
  context.fillStyle = 'rgba(110, 222, 204, 0.9)';
  context.fillText(name.toUpperCase(), width / 2, height / 2);

  texture.update();

  return texture;
}

function createConstellationLabels(): void {
  const date = new Date();

  CONSTELLATION_FIGURES.forEach((figure, index) => {
    if (figure.rank > 2) {
      return;
    }

    let sx = 0;
    let sy = 0;
    let sz = 0;
    let count = 0;

    for (const polyline of figure.lines) {
      for (const vertex of polyline) {
        const direction = sunPosition.directionFromRaDec(
          vertex[0],
          vertex[1],
          controller.shiftLongDeg,
          controller.shiftLatDeg,
          date
        );

        sx += direction.x;
        sy += direction.y;
        sz += direction.z;
        count++;
      }
    }

    if (count === 0) {
      return;
    }

    const length = Math.hypot(sx, sy, sz) || 1;

    const texture = createConstellationLabelTexture(figure.name, index);

    const material = new StandardMaterial(
      `constellation-label-mat-${index}`,
      scene
    );
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.emissiveColor = new Color3(1, 1, 1);
    material.useAlphaFromDiffuseTexture = true;
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.specularColor = new Color3(0, 0, 0);

    const plane = MeshBuilder.CreatePlane(
      `constellation-label-${index}`,
      { width: 6.4, height: 1.6 },
      scene
    );
    plane.material = material;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;
    plane.alwaysSelectAsActiveMesh = true;
    plane.isVisible = true;
    plane.position.copyFromFloats(
      (sx / length) * constellationRadius,
      (sy / length) * constellationRadius,
      (sz / length) * constellationRadius
    );

    plane.metadata = { constellationId: figure.id };
    plane.parent = skyRoot;

    constellationLabelMeshes.push(plane);
  });
}

createConstellationLabels();

// ---- Constellation hover: highlight + tooltip (verbatim from .Me) --

const constellationHoverRadiusPx = 90;
const constellationHighlightRadius = 59.45;

const constellationVertexHits: { abbr: string; position: Vector3 }[] = [];
const brightestStarByConstellation: Record<
  string,
  { name: string; mag: number }
> = {};
let hoveredConstellationId: string | null = null;

function buildConstellationHoverData(): void {
  for (const star of VISIBLE_STAR_CATALOG) {
    const abbr = star.constellation;

    if (!abbr) {
      continue;
    }

    const current = brightestStarByConstellation[abbr];

    if (!current || star.magnitude < current.mag) {
      brightestStarByConstellation[abbr] = {
        name: star.name,
        mag: star.magnitude
      };
    }
  }

  const date = new Date();

  for (const figure of CONSTELLATION_FIGURES) {
    if (figure.rank > 2) {
      continue;
    }

    let cx = 0;
    let cy = 0;
    let cz = 0;
    let count = 0;

    for (const polyline of figure.lines) {
      for (const vertex of polyline) {
        const direction = sunPosition.directionFromRaDec(
          vertex[0],
          vertex[1],
          controller.shiftLongDeg,
          controller.shiftLatDeg,
          date
        );

        constellationVertexHits.push({
          abbr: figure.id,
          position: new Vector3(
            direction.x * constellationHighlightRadius,
            direction.y * constellationHighlightRadius,
            direction.z * constellationHighlightRadius
          )
        });

        cx += direction.x;
        cy += direction.y;
        cz += direction.z;
        count++;
      }
    }

    if (count > 0) {
      const length = Math.hypot(cx, cy, cz) || 1;
      constellationVertexHits.push({
        abbr: figure.id,
        position: new Vector3(
          (cx / length) * constellationHighlightRadius,
          (cy / length) * constellationHighlightRadius,
          (cz / length) * constellationHighlightRadius
        )
      });
    }
  }
}

buildConstellationHoverData();

// A dedicated ABSOLUTE overlay layer for every tooltip/card/crosshair.
// They must NOT be direct children of `.ap-stage`, whose fill rule
// `.ap-stage > * { width: 100% }` would stretch an uncapped tooltip
// into a full-width bar. The layer itself takes the 100% (fine); the
// overlays inside are grandchildren, unaffected. pointer-events:none
// lets the canvas below keep drag/zoom; clickable cards re-enable it.
const stageParent = canvas.parentElement ?? document.body;
if (getComputedStyle(stageParent).position === 'static') {
  stageParent.style.position = 'relative';
}
const tooltipParent = document.createElement('div');
Object.assign(tooltipParent.style, {
  position: 'absolute',
  left: '0',
  top: '0',
  right: '0',
  bottom: '0',
  pointerEvents: 'none',
  zIndex: '10'
});
stageParent.appendChild(tooltipParent);

const starTooltipEl = document.createElement('div');
Object.assign(starTooltipEl.style, {
  position: 'absolute',
  left: '0',
  top: '0',
  zIndex: '20',
  pointerEvents: 'none',
  display: 'none',
  maxWidth: '260px',
  padding: '7px 9px',
  border: '1px solid rgba(120, 180, 240, 0.6)',
  background: 'rgba(4, 10, 20, 0.9)',
  color: 'rgba(224, 238, 255, 0.96)',
  fontFamily: 'Consolas, monospace',
  fontSize: '12px',
  lineHeight: '1.3',
  boxShadow: '0 0 16px rgba(70, 130, 220, 0.22)'
});
tooltipParent.appendChild(starTooltipEl);

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function constellationFullName(abbr: string): string {
  const figure = CONSTELLATION_FIGURES.find((item) => item.id === abbr);
  return figure ? figure.name : abbr;
}

function hideStarTooltip(): void {
  starTooltipEl.style.display = 'none';
}

function tooltipPointerPoint(e: PointerEvent): { x: number; y: number } {
  const rect = tooltipParent.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function placeOverlayByQuadrant(
  el: HTMLElement,
  x: number,
  y: number,
  offset: number
): void {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);

  if (x < width / 2) {
    el.style.left = `${x + offset}px`;
    el.style.right = 'auto';
  } else {
    el.style.right = `${width - x + offset}px`;
    el.style.left = 'auto';
  }

  if (y < height / 2) {
    el.style.top = `${y + offset}px`;
    el.style.bottom = 'auto';
  } else {
    el.style.bottom = `${height - y + offset}px`;
    el.style.top = 'auto';
  }

  el.style.maxHeight = `${height - 24}px`;
  el.style.overflowY = 'auto';
}

function findNearestConstellationAtScreenPoint(
  x: number,
  y: number
): string | null {
  const viewport = camera.viewport.toGlobal(
    Math.max(1, canvas.clientWidth),
    Math.max(1, canvas.clientHeight)
  );
  const transform = scene.getTransformMatrix();

  let best: { abbr: string; distancePx: number } | null = null;

  for (const hit of constellationVertexHits) {
    const projected = Vector3.Project(
      hit.position,
      skyRoot.getWorldMatrix(),
      transform,
      viewport
    );

    if (
      !Number.isFinite(projected.x) ||
      !Number.isFinite(projected.y) ||
      projected.z < 0 ||
      projected.z > 1
    ) {
      continue;
    }

    const dx = projected.x - x;
    const dy = projected.y - y;
    const distancePx = Math.sqrt(dx * dx + dy * dy);

    if (!best || distancePx < best.distancePx) {
      best = { abbr: hit.abbr, distancePx };
    }
  }

  const limit =
    best && best.abbr === hoveredConstellationId
      ? constellationHoverRadiusPx * 1.7
      : constellationHoverRadiusPx;

  if (!best || best.distancePx > limit) {
    return null;
  }

  return best.abbr;
}

function setHoveredConstellation(abbr: string | null): void {
  if (abbr === hoveredConstellationId) {
    return;
  }

  hoveredConstellationId = abbr;

  if (constellationLinesMesh) {
    MeshBuilder.CreateLineSystem(
      'constellation-lines',
      {
        lines: buildConstellationLinePointSets(),
        colors: buildConstellationLineColorSets(abbr),
        instance: constellationLinesMesh
      },
      scene
    );
  }

  if (asterismLinesMesh) {
    MeshBuilder.CreateLineSystem(
      'asterism-lines',
      {
        lines: buildAsterismLinePointSets(),
        colors: buildAsterismLineColorSets(abbr),
        instance: asterismLinesMesh
      },
      scene
    );
  }
}

function showConstellationTooltip(e: PointerEvent, abbr: string): void {
  const point = tooltipPointerPoint(e);
  const info = CONSTELLATION_INFO[abbr];
  const brightest = brightestStarByConstellation[abbr];

  const rows: string[] = [
    `<strong>${escapeHtml(constellationFullName(abbr))}</strong>`
  ];

  if (brightest) {
    rows.push(
      `brightest: ${escapeHtml(brightest.name)} (mag ${brightest.mag.toFixed(2)})`
    );
  }

  if (info) {
    rows.push(escapeHtml(info.meaning));
    rows.push(`best seen: ${escapeHtml(info.season)}`);
  }

  starTooltipEl.innerHTML = rows.join('<br>');
  placeOverlayByQuadrant(starTooltipEl, point.x, point.y, 14);
  starTooltipEl.style.display = 'block';
}

const starTooltipHitRadiusPx = 14;

function findNearestStarAtScreenPoint(
  x: number,
  y: number
): CelestialStarDefinition | null {
  const viewport = camera.viewport.toGlobal(
    Math.max(1, canvas.clientWidth),
    Math.max(1, canvas.clientHeight)
  );

  const transform = scene.getTransformMatrix();

  let best: { star: CelestialStarDefinition; distancePx: number } | null = null;

  for (const hit of starHitPoints) {
    const projected = Vector3.Project(
      hit.position,
      // Hit positions are LOCAL to the rotating sky root — project them
      // through its world matrix, not identity.
      skyRoot?.getWorldMatrix() ?? Matrix.Identity(),
      transform,
      viewport
    );

    if (
      !Number.isFinite(projected.x) ||
      !Number.isFinite(projected.y) ||
      projected.z < 0 ||
      projected.z > 1
    ) {
      continue;
    }

    const dx = projected.x - x;
    const dy = projected.y - y;
    const distancePx = Math.sqrt(dx * dx + dy * dy);

    if (!best || distancePx < best.distancePx) {
      best = { star: hit.star, distancePx };
    }
  }

  if (!best || best.distancePx > starTooltipHitRadiusPx) {
    return null;
  }

  return best.star;
}

function showStarTooltip(e: PointerEvent, star: CelestialStarDefinition): void {
  const point = tooltipPointerPoint(e);

  const name =
    star.name && star.name.trim().length > 0 ? star.name : 'Unnamed star';

  const rows: string[] = [
    `<strong>${escapeHtml(name)}</strong>`,
    escapeHtml(constellationFullName(star.constellation)),
    `magnitude ${Number(star.magnitude).toFixed(2)}`
  ];

  if (star.spectralType) {
    rows.push(`type ${escapeHtml(String(star.spectralType))}`);
  }

  if (star.colorIndex !== undefined && star.colorIndex !== null) {
    rows.push(`B&minus;V ${Number(star.colorIndex).toFixed(2)}`);
  }

  starTooltipEl.innerHTML = rows.join('<br>');
  placeOverlayByQuadrant(starTooltipEl, point.x, point.y, 14);
  starTooltipEl.style.display = 'block';
}

function handleSkyHover(e: PointerEvent): void {
  const pick = scene.pick(e.offsetX, e.offsetY, (mesh) => mesh.name === 'globe');

  if (pick?.hit) {
    hideStarTooltip();
    return; // do not reset the highlight over the globe (anti-flicker)
  }

  // Full .Me priority: sunspot > meteor > solarBody > star > constellation.
  const sunspot = findSunspotAtScreenPoint(e.offsetX, e.offsetY);
  const meteor = findNearestMeteorAtScreenPoint(e.offsetX, e.offsetY);
  const solarBody = findNearestSolarBodyAtScreenPoint(e.offsetX, e.offsetY);
  const star = findNearestStarAtScreenPoint(e.offsetX, e.offsetY);
  const constellation = findNearestConstellationAtScreenPoint(
    e.offsetX,
    e.offsetY
  );

  setHoveredConstellation(constellation);

  if (sunspot) {
    showSunspotTooltip(e, sunspot);
  } else if (meteor) {
    showMeteorTooltip(e, meteor);
  } else if (solarBody) {
    showSolarBodyTooltip(e, solarBody);
  } else if (star) {
    showStarTooltip(e, star);
  } else if (constellation) {
    showConstellationTooltip(e, constellation);
  } else {
    hideStarTooltip();
  }
}

// ---- Solar-body hit-test + tooltip (verbatim from .Me) ------------

const solarBodyTooltipHitRadiusPx = 22;

function findNearestSolarBodyAtScreenPoint(
  x: number,
  y: number
): SolarBodySky | null {
  if (solarBodyHits.length === 0) {
    return null;
  }

  const viewport = camera.viewport.toGlobal(
    Math.max(1, canvas.clientWidth),
    Math.max(1, canvas.clientHeight)
  );

  const transform = scene.getTransformMatrix();

  let best: { body: SolarBodySky; distancePx: number } | null = null;

  for (const hit of solarBodyHits) {
    const projected = Vector3.Project(
      hit.position,
      skyRoot?.getWorldMatrix() ?? Matrix.Identity(),
      transform,
      viewport
    );

    if (
      !Number.isFinite(projected.x) ||
      !Number.isFinite(projected.y) ||
      projected.z < 0 ||
      projected.z > 1
    ) {
      continue;
    }

    const dx = projected.x - x;
    const dy = projected.y - y;
    const distancePx = Math.sqrt(dx * dx + dy * dy);

    if (!best || distancePx < best.distancePx) {
      best = { body: hit.body, distancePx };
    }
  }

  if (!best || best.distancePx > solarBodyTooltipHitRadiusPx) {
    return null;
  }

  return best.body;
}

function showSolarBodyTooltip(e: PointerEvent, body: SolarBodySky): void {
  const point = tooltipPointerPoint(e);
  const rows: string[] = [
    `<strong>${escapeHtml(body.name)}</strong>`,
    `distance ${escapeHtml(body.distanceLabel)}`
  ];

  if (body.phaseName && body.illuminatedFraction !== undefined) {
    rows.push(
      `${escapeHtml(body.phaseName)} · ` +
        `${Math.round(body.illuminatedFraction * 100)}% lit`
    );
  }

  if (body.eclipse) {
    rows.push(`🌑 Lunar eclipse — ${escapeHtml(body.eclipse.kind)}`);
  }

  if (body.ringTiltDeg !== undefined) {
    rows.push(`rings ${Math.abs(body.ringTiltDeg).toFixed(1)}° open`);
  }

  starTooltipEl.innerHTML = rows.join('<br>');
  placeOverlayByQuadrant(starTooltipEl, point.x, point.y, 14);
  starTooltipEl.style.display = 'block';
}

// ---- Star / constellation / solar-system info CARD (verbatim) ------
// CLICK a star, constellation or planet → a small pinned card with the
// Wikipedia summary (lazy, cached via GlobeWiki). The rule "obliges to
// nothing": no article / offline → nothing opens. Wikipedia + NASA
// image links ride along when present.

const globeWiki = new GlobeWiki();
let starCardEl: HTMLDivElement | null = null;
let starCardRequestSeq = 0;

function createStarCard(): void {
  const parent = tooltipParent;

  if (!parent) {
    return;
  }

  const card = document.createElement('div');

  Object.assign(card.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    zIndex: '30',
    display: 'none',
    width: '280px',
    padding: '10px 12px',
    border: '1px solid rgba(140, 200, 255, 0.65)',
    borderRadius: '10px',
    background: 'rgba(4, 10, 20, 0.95)',
    color: 'rgba(224, 238, 255, 0.96)',
    fontFamily: 'Consolas, monospace',
    fontSize: '12px',
    lineHeight: '1.4',
    boxShadow: '0 0 22px rgba(70, 130, 220, 0.3)',
    pointerEvents: 'auto'
  });

  parent.appendChild(card);

  starCardEl = card;
}

function hideStarCard(): void {
  // Invalidates any in-flight fetch: a late answer must not pop the card.
  starCardRequestSeq++;

  if (starCardEl) {
    starCardEl.style.display = 'none';
  }
}

/** Drag the pinned card by its title to peek at what is underneath. */
function startStarCardDrag(ev: PointerEvent): void {
  const card = starCardEl;
  const parent = card?.parentElement;

  if (!card || !parent) {
    return;
  }

  ev.preventDefault();
  ev.stopPropagation();

  // Freeze the quadrant anchoring into concrete left/top before moving.
  const parentRect = parent.getBoundingClientRect();
  const rect = card.getBoundingClientRect();
  const baseLeft = rect.left - parentRect.left;
  const baseTop = rect.top - parentRect.top;

  card.style.left = `${baseLeft}px`;
  card.style.top = `${baseTop}px`;
  card.style.right = 'auto';
  card.style.bottom = 'auto';

  const startX = ev.clientX;
  const startY = ev.clientY;

  const onMove = (moveEv: PointerEvent): void => {
    card.style.left = `${baseLeft + moveEv.clientX - startX}px`;
    card.style.top = `${baseTop + moveEv.clientY - startY}px`;
  };

  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

/** The NASA site is a SPA that spins forever on a bare ?q= link; mirror
 *  the URL shape its own search box produces. */
function buildNasaSearchUrl(
  title: string,
  nasaHits: number
): string | undefined {
  return nasaHits > 0
    ? 'https://images.nasa.gov/search?q=' +
        encodeURIComponent(title.toLowerCase()) +
        '&page=1&media=image,video,audio&yearStart=1920&yearEnd=' +
        new Date().getFullYear()
    : undefined;
}

async function openConstellationCard(
  abbr: string,
  x: number,
  y: number
): Promise<void> {
  const seq = ++starCardRequestSeq;
  const name = constellationFullName(abbr);

  // «Pisces» alone is a zodiac-sign disambiguation — the honest first
  // candidate is the (constellation) title; unique names fall back.
  const wiki = await globeWiki.loadStarWiki([`${name} (constellation)`, name]);

  if (seq !== starCardRequestSeq) {
    return; // A newer click or a hide happened meanwhile.
  }

  if (!wiki) {
    return; // No article — nothing opens, by the rule.
  }

  const info = CONSTELLATION_INFO[abbr];
  const brightest = brightestStarByConstellation[abbr];
  const metaParts = ['constellation'];

  if (brightest) {
    metaParts.push(`brightest: ${brightest.name}`);
  }

  if (info) {
    metaParts.push(`best seen: ${info.season}`);
  }

  showStarCard(metaParts.join(' · '), wiki, undefined, 0, x, y);
}

async function openStarCard(
  star: CelestialStarDefinition,
  candidates: string[],
  x: number,
  y: number
): Promise<void> {
  const seq = ++starCardRequestSeq;
  const wiki = await globeWiki.loadStarWiki(candidates);

  if (seq !== starCardRequestSeq) {
    return;
  }

  if (!wiki) {
    return;
  }

  // NASA query uses the RESOLVED title, not the raw catalog designation.
  const nasaHits = await globeWiki.fetchNasaImageHits(wiki.title);

  if (seq !== starCardRequestSeq) {
    return;
  }

  const nasaUrl = buildNasaSearchUrl(wiki.title, nasaHits);
  const spectral = star.spectralType ? ` · ${star.spectralType}` : '';

  showStarCard(
    `${star.constellation} · mag ${star.magnitude.toFixed(2)}${spectral}`,
    wiki,
    nasaUrl,
    nasaHits,
    x,
    y
  );
}

/** Cards for the Solar System — same pinned Wikipedia card as stars. */
async function openSolarSystemCard(
  body: SolarBodySky | 'sun',
  x: number,
  y: number
): Promise<void> {
  const seq = ++starCardRequestSeq;
  const isSun = body === 'sun';
  const candidates = isSun
    ? ['Sun']
    : body.id === 'mercury'
      ? ['Mercury (planet)']
      : ['io', 'europa', 'ganymede', 'callisto'].includes(body.id)
        ? [`${body.name} (moon)`, body.name]
        : [body.name];

  const wiki = await globeWiki.loadStarWiki(candidates);

  if (seq !== starCardRequestSeq || !wiki) {
    return;
  }

  const nasaHits = await globeWiki.fetchNasaImageHits(wiki.title);

  if (seq !== starCardRequestSeq) {
    return;
  }

  let metaText = 'Solar System';

  if (isSun) {
    metaText += ' · our star';
  } else {
    metaText += ` · ${body.distanceLabel}`;

    if (body.phaseName) {
      metaText += ` · ${body.phaseName}`;
    }
  }

  showStarCard(
    metaText,
    wiki,
    buildNasaSearchUrl(wiki.title, nasaHits),
    nasaHits,
    x,
    y
  );
}

function showStarCard(
  metaText: string,
  wiki: WikiSummary,
  nasaUrl: string | undefined,
  nasaHits: number,
  x: number,
  y: number
): void {
  const card = starCardEl;

  if (!card) {
    return;
  }

  card.innerHTML = '';

  // Header: title + close.
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'baseline';
  header.style.gap = '8px';

  const title = document.createElement('div');
  title.textContent = wiki.title;
  title.style.fontWeight = '700';
  title.style.fontSize = '14px';
  title.style.color = 'rgba(255, 240, 170, 0.96)';
  // Draggable by the title: move the card aside to see what is under it.
  title.style.cursor = 'grab';
  title.style.flex = '1';
  title.style.userSelect = 'none';
  title.addEventListener('pointerdown', (ev) => startStarCardDrag(ev));

  const close = document.createElement('button');
  close.textContent = '×';
  close.style.background = 'transparent';
  close.style.border = 'none';
  close.style.color = 'rgba(224, 238, 255, 0.8)';
  close.style.fontSize = '16px';
  close.style.cursor = 'pointer';
  close.style.lineHeight = '1';
  close.addEventListener('click', () => hideStarCard());

  header.appendChild(title);
  header.appendChild(close);
  card.appendChild(header);

  // Catalog line: our own local data.
  const meta = document.createElement('div');

  meta.textContent = metaText;
  meta.style.color = 'rgba(160, 200, 235, 0.85)';
  meta.style.margin = '2px 0 6px';
  card.appendChild(meta);

  // Thumbnail when Wikipedia has one.
  if (wiki.thumb) {
    const img = document.createElement('img');
    img.src = wiki.thumb;
    img.alt = wiki.title;
    img.style.width = '100%';
    img.style.borderRadius = '7px';
    img.style.margin = '2px 0 6px';
    card.appendChild(img);
  }

  // Summary text (clamped).
  const extract = document.createElement('div');
  extract.textContent =
    wiki.extract.length > 360
      ? wiki.extract.slice(0, 357).trimEnd() + '…'
      : wiki.extract;
  card.appendChild(extract);

  // Outward links: Wikipedia + NASA image search.
  const links = document.createElement('div');
  links.style.marginTop = '8px';
  links.style.display = 'flex';
  links.style.gap = '14px';

  const makeLink = (label: string, href: string): HTMLAnchorElement => {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.color = 'rgba(140, 220, 255, 0.95)';
    a.style.textDecoration = 'none';
    return a;
  };

  if (wiki.url) {
    links.appendChild(makeLink('Wikipedia ↗', wiki.url));
  }

  if (nasaUrl) {
    links.appendChild(makeLink(`NASA images (${nasaHits}) ↗`, nasaUrl));
  }

  card.appendChild(links);

  // Quadrant rule: the card opens toward the screen center and grows
  // inward even when the Wikipedia thumbnail arrives late.
  placeOverlayByQuadrant(card, x, y, 16);
  card.style.display = 'block';
}

function handleStarCardClick(e: PointerEvent): boolean {
  const pick = scene.pick(e.offsetX, e.offsetY, (mesh) => mesh.name === 'globe');

  if (pick?.hit) {
    return false; // Clicks on the Earth keep their existing meaning.
  }

  // Solar-system bodies first — they sit on top of the star field.
  const solarBody = findNearestSolarBodyAtScreenPoint(e.offsetX, e.offsetY);

  if (solarBody) {
    void openSolarSystemCard(solarBody, e.offsetX, e.offsetY);
    return true;
  }

  // The Sun disc has a card too.
  if (sunDiscMesh) {
    const viewport = camera.viewport.toGlobal(
      Math.max(1, canvas.clientWidth),
      Math.max(1, canvas.clientHeight)
    );
    const projected = Vector3.Project(
      sunDiscMesh.position,
      skyRoot?.getWorldMatrix() ?? Matrix.Identity(),
      scene.getTransformMatrix(),
      viewport
    );

    if (
      Number.isFinite(projected.x) &&
      Number.isFinite(projected.y) &&
      projected.z >= 0 &&
      projected.z <= 1 &&
      Math.hypot(projected.x - e.offsetX, projected.y - e.offsetY) < 26
    ) {
      void openSolarSystemCard('sun', e.offsetX, e.offsetY);
      return true;
    }
  }

  const star = findNearestStarAtScreenPoint(e.offsetX, e.offsetY);

  if (star) {
    const candidates = globeWiki.buildStarWikiCandidates(star);

    if (candidates.length > 0) {
      void openStarCard(star, candidates, e.offsetX, e.offsetY);
      return true;
    }
  }

  // CONSTELLATION by name/figure: no star under the click — the same
  // hit-test that drives the hover tooltip opens a card too.
  const constellationAbbr = findNearestConstellationAtScreenPoint(
    e.offsetX,
    e.offsetY
  );

  if (constellationAbbr) {
    void openConstellationCard(constellationAbbr, e.offsetX, e.offsetY);
    return true;
  }

  return false;
}

createStarCard();

// ---- Meteor radiants (verbatim from .Me) --------------------------
// Gold name label + a faint diffuse spindle (the stream Earth crosses)
// for every shower active today; rebuilt on the 60s tick. Hover → a
// tooltip with the ZHR and an hour-resolution countdown to the peak.

const meteorRadiantRadius = 58;
const meteorTooltipHitRadiusPx = 24;
const meteorRadiantMeshes: Mesh[] = [];
let meteorRadiantHits: { position: Vector3; shower: MeteorShower }[] = [];

function createMeteorLabelTexture(
  scene: Scene,
  text: string,
  index: number
): DynamicTexture {
  const width = 512;
  const height = 128;

  const texture = new DynamicTexture(
    `meteor-label-tex-${index}`,
    { width, height },
    scene,
    false
  );
  texture.hasAlpha = true;

  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  context.clearRect(0, 0, width, height);

  context.font = '40px Consolas, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = 'rgba(0, 0, 0, 0.9)';
  context.shadowBlur = 8;
  context.fillStyle = 'rgba(255, 214, 130, 0.95)';
  context.fillText(text.toUpperCase(), width / 2, height / 2);

  texture.update();

  return texture;
}

function createMeteorRadiants(scene: Scene): void {
  const now = new Date();

  METEOR_SHOWERS.forEach((shower, index) => {
    if (!isShowerActive(shower, now)) {
      return;
    }

    const direction = sunPosition.directionFromRaDec(
      shower.radiantRaDeg,
      shower.radiantDecDeg,
      controller.shiftLongDeg,
      controller.shiftLatDeg,
      now
    );

    const axis = new Vector3(direction.x, direction.y, direction.z);

    const position = axis.scale(meteorRadiantRadius);

    // Activity factor: smooth Gaussian around the peak (sigma ~4 days),
    // so the glow rises gently as Earth nears, peaks, then fades. Below
    // a small threshold the tube is not rendered at all.
    const days = daysToPeak(shower, now);
    const intensity = Math.exp(-(days * days) / 32);

    const streamMeshes: Mesh[] = [];

    // Show the stream only once Earth reaches the ~0.3 intensity level
    // (a few days before peak); before that the stream is still "ahead".
    if (intensity >= 0.3) {
      // Direction Earth crosses the stream (schematic ~orbital motion:
      // perpendicular to both the Sun direction and the radiant axis).
      const sun = sunPosition.vectorToTheSun(
        controller.shiftLongDeg,
        controller.shiftLatDeg,
        now
      );
      let crossDir = Vector3.Cross(axis, new Vector3(sun.x, sun.y, sun.z));
      if (crossDir.lengthSquared() < 1e-4) {
        crossDir = Vector3.Cross(axis, new Vector3(0, 1, 0));
      }
      crossDir.normalize();

      // Earth slides from the tube EDGE (before peak) to the CENTRE (at
      // peak) to the far edge (after). Tube radius ~ the dense core.
      const tubeRadius = 3.6;
      const daysEdge = 6.2; // |days| where intensity ~0.3 -> Earth at edge
      const offsetFrac = Math.max(-1, Math.min(1, days / daysEdge));
      const center = crossDir.scale(tubeRadius * offsetFrac);

      const halfLength = 52;

      // Bell-shaped (Gaussian) density along the trajectory: a spindle
      // fat in the middle (densest core, where Earth crosses) tapering to
      // nothing at the ends. The 3D swell itself reads as volume.
      const sampleCount = 44;
      const tubePath: Vector3[] = [];
      for (let k = 0; k < sampleCount; k++) {
        const f = 1 - (2 * k) / (sampleCount - 1); // +1 .. -1 along axis
        tubePath.push(center.add(axis.scale(halfLength * f)));
      }

      const totalLength = 2 * halfLength;
      const radiusFunction = (_i: number, distance: number): number => {
        const u = (distance / totalLength - 0.5) * 2; // -1 .. 1
        return tubeRadius * Math.exp(-(u * u) * 2.2) + 0.04;
      };

      // Faint diffuse spindle (no bright core, no glow).
      const tubeMaterial = new StandardMaterial(
        `meteor-tube-mat-${index}`,
        scene
      );
      tubeMaterial.emissiveColor = new Color3(1.0, 0.82, 0.35);
      tubeMaterial.diffuseColor = new Color3(0, 0, 0);
      tubeMaterial.specularColor = new Color3(0, 0, 0);
      tubeMaterial.disableLighting = true;
      tubeMaterial.backFaceCulling = false;
      tubeMaterial.alpha = 0.012 + intensity * 0.02;

      const tube = MeshBuilder.CreateTube(
        `meteor-tube-${index}`,
        { path: tubePath, radiusFunction, tessellation: 26, updatable: false },
        scene
      );
      tube.material = tubeMaterial;
      tube.isPickable = false;
      tube.alwaysSelectAsActiveMesh = true;

      // Faint DASHED central line = trajectory of maximum intensity.
      // Earth reaches this line at peak (offset 0).
      const centerLine = MeshBuilder.CreateDashedLines(
        `meteor-line-${index}`,
        {
          points: tubePath,
          dashSize: 4,
          gapSize: 5,
          dashNb: 140,
          updatable: false
        },
        scene
      );
      centerLine.color = new Color3(0.52, 0.45, 0.26);
      centerLine.alpha = 0.18;
      centerLine.isPickable = false;
      centerLine.alwaysSelectAsActiveMesh = true;

      streamMeshes.push(tube, centerLine);
    }

    const labelTexture = createMeteorLabelTexture(scene, shower.name, index);
    const labelMaterial = new StandardMaterial(
      `meteor-label-mat-${index}`,
      scene
    );
    labelMaterial.diffuseTexture = labelTexture;
    labelMaterial.emissiveTexture = labelTexture;
    labelMaterial.emissiveColor = new Color3(1, 1, 1);
    labelMaterial.useAlphaFromDiffuseTexture = true;
    labelMaterial.disableLighting = true;
    labelMaterial.backFaceCulling = false;
    labelMaterial.specularColor = new Color3(0, 0, 0);

    const label = MeshBuilder.CreatePlane(
      `meteor-label-${index}`,
      { width: 5.2, height: 1.3 },
      scene
    );
    label.material = labelMaterial;
    label.billboardMode = Mesh.BILLBOARDMODE_ALL;
    label.isPickable = false;
    label.alwaysSelectAsActiveMesh = true;
    // Offset the label just below the ring.
    label.position.copyFrom(position.scale(0.992));

    for (const streamMesh of streamMeshes) {
      streamMesh.parent = skyRoot;
    }

    label.parent = skyRoot;

    meteorRadiantMeshes.push(...streamMeshes, label);
    meteorRadiantHits.push({ position, shower });
  });
}

// Meteor radiants depend on time (which showers are active, glow,
// position). They are few and have no toggle state, so a clean rebuild
// is simplest.
function refreshMeteorRadiants(): void {
  for (const mesh of meteorRadiantMeshes) {
    // dispose(forceDisposeEffect, forceDisposeTextures): also free the
    // label DynamicTexture so re-creating each tick does not leak.
    mesh.material?.dispose(false, true);
    mesh.dispose();
  }

  meteorRadiantMeshes.length = 0;
  meteorRadiantHits = [];

  createMeteorRadiants(scene);
}

function findNearestMeteorAtScreenPoint(
  x: number,
  y: number
): MeteorShower | null {
  if (meteorRadiantHits.length === 0) {
    return null;
  }

  const viewport = camera.viewport.toGlobal(
    Math.max(1, canvas.clientWidth),
    Math.max(1, canvas.clientHeight)
  );

  const transform = scene.getTransformMatrix();

  let best: { shower: MeteorShower; distancePx: number } | null = null;

  for (const hit of meteorRadiantHits) {
    const projected = Vector3.Project(
      hit.position,
      skyRoot?.getWorldMatrix() ?? Matrix.Identity(),
      transform,
      viewport
    );

    if (
      !Number.isFinite(projected.x) ||
      !Number.isFinite(projected.y) ||
      projected.z < 0 ||
      projected.z > 1
    ) {
      continue;
    }

    const dx = projected.x - x;
    const dy = projected.y - y;
    const distancePx = Math.sqrt(dx * dx + dy * dy);

    if (!best || distancePx < best.distancePx) {
      best = { shower: hit.shower, distancePx };
    }
  }

  if (!best || best.distancePx > meteorTooltipHitRadiusPx) {
    return null;
  }

  return best.shower;
}

function showMeteorTooltip(e: PointerEvent, shower: MeteorShower): void {
  const point = tooltipPointerPoint(e);

  // Hour-resolution countdown so the tooltip visibly ticks through the
  // day (whole-day counts only change at midnight and look frozen).
  const peakStatus = peakCountdownLabel(shower, new Date());

  starTooltipEl.innerHTML = [
    `<strong>${escapeHtml(shower.name)}</strong> &#9732;`,
    'meteor shower (active now)',
    peakStatus,
    `~${shower.zhr} / hour at peak (ZHR)`,
    `from: ${escapeHtml(shower.parent)}`
  ].join('<br>');

  placeOverlayByQuadrant(starTooltipEl, point.x, point.y, 14);
  starTooltipEl.style.display = 'block';
}

createMeteorRadiants(scene);
window.setInterval(refreshMeteorRadiants, 60_000);

// ---- Earthquakes (verbatim from .Me) ------------------------------
// The live USGS 2.5-week feed as flat red "saucer" discs on the land,
// refreshed every 10 min; hover → M, place, time, depth. The ground-
// view (skyViewActive) branches are omitted — PORT-LATER with surface
// view. Orbit view only for now.

type EarthquakeFeature = {
  id?: string;
  properties?: { mag?: number; place?: string; time?: number };
  geometry?: { type?: string; coordinates?: number[] };
};

type EarthquakeMarkerInfo = {
  mag: number;
  place: string;
  time: number;
  depthKm: number;
};

const earthquakeFeedUrl =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson';
const earthquakeRefreshMs = 10 * 60 * 1000;
const earthquakeMaxEvents = 700;
const earthquakeTooltipHitRadiusPx = 28;

let earthquakeNodes: Mesh[] = [];
let earthquakeLoadInProgress = false;
let earthquakeTooltipEl: HTMLDivElement | null = null;
let earthquakeBlobTexture: DynamicTexture | null = null;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function earthquakeMagnitudeWeight(magnitude: number): number {
  // USGS 2.5_week feed starts at M2.5. M6 should be visibly stronger
  // than M3/M4, while M7+ should not become a cartoon planet.
  const minMag = 2.5;
  const maxMag = 7.0;

  const normalized = clampNumber(
    (magnitude - minMag) / Math.max(0.000001, maxMag - minMag),
    0,
    1
  );

  return clampNumber(Math.pow(normalized, 1.35), 0, 1);
}

/** The shared soft-disc alpha for the quake saucers (the city-embryo
 *  gradient, but as an opacity mask — the tint stays per-marker). */
function getEarthquakeBlobTexture(scene: Scene): DynamicTexture {
  if (earthquakeBlobTexture) {
    return earthquakeBlobTexture;
  }

  const texture = new DynamicTexture(
    'earthquake-blob-tex',
    { width: 64, height: 64 },
    scene,
    false
  );

  texture.hasAlpha = true;

  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);

  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.5)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(32, 32, 31, 0, Math.PI * 2);
  ctx.fill();
  texture.update();

  earthquakeBlobTexture = texture;
  return texture;
}

function createEarthquakeMarker(scene: Scene, feature: EarthquakeFeature): void {
  const coordinates = feature.geometry?.coordinates;

  if (!coordinates) {
    return;
  }

  const lonDeg = coordinates[0];
  const latDeg = coordinates[1];
  const depthKm = coordinates.length > 2 ? coordinates[2] : 0;
  const mag = feature.properties?.mag ?? 0;

  const weight = earthquakeMagnitudeWeight(mag);
  const markerId = feature.id ?? `${latDeg}-${lonDeg}`;

  const visualDiameter = 0.0065 + weight * 0.0115;

  const pickDiameter = Math.max(0.06, (0.014 + weight * 0.02) * 3.0);

  const n = controller.latLonNormal(latDeg, lonDeg);
  const normal = new Vector3(n.x, n.y, n.z);
  const surfacePoint = normal.scale(RENDER_EARTH_RADIUS);

  // FLYING SAUCERS like the cities: a flat glowing disc in the quake's
  // own red, lifted HALF a kilometer — below the cities' one.
  const markerPosition = surfacePoint.add(
    normal.scale(RENDER_EARTH_RADIUS * (0.5 / 6371))
  );

  const marker = MeshBuilder.CreatePlane(
    `earthquake-${markerId}`,
    { size: visualDiameter * 2.4, sideOrientation: Mesh.DOUBLESIDE },
    scene
  );

  const saucerRotation = new Quaternion();

  Quaternion.FromUnitVectorsToRef(new Vector3(0, 0, 1), normal, saucerRotation);
  marker.rotationQuaternion = saucerRotation;

  const material = new StandardMaterial(
    `earthquake-material-${markerId}`,
    scene
  );

  material.disableLighting = true;
  material.diffuseColor = new Color3(0, 0, 0);
  material.emissiveColor = new Color3(
    0.82 + weight * 0.18,
    0.2 + weight * 0.24,
    0.035
  );
  material.specularColor = new Color3(0, 0, 0);
  material.alpha = 0.9;
  material.opacityTexture = getEarthquakeBlobTexture(scene);
  material.backFaceCulling = false;

  marker.material = material;
  marker.isPickable = false;

  const metadata = {
    kind: 'earthquake',
    // For the per-frame ground hug in updateEarthquakeMarkerScale().
    surface: surfacePoint,
    normal,
    visualRadius: visualDiameter / 2,
    earthquake: {
      mag,
      place: feature.properties?.place ?? 'Unknown location',
      time: feature.properties?.time ?? 0,
      depthKm
    } satisfies EarthquakeMarkerInfo
  };

  marker.metadata = metadata;
  marker.position.copyFrom(markerPosition);

  const pickMarker = MeshBuilder.CreateSphere(
    `earthquake-pick-${markerId}`,
    { diameter: pickDiameter, segments: 8 },
    scene
  );

  pickMarker.position.copyFrom(markerPosition);
  pickMarker.isPickable = true;
  pickMarker.visibility = 0;
  pickMarker.metadata = metadata;

  marker.computeWorldMatrix(true);
  pickMarker.computeWorldMatrix(true);

  earthquakeNodes.push(marker, pickMarker);
}

function updateEarthquakeMarkerScale(): void {
  if (!earthquakeNodes.length) {
    return;
  }

  const fov = camera?.fov ?? controller.angleViewCamera;

  // Continental view keeps the old presence (floor 0.75)…
  let scale = clampNumber(fov / 0.72, 0.75, 1.0);

  // …and only PAST city-level zoom (fov < 0.15) the saucer eases down.
  // SQRT, not linear — they must stay commensurate with the city glow.
  if (fov < 0.15) {
    scale *= Math.max(0.22, Math.sqrt(fov / 0.15));
  }

  // Saucers ride at a FIXED half-kilometer — flat discs, no hugging.
  const lift = RENDER_EARTH_RADIUS * (0.5 / 6371);

  for (const marker of earthquakeNodes) {
    marker.scaling.setAll(scale);

    const md = marker.metadata as {
      surface?: Vector3;
      normal?: Vector3;
    } | null;

    if (md?.surface && md.normal) {
      marker.position.copyFrom(md.surface);
      md.normal.scaleAndAddToRef(lift, marker.position);
    }
  }
}

function isValidEarthquakeFeature(feature: EarthquakeFeature): boolean {
  const mag = feature.properties?.mag;
  const coordinates = feature.geometry?.coordinates;

  if (!Number.isFinite(mag)) {
    return false;
  }

  if (!coordinates || coordinates.length < 2) {
    return false;
  }

  const lon = coordinates[0];
  const lat = coordinates[1];

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

function clearEarthquakeNodes(): void {
  for (const node of earthquakeNodes) {
    node.dispose();
  }

  earthquakeNodes = [];
}

async function loadEarthquakes(scene: Scene): Promise<void> {
  if (earthquakeLoadInProgress) {
    return;
  }

  earthquakeLoadInProgress = true;

  try {
    const response = await fetch(earthquakeFeedUrl, { cache: 'no-store' });

    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as { features?: EarthquakeFeature[] };

    const features = (data.features ?? [])
      .filter((feature) => isValidEarthquakeFeature(feature))
      .sort((a, b) => {
        const timeA = a.properties?.time ?? 0;
        const timeB = b.properties?.time ?? 0;

        return timeB - timeA;
      })
      .slice(0, earthquakeMaxEvents);

    clearEarthquakeNodes();

    for (const feature of features) {
      createEarthquakeMarker(scene, feature);
    }
  } catch {
    // External live-data layer must fail silently — the globe stays
    // usable without the USGS feed.
  } finally {
    earthquakeLoadInProgress = false;
  }
}

function startEarthquakeUpdates(scene: Scene): void {
  void loadEarthquakes(scene);
  window.setInterval(() => void loadEarthquakes(scene), earthquakeRefreshMs);
}

function createEarthquakeTooltip(): void {
  const parent = tooltipParent;

  if (!parent) {
    return;
  }

  const tooltip = document.createElement('div');

  Object.assign(tooltip.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    zIndex: '20',
    pointerEvents: 'none',
    display: 'none',
    maxWidth: '260px',
    padding: '7px 9px',
    border: '1px solid rgba(255, 140, 80, 0.65)',
    background: 'rgba(12, 8, 4, 0.88)',
    color: 'rgba(255, 238, 220, 0.96)',
    fontFamily: 'Consolas, monospace',
    fontSize: '12px',
    lineHeight: '1.25',
    boxShadow: '0 0 16px rgba(255, 90, 30, 0.24)'
  });

  parent.appendChild(tooltip);

  earthquakeTooltipEl = tooltip;
}

function findNearestEarthquakeAtScreenPoint(
  x: number,
  y: number
): { mesh: Mesh; info: EarthquakeMarkerInfo } | null {
  const viewport = camera.viewport.toGlobal(
    Math.max(1, canvas.clientWidth),
    Math.max(1, canvas.clientHeight)
  );

  const cameraPosition = camera.position;

  let best: { mesh: Mesh; info: EarthquakeMarkerInfo; distancePx: number } | null =
    null;

  for (const mesh of earthquakeNodes) {
    const metadata = mesh.metadata as {
      kind?: string;
      earthquake?: EarthquakeMarkerInfo;
    };

    if (metadata.kind !== 'earthquake' || !metadata.earthquake) {
      continue;
    }

    // Invisible pick proxy meshes are intentionally ignored here.
    if (!mesh.isVisible || mesh.visibility === 0) {
      continue;
    }

    const position = mesh.getAbsolutePosition();
    const surfaceNormal = position.clone().normalize();

    // Orbit view: a marker is visible only on the near hemisphere.
    // PORT-LATER: ground-view (horizon) branch omitted until surface
    // view arrives.
    const cameraDirection = cameraPosition.subtract(position).normalize();

    if (Vector3.Dot(surfaceNormal, cameraDirection) <= 0) {
      continue;
    }

    const projected = Vector3.Project(
      position,
      Matrix.Identity(),
      scene.getTransformMatrix(),
      viewport
    );

    if (
      !Number.isFinite(projected.x) ||
      !Number.isFinite(projected.y) ||
      !Number.isFinite(projected.z) ||
      projected.z < 0 ||
      projected.z > 1
    ) {
      continue;
    }

    const dx = projected.x - x;
    const dy = projected.y - y;
    const distancePx = Math.sqrt(dx * dx + dy * dy);

    if (!best || distancePx < best.distancePx) {
      best = { mesh, info: metadata.earthquake, distancePx };
    }
  }

  if (!best || best.distancePx > earthquakeTooltipHitRadiusPx) {
    return null;
  }

  return { mesh: best.mesh, info: best.info };
}

function showEarthquakeTooltip(e: PointerEvent, info: EarthquakeMarkerInfo): void {
  if (!earthquakeTooltipEl) {
    return;
  }

  const point = tooltipPointerPoint(e);

  const timeText =
    info.time > 0 ? new Date(info.time).toLocaleString() : 'unknown time';

  earthquakeTooltipEl.innerHTML = [
    `<strong>M ${info.mag.toFixed(1)}</strong>`,
    escapeHtml(info.place),
    `${timeText}`,
    `depth ${info.depthKm.toFixed(1)} km`
  ].join('<br>');

  placeOverlayByQuadrant(earthquakeTooltipEl, point.x, point.y, 14);
  earthquakeTooltipEl.style.display = 'block';
}

function hideEarthquakeTooltip(): void {
  if (earthquakeTooltipEl) {
    earthquakeTooltipEl.style.display = 'none';
  }
}

createEarthquakeTooltip();
startEarthquakeUpdates(scene);

// ---- Cities (verbatim from .Me) -----------------------------------
// 34k GeoNames "embryos" as thin instances of one master plane (a soft
// mint blob), plus megacity NAME labels (tier 1). Hover → the city name
// (screen-space hit via a 1° bucket grid); click → a Wikipedia card
// found by geosearch. The ground-view (skyViewActive) label logic is
// omitted — PORT-LATER with surface view.

const cityLabelMeshes: Mesh[] = []; // Megacity NAMES (tier 1 only).
let cityEmbryoMaster: Mesh | undefined;
// 1°-bucket spatial index for the hover: key → cities in the cell.
const cityGrid = new Map<
  number,
  { name: string; position: Vector3; popK: number; latDeg: number; lonDeg: number }[]
>();
let cityLabelsEnabled = true;
let cityTooltipEl: HTMLDivElement | null = null;

function createCityLabels(scene: Scene): void {
  // Cities look like EMBRYOS of activity blobs: a soft warm spot,
  // world-fixed at ~a quarter degree.
  const blobTexture = new DynamicTexture(
    'city-blob-tex',
    { width: 64, height: 64 },
    scene,
    false
  );

  blobTexture.hasAlpha = true;

  const blobCtx =
    blobTexture.getContext() as unknown as CanvasRenderingContext2D;
  // Soft MINT green — green in spirit, with a light core so it reads on
  // the green land itself.
  const gradient = blobCtx.createRadialGradient(32, 32, 2, 32, 32, 30);

  gradient.addColorStop(0, 'rgba(230, 250, 236, 0.95)');
  gradient.addColorStop(0.3, 'rgba(186, 232, 194, 0.5)');
  gradient.addColorStop(0.62, 'rgba(168, 224, 176, 0.1)');
  gradient.addColorStop(1, 'rgba(168, 224, 176, 0)');
  blobCtx.clearRect(0, 0, 64, 64);
  blobCtx.fillStyle = gradient;
  blobCtx.fillRect(0, 0, 64, 64);
  blobTexture.update();

  const dotMaterial = new StandardMaterial('city-dot-mat', scene);

  dotMaterial.emissiveTexture = blobTexture;
  dotMaterial.opacityTexture = blobTexture;
  dotMaterial.disableLighting = true;
  dotMaterial.diffuseColor = new Color3(0, 0, 0);
  dotMaterial.specularColor = new Color3(0, 0, 0);

  // ALL cities (34k, GeoNames) as thin instances of one master.
  void loadCityEmbryos(scene, dotMaterial);

  for (const city of CITY_LABELS) {
    if (city.tier !== 1) {
      continue;
    }

    const n = controller.latLonNormal(city.latDeg, city.lonDeg);
    const position = new Vector3(n.x, n.y, n.z).scale(
      RENDER_EARTH_RADIUS * 1.004
    );

    // Megacities also whisper their NAME — small and thin.
    const texture = new DynamicTexture(
      `city-label-tex-${city.name}`,
      { width: 256, height: 64 },
      scene,
      false
    );

    texture.hasAlpha = true;

    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;

    ctx.clearRect(0, 0, 256, 64);
    ctx.font = '300 24px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 5;
    ctx.fillStyle = 'rgba(206, 220, 238, 0.92)';
    ctx.fillText(city.name, 128, 32);
    texture.update();

    const material = new StandardMaterial(`city-label-mat-${city.name}`, scene);

    material.emissiveTexture = texture;
    material.opacityTexture = texture;
    material.disableLighting = true;
    material.diffuseColor = new Color3(0, 0, 0);
    material.specularColor = new Color3(0, 0, 0);

    const plane = MeshBuilder.CreatePlane(
      `city-label-${city.name}`,
      { width: 0.073, height: 0.018 },
      scene
    );

    plane.material = material;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;
    plane.position = position.scale(1.004);
    plane.isVisible = false;

    cityLabelMeshes.push(plane);
  }
}

/** 34k embryos in ONE mesh: thin instances lying on the surface like
 *  decals. Size grows gently with population. */
async function loadCityEmbryos(
  scene: Scene,
  material: StandardMaterial
): Promise<void> {
  let rows: [string, number, number, number][];

  try {
    const response = await fetch('assets/cities.json');

    rows = (await response.json()) as [string, number, number, number][];
  } catch {
    return; // No catalog — the globe simply stays embryo-free.
  }

  if (scene.isDisposed) {
    return;
  }

  // The population knob — thousands; lower it to repopulate small towns.
  const minPopulationK = 100;

  rows = rows.filter(([, , , popK]) => popK >= minPopulationK);

  const master = MeshBuilder.CreatePlane(
    'city-embryos',
    { size: 1, sideOrientation: Mesh.DOUBLESIDE },
    scene
  );

  master.material = material;
  master.isPickable = false;
  master.alphaIndex = 2000; // Above the activity blobs.
  master.alwaysSelectAsActiveMesh = true;

  // Base diameter = a quarter of the 1° activity tile at 100k people,
  // scaled DOWN.
  const baseDiameter = RENDER_EARTH_RADIUS * ((0.25 * Math.PI) / 180) * 0.7;
  const matrices = new Float32Array(rows.length * 16);
  const scratch = new Matrix();
  const zAxis = new Vector3(0, 0, 1);
  const rotation = new Quaternion();

  rows.forEach(([name, latDeg, lonDeg, popK], index) => {
    const n = controller.latLonNormal(latDeg, lonDeg);
    const normal = new Vector3(n.x, n.y, n.z);
    // ×(1 + 1/6371) ≈ 1 km lift — hugs the land.
    const position = normal.scale(RENDER_EARTH_RADIUS * (1 + 1 / 6371));

    // sqrt(population): 100k → ×1, 1M → ×3.16 capped, 10M+ → ×2.4.
    const size =
      baseDiameter * Math.min(2.4, Math.max(0.8, Math.sqrt(popK / 100)));

    Quaternion.FromUnitVectorsToRef(zAxis, normal, rotation);
    Matrix.ComposeToRef(
      new Vector3(size, size, size),
      rotation,
      position,
      scratch
    );
    scratch.copyToArray(matrices, index * 16);

    // The 1° hover grid. SURFACE-level points (the embryos' radial lift
    // used to eat the whole hover tolerance).
    const key = (Math.floor(latDeg) + 90) * 361 + (Math.floor(lonDeg) + 180);
    const bucket = cityGrid.get(key);
    const entry = {
      name,
      position: normal.scale(RENDER_EARTH_RADIUS),
      popK,
      latDeg,
      lonDeg
    };

    if (bucket) {
      bucket.push(entry);
    } else {
      cityGrid.set(key, [entry]);
    }
  });

  master.thinInstanceSetBuffer('matrix', matrices, 16, true);
  cityEmbryoMaster = master;
  updateCityLabelVisibility();
}

function updateCityLabelVisibility(): void {
  // PORT-LATER: ground view (skyViewActive) once surface view arrives.
  const labelsShow = cityLabelsEnabled;

  for (const mesh of cityLabelMeshes) {
    mesh.isVisible = labelsShow;
    mesh.visibility = 0.7;
  }

  if (cityEmbryoMaster) {
    cityEmbryoMaster.isVisible = cityLabelsEnabled;
  }
}

function isCityLabelsEnabled(): boolean {
  return cityLabelsEnabled;
}

function toggleCityLabels(): void {
  cityLabelsEnabled = !cityLabelsEnabled;
  updateCityLabelVisibility();
  // PORT-LATER: refreshGroundCityLabels(true) once surface view arrives.
}

function findNearestCityAtScreenPoint(
  x: number,
  y: number
): { name: string; position: Vector3; popK: number; latDeg: number; lonDeg: number } | null {
  if (!cityLabelsEnabled || cityGrid.size === 0) {
    return null;
  }

  const pick = scene.pick(x, y, (mesh) => mesh.name === 'globe');

  if (!pick?.hit || !pick.pickedPoint) {
    return null;
  }

  const point = pick.pickedPoint;
  const r = point.length() || 1;
  const latDeg = (Math.asin(point.y / r) * 180) / Math.PI;
  const lonDeg = normalizeLonDeg(
    (Math.atan2(-point.z, -point.x) * 180) / Math.PI + controller.shiftLongDeg
  );

  // SCREEN-space distance (the earthquake recipe): project the candidate
  // cities and compare pixels.
  const viewport = camera.viewport.toGlobal(
    Math.max(1, canvas.clientWidth),
    Math.max(1, canvas.clientHeight)
  );
  const transform = scene.getTransformMatrix();

  const latIdx = Math.floor(latDeg) + 90;
  const lonIdx = Math.floor(lonDeg) + 180;

  let best:
    | {
        city: {
          name: string;
          position: Vector3;
          popK: number;
          latDeg: number;
          lonDeg: number;
        };
        distancePx: number;
      }
    | null = null;

  // ±2°: at grazing angles the hovered blob's city can sit a couple of
  // buckets away from the picked surface point.
  for (let dLat = -2; dLat <= 2; dLat++) {
    for (let dLon = -2; dLon <= 2; dLon++) {
      const key = (latIdx + dLat) * 361 + ((lonIdx + dLon + 361) % 361);
      const bucket = cityGrid.get(key);

      if (!bucket) {
        continue;
      }

      for (const city of bucket) {
        const projected = Vector3.Project(
          city.position,
          Matrix.Identity(),
          transform,
          viewport
        );

        if (
          !Number.isFinite(projected.x) ||
          !Number.isFinite(projected.y) ||
          !Number.isFinite(projected.z) ||
          projected.z < 0 ||
          projected.z > 1
        ) {
          continue;
        }

        const dx = projected.x - x;
        const dy = projected.y - y;
        const distancePx = Math.sqrt(dx * dx + dy * dy);

        if (!best || distancePx < best.distancePx) {
          best = { city, distancePx };
        }
      }
    }
  }

  // The same generous hit radius the earthquakes use.
  if (!best || best.distancePx > earthquakeTooltipHitRadiusPx) {
    return null;
  }

  return best.city;
}

function showCityTooltip(e: PointerEvent, name: string): void {
  if (!cityTooltipEl) {
    const parent = tooltipParent;

    if (!parent) {
      return;
    }

    const tooltip = document.createElement('div');

    Object.assign(tooltip.style, {
      position: 'absolute',
      pointerEvents: 'none',
      zIndex: '9500',
      padding: '6px 14px',
      borderRadius: '6px',
      border: '1px solid rgba(160, 190, 225, 0.5)',
      background: 'rgba(8, 14, 24, 0.82)',
      color: 'rgba(215, 228, 245, 0.95)',
      font: '16px Consolas, monospace',
      whiteSpace: 'nowrap',
      display: 'none'
    });
    parent.appendChild(tooltip);
    cityTooltipEl = tooltip;
  }

  const point = tooltipPointerPoint(e);

  cityTooltipEl.textContent = name;
  cityTooltipEl.style.left = `${point.x + 14}px`;
  cityTooltipEl.style.top = `${point.y + 12}px`;
  cityTooltipEl.style.display = 'block';
}

function hideCityTooltip(): void {
  if (cityTooltipEl) {
    cityTooltipEl.style.display = 'none';
  }
}

/** CITY CARD: the star-card machinery reused whole. The Wikipedia
 *  article is found by GEOSEARCH via GlobeWiki.fetchCityWiki. */
async function openCityCard(
  city: { name: string; popK: number; latDeg: number; lonDeg: number },
  x: number,
  y: number
): Promise<void> {
  const seq = ++starCardRequestSeq;
  const pop =
    city.popK >= 1000
      ? `${(city.popK / 1000).toFixed(1)} M`
      : `${city.popK} K`;
  const meta =
    `city · population ≈ ${pop} · ` +
    `${Math.abs(city.latDeg).toFixed(2)}°${city.latDeg >= 0 ? 'N' : 'S'} ` +
    `${Math.abs(city.lonDeg).toFixed(2)}°${city.lonDeg >= 0 ? 'E' : 'W'}`;

  const wiki = await globeWiki.fetchCityWiki(city);

  if (seq !== starCardRequestSeq) {
    return; // Something else took the card while we were fetching.
  }

  showStarCard(
    meta,
    wiki ?? {
      title: city.name,
      extract: 'No Wikipedia article found nearby.',
      url:
        'https://en.wikipedia.org/w/index.php?search=' +
        encodeURIComponent(city.name)
    },
    undefined,
    0,
    x,
    y
  );
}

function handleCityCardClick(e: PointerEvent): boolean {
  if (!cityLabelsEnabled) {
    return false;
  }

  const city = findNearestCityAtScreenPoint(e.offsetX, e.offsetY);

  if (!city) {
    return false;
  }

  void openCityCard(city, e.offsetX, e.offsetY);

  return true;
}

createCityLabels(scene);

// ---- Double-click "knock" (verbatim from .Me) ---------------------
// Double-click a 1° cell of the Earth → ask Wikidata what notable
// things sit inside that box (the discovery mechanic; works on cities
// too — a city falls inside its cell). First echelon: Wikidata
// landmarks (cyan sparks); second echelon: OSM Overpass camps & hiking
// trails (green sparks). Each find gets a 3D spark + pin on the globe,
// a hover tooltip, and a click that opens its article. In .Me the list
// also went to a host panel; here we render our own card.

type GlobeKnockFind = {
  id: string;
  name: string;
  typeLabel: string;
  latDeg: number;
  lonDeg: number;
  sitelinks: number;
  article: string | null;
  kind: 'wiki' | 'camp' | 'trail';
};

// The GlobeKnockEvent the host component consumed in .Me — here it
// drives our own panel. cellLat/Lon + click point + state + finds.
type GlobeKnockEvent = {
  cellLat: number;
  cellLon: number;
  clientX: number;
  clientY: number;
  loading: boolean;
  failed?: boolean;
  update?: boolean;
  travelRetryInSec?: number;
  finds: GlobeKnockFind[];
};

const knockCache = new Map<string, GlobeKnockFind[]>();
let knockInFlight = false;

// The panel state (mirrors app.component.ts signals).
let knockPanel: GlobeKnockEvent | null = null;
let knockExpandedId = '';
let knockPanelPos: { x: number; y: number } | null = null;
let knockPanelEl: HTMLDivElement | null = null;

// 3D discovery sparks: cyan for Wikidata landmarks, green for the
// travelers' finds (camps/trails). World-fixed on the surface (the
// globe itself does not rotate — only skyRoot does).
const KNOCK_MARKER_SIZE = 0.0005;
let knockRoot: TransformNode | null = null;
let knockMarkerMaster: Mesh | null = null;
let knockTravelMaster: Mesh | null = null;
const knockMarkerById = new Map<string, Mesh>();
const knockPinById = new Map<string, LinesMesh>();
const knockFindByMeshName = new Map<string, GlobeKnockFind>();
let knockHighlightedId: string | null = null;
let knockTooltipEl: HTMLDivElement | null = null;
let knockTooltipShown = false;
// GOOD MANNERS for the free Overpass server: one slot at a time,
// ~8 s between calls, a minute of cooling after a 429.
let overpassNextSlot = 0;

/** The list row under the mouse lights its spark on the globe. */
function highlightKnockFind(id: string | null): void {
  if (knockHighlightedId) {
    knockMarkerById.get(knockHighlightedId)?.scaling.setAll(KNOCK_MARKER_SIZE);
  }

  knockHighlightedId = id;

  if (id) {
    knockMarkerById.get(id)?.scaling.setAll(KNOCK_MARKER_SIZE * 2.4);
  }
}

/** Forget ONE cell: sparks down, cache dropped. */
function clearKnockCell(cellLat: number, cellLon: number): void {
  const key = `${cellLat}:${cellLon}`;
  const finds = knockCache.get(key) ?? [];

  for (const find of finds) {
    const mesh = knockMarkerById.get(find.id);

    if (mesh) {
      knockFindByMeshName.delete(mesh.name);
      mesh.dispose();
      knockMarkerById.delete(find.id);
    }

    knockPinById.get(find.id)?.dispose();
    knockPinById.delete(find.id);
  }

  knockCache.delete(key);
  knockHighlightedId = null;
}

/** Reset the globe: every discovered spark goes dark. */
function clearAllKnocks(): void {
  for (const mesh of knockMarkerById.values()) {
    mesh.dispose();
  }

  for (const pin of knockPinById.values()) {
    pin.dispose();
  }

  knockMarkerById.clear();
  knockPinById.clear();
  knockFindByMeshName.clear();
  knockCache.clear();
  knockHighlightedId = null;
}

function closeKnockPanel(): void {
  knockPanel = null;

  if (knockPanelEl) {
    knockPanelEl.remove();
    knockPanelEl = null;
  }

  highlightKnockFind(null);
}

function knockPanelLeft(event: GlobeKnockEvent): number {
  return Math.min(event.clientX, window.innerWidth - 300);
}

function knockPanelTop(event: GlobeKnockEvent): number {
  return Math.min(event.clientY, window.innerHeight - 360);
}

/** Drag the whole panel by its head (the × stays a button). */
function onKnockHeadPointerDown(event: PointerEvent, panel: HTMLElement): void {
  if ((event.target as HTMLElement).closest('button')) {
    return;
  }

  event.preventDefault();

  const rect = panel.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const move = (e: PointerEvent): void => {
    knockPanelPos = {
      x: rect.left + e.clientX - startX,
      y: rect.top + e.clientY - startY
    };
    panel.style.left = `${knockPanelPos.x}px`;
    panel.style.top = `${knockPanelPos.y}px`;
  };
  const up = (): void => document.removeEventListener('pointermove', move);

  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up, { once: true });
}

function knockFindRow(find: GlobeKnockFind, travel: boolean): HTMLElement {
  const wrap = document.createElement('div');

  const item = document.createElement('button');
  item.type = 'button';
  item.className = travel
    ? 'ap-sky-finder-item ap-knock-travel'
    : 'ap-sky-finder-item';

  if (find.id === knockExpandedId) {
    item.classList.add('ap-sky-finder-item-active');
  }

  const name = document.createElement('span');
  name.className = 'ap-sky-finder-name';
  name.textContent = find.name;

  const hint = document.createElement('span');
  hint.className = 'ap-sky-finder-hint';
  hint.textContent = find.typeLabel;

  item.appendChild(name);
  item.appendChild(hint);

  item.addEventListener('mouseenter', () => highlightKnockFind(find.id));
  item.addEventListener('click', () => {
    knockExpandedId = knockExpandedId === find.id ? '' : find.id;
    renderKnockPanel();
  });

  wrap.appendChild(item);

  if (find.id === knockExpandedId) {
    const detail = document.createElement('div');
    detail.className = 'ap-knock-detail';

    const line = document.createElement('div');
    line.textContent = travel
      ? find.typeLabel
      : `${find.typeLabel || 'place'} · known to ${find.sitelinks} Wikipedias`;
    detail.appendChild(line);

    if (find.article) {
      const a = document.createElement('a');
      a.href = find.article;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = travel ? 'open its page →' : 'Wikipedia →';
      detail.appendChild(a);
    }

    wrap.appendChild(detail);
  }

  return wrap;
}

function note(text: string, retry = false): HTMLElement {
  const el = document.createElement('div');
  el.className = retry
    ? 'ap-sky-finder-note ap-knock-retry-note'
    : 'ap-sky-finder-note';
  el.textContent = text;
  return el;
}

function renderKnockPanel(): void {
  const knock = knockPanel;

  if (!knock) {
    if (knockPanelEl) {
      knockPanelEl.remove();
      knockPanelEl = null;
    }
    return;
  }

  const panel = document.createElement('div');
  panel.className = 'ap-knock-panel';
  panel.style.left = `${knockPanelPos?.x ?? knockPanelLeft(knock)}px`;
  panel.style.top = `${knockPanelPos?.y ?? knockPanelTop(knock)}px`;
  panel.addEventListener('mouseleave', () => highlightKnockFind(null));

  const head = document.createElement('div');
  head.className = 'ap-knock-head';
  head.addEventListener('pointerdown', (e) =>
    onKnockHeadPointerDown(e, panel)
  );

  const title = document.createElement('span');
  title.className = 'ap-sky-finder-title';
  title.textContent =
    `Within this degree · ${knock.cellLat}…${knock.cellLat + 1}° / ` +
    `${knock.cellLon}…${knock.cellLon + 1}°`;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ap-sky-finder-clear';
  close.textContent = '×';
  close.addEventListener('click', () => closeKnockPanel());

  head.appendChild(title);
  head.appendChild(close);
  panel.appendChild(head);

  if (knock.loading) {
    panel.appendChild(note('knocking…'));
  }

  if (knock.failed) {
    panel.appendChild(
      note(
        'the archive did not answer — give it a minute and knock again (busy free servers)',
        true
      )
    );
  }

  if (!knock.loading && !knock.failed && knock.finds.length === 0) {
    panel.appendChild(note('nothing notable here — untouched land'));
  }

  if (!knock.loading) {
    if (knock.finds.length > 0) {
      const actions = document.createElement('div');
      actions.className = 'ap-knock-actions';

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ap-knock-action';
      remove.textContent = 'remove these finds';
      remove.addEventListener('click', () => {
        clearKnockCell(knock.cellLat, knock.cellLon);
        closeKnockPanel();
      });

      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'ap-knock-action';
      reset.textContent = 'reset globe';
      reset.addEventListener('click', () => {
        clearAllKnocks();
        closeKnockPanel();
      });

      actions.appendChild(remove);
      actions.appendChild(reset);
      panel.appendChild(actions);
    }

    for (const find of knock.finds.filter((f) => f.kind === 'wiki')) {
      panel.appendChild(knockFindRow(find, false));
    }

    if (knock.travelRetryInSec) {
      panel.appendChild(
        note(
          `camps & trails: the free map server asks for a pause — knock again in ~${knock.travelRetryInSec} s`,
          true
        )
      );
    }

    const travelFinds = knock.finds.filter((f) => f.kind !== 'wiki');

    if (travelFinds.length > 0) {
      const groupTitle = document.createElement('div');
      groupTitle.className = 'ap-sky-finder-title ap-sky-finder-title-gap';
      groupTitle.textContent = 'For travelers · camps & trails';
      panel.appendChild(groupTitle);

      for (const find of travelFinds) {
        panel.appendChild(knockFindRow(find, true));
      }
    }
  }

  document.body.appendChild(panel);

  if (knockPanelEl) {
    knockPanelEl.remove();
  }

  knockPanelEl = panel;
}

/** The onGlobeKnock host logic: a fresh knock lands at the click; the
 *  travelers' echelon only refreshes a panel STILL showing this cell. */
function showKnock(event: GlobeKnockEvent): void {
  if (event.update) {
    const current = knockPanel;

    if (
      !current ||
      current.cellLat !== event.cellLat ||
      current.cellLon !== event.cellLon
    ) {
      return;
    }

    knockPanel = {
      ...current,
      finds: event.finds,
      travelRetryInSec: event.travelRetryInSec
    };
    renderKnockPanel();
    return;
  }

  knockExpandedId = '';
  knockPanelPos = null; // A fresh knock lands at the click.
  knockPanel = event;
  renderKnockPanel();
}

async function knockAtCell(
  cellLat: number,
  cellLon: number,
  clientX: number,
  clientY: number
): Promise<void> {
  const key = `${cellLat}:${cellLon}`;
  const cached = knockCache.get(key);

  if (cached) {
    showKnock({
      cellLat,
      cellLon,
      clientX,
      clientY,
      loading: false,
      finds: cached
    });
    return;
  }

  showKnock({ cellLat, cellLon, clientX, clientY, loading: true, finds: [] });
  knockInFlight = true;

  try {
    const query = [
      'SELECT ?item ?itemLabel ?coord ?sitelinks ?tLabel ?article WHERE {',
      '  SERVICE wikibase:box {',
      '    ?item wdt:P625 ?coord.',
      '    bd:serviceParam wikibase:cornerSouthWest',
      `      "Point(${cellLon} ${cellLat})"^^geo:wktLiteral.`,
      '    bd:serviceParam wikibase:cornerNorthEast',
      `      "Point(${cellLon + 1} ${cellLat + 1})"^^geo:wktLiteral.`,
      '  }',
      '  ?item wikibase:sitelinks ?sitelinks.',
      '  FILTER(?sitelinks >= 4)',
      '  OPTIONAL { ?item wdt:P31 ?t. ?t rdfs:label ?tLabel.',
      '    FILTER(LANG(?tLabel) = "en") }',
      '  OPTIONAL { ?article schema:about ?item;',
      '    schema:isPartOf <https://en.wikipedia.org/>. }',
      '  SERVICE wikibase:label {',
      '    bd:serviceParam wikibase:language "en".',
      '  }',
      '} ORDER BY DESC(?sitelinks) LIMIT 120'
    ].join('\n');

    const response = await fetch(
      'https://query.wikidata.org/sparql?format=json&query=' +
        encodeURIComponent(query),
      {
        headers: { Accept: 'application/sparql-results+json' },
        signal: AbortSignal.timeout(12000)
      }
    );

    if (!response.ok) {
      throw new Error(`sparql ${response.status}`);
    }

    const data = (await response.json()) as {
      results?: { bindings?: Array<Record<string, { value?: string }>> };
    };
    const bindings = data.results?.bindings ?? [];
    const seen = new Set<string>();
    const finds: GlobeKnockFind[] = [];

    for (const row of bindings) {
      const id = row['item']?.value ?? '';
      const name = row['itemLabel']?.value ?? '';
      const point = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(
        row['coord']?.value ?? ''
      );

      // Bare Q-ids are unnamed noise; duplicates come from extra P31
      // rows — the FIRST row (highest rank order) wins.
      if (!id || !point || !name || /^Q\d+$/.test(name)) {
        continue;
      }

      if (seen.has(id)) {
        continue;
      }

      seen.add(id);

      const lonDeg = Number(point[1]);
      const latDeg = Number(point[2]);

      if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
        continue;
      }

      finds.push({
        id,
        name,
        typeLabel: row['tLabel']?.value ?? '',
        latDeg,
        lonDeg,
        sitelinks: Number(row['sitelinks']?.value ?? 0),
        article: row['article']?.value ?? null,
        kind: 'wiki'
      });

      if (finds.length >= 40) {
        break;
      }
    }

    // Administrative units carry heaps of sitelinks and crowd out
    // mountains and lakes — demote them below everything else, keep fame
    // order within groups.
    const isAdmin = (t: string): boolean =>
      /county|district|governorate|municipal|census|territor|administrat|oblast|raion|commune|okrug|subdivision/i.test(
        t
      );

    finds.sort(
      (a, b) =>
        Number(isAdmin(a.typeLabel)) - Number(isAdmin(b.typeLabel)) ||
        b.sitelinks - a.sitelinks
    );
    finds.length = Math.min(finds.length, 15);

    // FIRST ECHELON: the landmarks show the moment they arrive — cache,
    // 3D sparks, panel.
    knockCache.set(key, finds);
    buildKnockMarkers(finds);
    showKnock({ cellLat, cellLon, clientX, clientY, loading: false, finds });

    // THE LOCK OPENS HERE: while the slow second echelon rides,
    // knockInFlight must not swallow every new knock.
    knockInFlight = false;

    // SECOND ECHELON: camps & hiking trails from OpenStreetMap. A
    // failure or a timeout here never spoils the landmarks. During a
    // deep 429 cooldown we say WHEN to knock again.
    const cooldown = overpassNextSlot - Date.now();

    if (cooldown > 30000) {
      showKnock({
        cellLat,
        cellLon,
        clientX,
        clientY,
        loading: false,
        update: true,
        travelRetryInSec: Math.ceil(cooldown / 1000),
        finds
      });
      return;
    }

    try {
      const travel = await knockLoadTravel(cellLat, cellLon);

      if (travel.length > 0) {
        const combined = [...finds, ...travel];

        knockCache.set(key, combined);
        buildKnockMarkers(travel);
        showKnock({
          cellLat,
          cellLon,
          clientX,
          clientY,
          loading: false,
          update: true,
          finds: combined
        });
      }
    } catch {
      // Overpass hiccup / 429 — the landmarks stand, travelers wait.
    }
  } catch {
    // A knock that fails: the panel shows the retry note.
    showKnock({
      cellLat,
      cellLon,
      clientX,
      clientY,
      loading: false,
      failed: true,
      finds: knockCache.get(key) ?? []
    });
    knockInFlight = false;
  }
}

/** Soft cyan/green sparks on the discovered spots — opened land stays
 *  lit for the session (the first footprints of the trodden Road). */
function buildKnockMarkers(finds: GlobeKnockFind[]): void {
  if (finds.length === 0) {
    return;
  }

  if (!knockRoot || knockRoot.isDisposed()) {
    knockRoot = new TransformNode('knock-root', scene);
  }

  const makeMaster = (name: string, color: Color3): Mesh => {
    const master = MeshBuilder.CreateSphere(
      name,
      { diameter: 1, segments: 8 },
      scene
    );
    const material = new StandardMaterial(`${name}-mat`, scene);

    material.emissiveColor = color;
    material.diffuseColor = new Color3(0, 0, 0);
    material.specularColor = new Color3(0, 0, 0);
    material.disableLighting = true;
    master.material = material;
    master.isVisible = false;
    master.isPickable = false;

    return master;
  };

  if (!knockMarkerMaster || knockMarkerMaster.isDisposed()) {
    knockMarkerMaster = makeMaster(
      'knock-marker-master',
      new Color3(0.55, 0.9, 1.0)
    );
  }

  if (!knockTravelMaster || knockTravelMaster.isDisposed()) {
    // GREEN for the travelers' finds.
    knockTravelMaster = makeMaster(
      'knock-travel-master',
      new Color3(0.35, 0.95, 0.55)
    );
  }

  for (const find of finds) {
    if (knockMarkerById.has(find.id)) {
      continue;
    }

    const meshName = `knock-${find.id.split('/').pop()}`;
    const master = find.kind === 'wiki' ? knockMarkerMaster : knockTravelMaster;
    const instance = master.createInstance(meshName);
    const n = controller.latLonNormal(find.latDeg, find.lonDeg);

    // GROUNDED: the head floats ~2 km up, the pin is short — from the
    // surface view the sparks belong to the land, not the constellations.
    instance.position = new Vector3(n.x, n.y, n.z).scale(
      RENDER_EARTH_RADIUS * 1.00031
    );
    instance.scaling.setAll(KNOCK_MARKER_SIZE);
    instance.isPickable = true; // The spark answers to hover.
    instance.parent = knockRoot;
    knockMarkerById.set(find.id, instance as unknown as Mesh);
    knockFindByMeshName.set(meshName, find);

    // The PIN: from the ground straight up to the spark head.
    const pin = MeshBuilder.CreateLines(
      `knock-pin-${find.id.split('/').pop()}`,
      {
        points: [
          new Vector3(n.x, n.y, n.z).scale(RENDER_EARTH_RADIUS * 1.00002),
          instance.position.clone()
        ]
      },
      scene
    );

    pin.color =
      find.kind === 'wiki'
        ? new Color3(0.55, 0.9, 1.0)
        : new Color3(0.35, 0.95, 0.55);
    pin.alpha = 1; // The Safari GL-lines law: opaque.
    pin.isPickable = false;
    pin.parent = knockRoot;
    knockPinById.set(find.id, pin);
  }
}

/** Camps and named hiking routes of the cell from OSM Overpass. */
async function knockLoadTravel(
  cellLat: number,
  cellLon: number
): Promise<GlobeKnockFind[]> {
  const wait = overpassNextSlot - Date.now();

  if (wait > 30000) {
    return []; // Deep cooldown after a 429 — skip quietly.
  }

  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  // A 429 may have landed WHILE we waited in the queue — re-check.
  if (overpassNextSlot - Date.now() > 30000) {
    return [];
  }

  overpassNextSlot = Date.now() + 8000;

  const bbox = `${cellLat},${cellLon},${cellLat + 1},${cellLon + 1}`;
  const query =
    '[out:json][timeout:20];(' +
    `nwr["tourism"="camp_site"]["name"](${bbox});` +
    `relation["route"="hiking"]["name"](${bbox});` +
    ');out center 60;';
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    if (response.status === 429) {
      // Rate-limited — cool off for a minute before the next try.
      overpassNextSlot = Date.now() + 60000;
    }

    throw new Error(`overpass ${response.status}`);
  }

  const data = (await response.json()) as {
    elements?: Array<{
      type: string;
      id: number;
      lat?: number;
      lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    }>;
  };
  const out: GlobeKnockFind[] = [];

  for (const el of data.elements ?? []) {
    const name = el.tags?.['name'] ?? '';
    const latDeg = el.lat ?? el.center?.lat;
    const lonDeg = el.lon ?? el.center?.lon;

    if (!name || latDeg === undefined || lonDeg === undefined) {
      continue;
    }

    const isTrail = el.tags?.['route'] === 'hiking';

    out.push({
      id: `osm-${el.type}-${el.id}`,
      name,
      typeLabel: isTrail ? 'hiking trail' : 'campsite',
      latDeg,
      lonDeg,
      sitelinks: 0,
      article:
        el.tags?.['website'] ??
        `https://www.openstreetmap.org/${el.type}/${el.id}`,
      kind: isTrail ? 'trail' : 'camp'
    });
  }

  // Websites first (richer pages), then alphabet; cap 12.
  out.sort(
    (a, b) =>
      Number(b.article?.includes('openstreetmap') ? 0 : 1) -
        Number(a.article?.includes('openstreetmap') ? 0 : 1) ||
      a.name.localeCompare(b.name)
  );

  return out.slice(0, 12);
}

function ensureKnockTooltip(): HTMLDivElement | null {
  if (knockTooltipEl) {
    return knockTooltipEl;
  }

  const parent = tooltipParent;

  if (!parent) {
    return null;
  }

  const el = document.createElement('div');

  Object.assign(el.style, {
    position: 'absolute',
    display: 'none',
    zIndex: '40',
    pointerEvents: 'none',
    padding: '6px 10px',
    background: 'rgba(3, 12, 24, 0.95)',
    border: '1px solid rgba(120, 230, 255, 0.5)',
    font: '500 12px Consolas, monospace',
    color: 'rgba(228, 246, 255, 0.95)',
    whiteSpace: 'nowrap'
  });
  parent.appendChild(el);
  knockTooltipEl = el;

  return el;
}

function onKnockPointerMove(e: PointerEvent): void {
  if (knockFindByMeshName.size === 0) {
    return;
  }

  // A predicate OVERRIDES isPickable — the pin lines and the invisible
  // master must be excluded by hand, or they eat the ray.
  const pick = scene.pick(
    e.offsetX,
    e.offsetY,
    (mesh) =>
      mesh.isPickable && mesh.isEnabled() && knockFindByMeshName.has(mesh.name)
  );
  const find = pick?.pickedMesh
    ? knockFindByMeshName.get(pick.pickedMesh.name)
    : undefined;

  const tooltip = ensureKnockTooltip();

  if (!tooltip) {
    return;
  }

  if (find) {
    tooltip.innerHTML =
      `<strong>${escapeHtml(find.name)}</strong>` +
      (find.typeLabel ? `<br>${escapeHtml(find.typeLabel)}` : '') +
      (find.kind === 'wiki' ? `<br>known to ${find.sitelinks} Wikipedias` : '') +
      (find.article
        ? `<br><em>click the spark → ${
            find.kind === 'wiki' ? 'Wikipedia' : 'its page'
          }</em>`
        : '');
    const p = tooltipPointerPoint(e);
    placeOverlayByQuadrant(tooltip, p.x, p.y, 14);
    tooltip.style.display = 'block';
    knockTooltipShown = true;
  } else if (knockTooltipShown) {
    tooltip.style.display = 'none';
    knockTooltipShown = false;
  }
}

function onKnockClick(e: MouseEvent): void {
  if (knockFindByMeshName.size === 0) {
    return;
  }

  const pick = scene.pick(
    e.offsetX,
    e.offsetY,
    (mesh) =>
      mesh.isPickable && mesh.isEnabled() && knockFindByMeshName.has(mesh.name)
  );
  const find = pick?.pickedMesh
    ? knockFindByMeshName.get(pick.pickedMesh.name)
    : undefined;

  if (find?.article) {
    window.open(find.article, '_blank', 'noopener');
  }
}

function onCanvasDblClick(e: MouseEvent): void {
  if (knockInFlight) {
    return; // One knock at a time.
  }

  // Orbit view: knock only when the double-click lands on the EARTH —
  // a double-click into the sky stays the sky's business.
  const pick = scene.pick(e.offsetX, e.offsetY, (mesh) => mesh.name === 'globe');

  if (!pick?.hit || !pick.pickedPoint) {
    return;
  }

  const spot = globePointToLatLon(pick.pickedPoint.clone());

  void knockAtCell(
    Math.floor(spot.latDeg),
    Math.floor(spot.lonDeg),
    e.clientX,
    e.clientY
  );
}

canvas.addEventListener('dblclick', onCanvasDblClick);
// A separate pointermove/click pair for the sparks (a spark sits above
// the globe; its own predicate pick keeps it independent of the surface
// hover and card clicks).
canvas.addEventListener('pointermove', onKnockPointerMove);
canvas.addEventListener('click', onKnockClick);

// The knock panel folds the same standard way: a click past it closes
// it (the panel itself is excluded).
document.addEventListener('pointerdown', (e) => {
  if (!knockPanel) {
    return;
  }

  const target = e.target as HTMLElement | null;

  if (!target?.closest('.ap-knock-panel')) {
    closeKnockPanel();
  }
});

/** The detail + deep-zoom gates breathe with the FOV (.Me updateGlobeDetailGate;
 *  no sky view in Stage 1). */
function updateGlobeDetailGate(): void {
  const fov = controller.angleViewCamera;
  const gate = Math.min(1, Math.max(0, (0.3 - fov) / 0.25));
  globeMaterial.setFloat('detailGate', gate);
  const deep = Math.min(1, Math.max(0, (0.055 - fov) / 0.045));
  globeMaterial.setFloat('deepGate', deep);
}

// ---- Input → controller (no Babylon defaults) ---------------------

// ---- Center crosshair with the point's coordinates (verbatim) -----

function normalizeLonDeg(value: number): number {
  let result = value % 360;
  if (result > 180) {
    result -= 360;
  }
  if (result < -180) {
    result += 360;
  }
  return result;
}

function globePointToLatLon(point: Vector3): {
  latDeg: number;
  lonDeg: number;
} {
  const normal = point.clone().normalize();

  // Exact inverse of GlobeController.latLonNormal().
  const theta = Math.asin(normal.y);
  const phi = Math.atan2(-normal.z, -normal.x);

  const latDeg = (theta * 180) / Math.PI - controller.shiftLatDeg;
  const lonDeg = normalizeLonDeg(
    (phi * 180) / Math.PI + controller.shiftLongDeg
  );

  return { latDeg: Math.min(85, Math.max(-85, latDeg)), lonDeg };
}

const orbitCrosshairEl = document.createElement('div');
Object.assign(orbitCrosshairEl.style, {
  position: 'absolute',
  left: '50%',
  top: '50%',
  pointerEvents: 'none',
  zIndex: '14',
  fontFamily: 'Consolas, monospace',
  display: 'none'
});
orbitCrosshairEl.innerHTML =
  `<div style="position:absolute;left:-42px;top:-1px;width:27px;height:2px;background:rgba(255,224,150,0.85);"></div>` +
  `<div style="position:absolute;left:15px;top:-1px;width:27px;height:2px;background:rgba(255,224,150,0.85);"></div>` +
  `<div style="position:absolute;left:-1px;top:-42px;width:2px;height:27px;background:rgba(255,224,150,0.85);"></div>` +
  `<div style="position:absolute;left:-1px;top:15px;width:2px;height:27px;background:rgba(255,224,150,0.85);"></div>` +
  `<div data-role="coords" style="position:absolute;left:22px;top:-32px;` +
  `white-space:nowrap;font-size:15px;font-weight:700;` +
  `color:rgba(255,224,150,0.96);text-shadow:0 0 7px rgba(0,0,0,0.95);"></div>`;
tooltipParent.appendChild(orbitCrosshairEl);

let orbitCrosshairText = '';

function updateOrbitCrosshair(): void {
  const ray = camera.getForwardRay(1);
  const p = ray.origin;
  const d = ray.direction.normalize();
  const r = RENDER_EARTH_RADIUS;
  const pd = Vector3.Dot(p, d);
  const disc = pd * pd - (p.lengthSquared() - r * r);

  if (disc <= 0) {
    orbitCrosshairEl.style.display = 'none';
    return;
  }

  const t = -pd - Math.sqrt(disc);

  if (t <= 0) {
    orbitCrosshairEl.style.display = 'none';
    return;
  }

  orbitCrosshairEl.style.display = 'block';

  const { latDeg, lonDeg } = globePointToLatLon(p.add(d.scale(t)));
  const lat = Math.round(latDeg);
  const lon = Math.round(lonDeg);
  const text =
    `${lat >= 0 ? 'N' : 'S'} ${Math.abs(lat)}° · ` +
    `${lon >= 0 ? 'E' : 'W'} ${Math.abs(lon)}°`;

  if (text !== orbitCrosshairText) {
    orbitCrosshairText = text;
    const coords = orbitCrosshairEl.querySelector(
      '[data-role="coords"]'
    ) as HTMLElement | null;
    if (coords) {
      coords.textContent = text;
    }
  }
}

function canvasSize(): { w: number; h: number } {
  return {
    w: canvas.clientWidth || engine.getRenderWidth(),
    h: canvas.clientHeight || engine.getRenderHeight()
  };
}

// Surface layers take the cursor before the sky: earthquake → city →
// then the sky hover (stars/planets/constellations). Mirrors .Me
// updateEarthquakeHover.
function updateSurfaceHover(e: PointerEvent): void {
  const nearest = findNearestEarthquakeAtScreenPoint(e.offsetX, e.offsetY);

  if (!nearest) {
    const city = findNearestCityAtScreenPoint(e.offsetX, e.offsetY);

    if (city) {
      hideEarthquakeTooltip();
      showCityTooltip(e, city.name);
      hideStarTooltip();
      setHoveredConstellation(null);
      return;
    }

    hideEarthquakeTooltip();
    hideCityTooltip();
    handleSkyHover(e);
    return;
  }

  showEarthquakeTooltip(e, nearest.info);
  hideCityTooltip();
  hideStarTooltip();
  setHoveredConstellation(null);
}

let dragging = false;
let prevX = 0;
let prevY = 0;
// Click vs drag: a pointerup that barely moved from its pointerdown is
// a click → open a star/constellation/body card.
let downX = 0;
let downY = 0;
let pointerMoved = false;

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  prevX = e.clientX;
  prevY = e.clientY;
  downX = e.clientX;
  downY = e.clientY;
  pointerMoved = false;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (dragging) {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) {
      pointerMoved = true;
    }
    const { w, h } = canvasSize();
    if (skyViewActive) {
      // Grab the sky: pan azimuth/altitude.
      dragSkyView(e.clientX - prevX, e.clientY - prevY, h);
    } else {
      controller.drag(e.clientX, e.clientY, prevX, prevY, w, h);
    }
    prevX = e.clientX;
    prevY = e.clientY;
    return;
  }
  updateSurfaceHover(e);
});

canvas.addEventListener('pointerleave', () => {
  setHoveredConstellation(null);
  hideStarTooltip();
  hideEarthquakeTooltip();
  hideCityTooltip();
});

const endDrag = (e: PointerEvent): void => {
  const wasClick = dragging && !pointerMoved;
  dragging = false;
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    // Already released.
  }

  if (wasClick && e.type === 'pointerup') {
    // City card first (it sits ON the globe); the sky card refuses
    // globe hits and falls through.
    if (!handleCityCardClick(e)) {
      handleStarCardClick(e);
    }
  }
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    controller.zoomByWheel(e.deltaY);
  },
  { passive: false }
);

function onResize(): void {
  engine.resize();
  const { w, h } = canvasSize();
  controller.resize(w, h);
}
window.addEventListener('resize', onResize);
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(onResize).observe(canvas);
}

// ---- Centre on the viewer (equator/Greenwich if unknown) ----------

function centre(latDeg: number, lonDeg: number): void {
  const { w, h } = canvasSize();
  controller.setCentralPosition(latDeg, lonDeg, w, h);
}

centre(0, 0);

// The viewer's own place (geolocation) — the "fly home" target.
let homeLatLon: { latDeg: number; lonDeg: number } | null = null;

if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      homeLatLon = {
        latDeg: pos.coords.latitude,
        lonDeg: pos.coords.longitude
      };
      centre(pos.coords.latitude, pos.coords.longitude);
    },
    () => {
      // Denied/unavailable — the equator default stands.
    },
    { enableHighAccuracy: false, timeout: 7000, maximumAge: 600000 }
  );
}

// ---- Dock actions (verbatim from .Me, orbit branch only) ----------
// Surface (sky-view) is not ported yet, so the ground branches of
// flyHome / nudge are PORT-LATER; the orbit branches drive the camera.

let skyFlightActive = false;
let skyFlightRafId: number | null = null;

function isSkyFlightActive(): boolean {
  return skyFlightActive;
}

function cancelSkyFlight(): void {
  skyFlightActive = false;

  if (skyFlightRafId !== null) {
    cancelAnimationFrame(skyFlightRafId);
    skyFlightRafId = null;
  }
}

/** Shared autopilot: a smooth great-circle glide between two points on
 *  the sphere (900ms + 1700ms·angle/π, smoothstep easing). */
function animateGreatCircle(
  fromLatLon: { latDeg: number; lonDeg: number },
  toLatLon: { latDeg: number; lonDeg: number },
  apply: (latDeg: number, lonDeg: number, dir: Vector3) => void,
  done?: () => void
): void {
  cancelSkyFlight();

  const D = Math.PI / 180;
  const toDir = (latDeg: number, lonDeg: number): Vector3 => {
    const y = latDeg * D;
    const x = (lonDeg - controller.shiftLongDeg) * D;
    const c = Math.cos(y);

    return new Vector3(-c * Math.cos(x), Math.sin(y), -c * Math.sin(x));
  };
  const from = toDir(fromLatLon.latDeg, fromLatLon.lonDeg);
  const to = toDir(
    Math.min(89, Math.max(-89, toLatLon.latDeg)),
    toLatLon.lonDeg
  );
  const dot = Math.min(1, Math.max(-1, Vector3.Dot(from, to)));
  const angle = Math.acos(dot);

  if (angle < 1e-4) {
    return; // Already there.
  }

  let axis = Vector3.Cross(from, to);

  if (axis.lengthSquared() < 1e-9) {
    axis = Vector3.Cross(from, new Vector3(0, 1, 0));

    if (axis.lengthSquared() < 1e-9) {
      axis = new Vector3(1, 0, 0);
    }
  }

  axis.normalize();

  const durationMs = 900 + (angle / Math.PI) * 1700;
  const startedAt = performance.now();

  const step = (): void => {
    const t = Math.min(1, (performance.now() - startedAt) / durationMs);
    const eased = t * t * (3 - 2 * t);
    const dir = Vector3.TransformCoordinates(
      from,
      Matrix.RotationAxis(axis, angle * eased)
    ).normalize();
    const latDeg = Math.asin(Math.min(1, Math.max(-1, dir.y))) / D;
    const lonDeg = normalizeLonDeg(
      Math.atan2(-dir.z, -dir.x) / D + controller.shiftLongDeg
    );

    apply(latDeg, lonDeg, dir);

    if (t < 1) {
      skyFlightRafId = requestAnimationFrame(step);
    } else {
      skyFlightRafId = null;
      skyFlightActive = false;
      done?.();
    }
  };

  skyFlightActive = true;
  skyFlightRafId = requestAnimationFrame(step);
}

// ---- Surface view "stand on the ground" (verbatim core from .Me) ---
// The camera drops onto the surface point under it and looks at the sky
// (azimuth/altitude in a local ENU frame). Drag pans the sky, the
// lat/lon chips travel the standing point, home flies it. PORT-LATER
// (need their own subsystems): cardinal markers, sky rulers, tracking,
// finder, ground city labels, the balloon height wheel, gaze persist.

let skyViewActive = false;
let skyViewAzimuthRad = (270 * Math.PI) / 180;
let skyViewAltitudeRad = (18 * Math.PI) / 180;
let skyViewSurfacePoint = new Vector3(0, 0, 0);
let skyViewLatLonDeg: { latDeg: number; lonDeg: number } | null = null;
let skyViewSavedMinZ: number | null = null;
let skyViewSavedOrbitFov: number | null = null;
let skyViewOwnFov: number | null = null;
// One source for the observer height; the balloon wheel is PORT-LATER.
const skyObserverHeightKm = 10;

function skyObserverRadiusFactor(): number {
  return 1 + skyObserverHeightKm / 6371;
}

function isSkyViewActive(): boolean {
  return skyViewActive;
}

/** Local ENU frame at the standing point (east degenerates at the
 *  poles → X). Babylon is LEFT-handed: Cross(up, Y) is the honest
 *  east; north = Cross(east, up). */
function skyViewFrame(): { up: Vector3; east: Vector3; north: Vector3 } {
  const up = skyViewSurfacePoint.clone().normalize();
  let east = Vector3.Cross(up, new Vector3(0, 1, 0));

  if (east.lengthSquared() < 1e-6) {
    east = new Vector3(1, 0, 0);
  } else {
    east.normalize();
  }

  const north = Vector3.Cross(east, up).normalize();

  return { up, east, north };
}

/** Unit direction for a given azimuth/altitude in the standing frame. */
function skyViewDirection(azimuthRad: number, altitudeRad: number): Vector3 {
  const { up, east, north } = skyViewFrame();
  const horizontal = north
    .scale(Math.cos(azimuthRad))
    .add(east.scale(Math.sin(azimuthRad)));

  return up
    .scale(Math.sin(altitudeRad))
    .add(horizontal.scale(Math.cos(altitudeRad)));
}

function applySkyViewCamera(): void {
  // PORT-LATER: if (skyTrackingEnabled) applySkyTracking();
  const { up } = skyViewFrame();
  const viewDirection = skyViewDirection(skyViewAzimuthRad, skyViewAltitudeRad);

  camera.upVector = up;
  camera.setPosition(skyViewSurfacePoint.clone());
  camera.setTarget(skyViewSurfacePoint.add(viewDirection.scale(10)));
  camera.fov = controller.angleViewCamera;

  updateSolarBodyScales();
  // PORT-LATER: updateGroundCityLabelScale(); updateSkyRulers();
  updateGlobeDetailGate();
}

/** Drag = grab the sky: radians per pixel follow the CURRENT fov. */
function dragSkyView(dx: number, dy: number, canvasHeight: number): void {
  cancelSkyFlight(); // The hand overrides the autopilot.

  const radiansPerPixel =
    controller.angleViewCamera / Math.max(1, canvasHeight);

  // Minus is the correct sign with the fixed left-handed frame — drag
  // right pulls the sky rightward.
  skyViewAzimuthRad =
    (skyViewAzimuthRad - dx * radiansPerPixel) % (Math.PI * 2);
  skyViewAltitudeRad = Math.min(
    (89 * Math.PI) / 180,
    Math.max((-85 * Math.PI) / 180, skyViewAltitudeRad + dy * radiansPerPixel)
  );

  // PORT-LATER: if (skyTrackingEnabled) anchorSkyTracking();
  applySkyViewCamera();
}

function enterSkyView(): void {
  if (skyViewActive) {
    return;
  }

  // PORT-LATER: restore the remembered gaze (az/alt) from localStorage.

  // The arrival greets the horizon, never the dirt.
  if (skyViewAltitudeRad < (2 * Math.PI) / 180) {
    skyViewAltitudeRad = (18 * Math.PI) / 180;
  }

  // Drop onto the surface point under the current camera direction,
  // ~5 km up (skyObserverRadiusFactor); the terrain chapter takes it
  // lower still.
  const direction = new Vector3(
    controller.xCurrent,
    controller.yCurrent,
    controller.zCurrent
  ).normalize();

  skyViewSurfacePoint = direction.scale(
    RENDER_EARTH_RADIUS * skyObserverRadiusFactor()
  );

  // The near plane must come down WITH the camera (the orbit minZ would
  // clip the ground).
  skyViewSavedMinZ = camera.minZ;
  camera.minZ = 0.0002;

  skyViewLatLonDeg = controller.getCurrentLatLonDeg();
  skyViewActive = true;

  // Swap to the GROUND zoom; the orbit zoom waits for the return.
  skyViewSavedOrbitFov = controller.angleViewCamera;
  controller.angleViewCamera = skyViewOwnFov ?? controller.maxAngleViewCamera;

  // PORT-LATER: createSkyCardinalMarkers(); createSkyRulers();
  // refreshGroundCityLabels(true); applyHomeMarkerViewMode();
  orbitCrosshairEl.style.display = 'none';
  applySkyViewCamera();
}

function exitSkyView(): void {
  if (!skyViewActive) {
    return;
  }

  // PORT-LATER: persist the gaze (az/alt) to localStorage.

  skyViewActive = false;
  cancelSkyFlight();
  // PORT-LATER: cancelSkyAim(); skyTrackingEnabled = false;

  // The orbit gets its near plane back.
  if (skyViewSavedMinZ !== null) {
    camera.minZ = skyViewSavedMinZ;
    skyViewSavedMinZ = null;
  }

  // PORT-LATER: refreshGroundCityLabels(true); applyHomeMarkerViewMode();
  // disposeSkyAnchorMarker(); disposeSkyCardinalMarkers();
  // disposeSkyRulers();

  // Remember the ground zoom; give the orbit its own zoom back.
  skyViewOwnFov = controller.angleViewCamera;

  if (skyViewSavedOrbitFov !== null) {
    controller.angleViewCamera = skyViewSavedOrbitFov;
    skyViewSavedOrbitFov = null;
  }

  // The orbit returns ABOVE the point you traveled to.
  if (skyViewLatLonDeg) {
    const { w, h } = canvasSize();
    controller.setCentralPosition(
      skyViewLatLonDeg.latDeg,
      skyViewLatLonDeg.lonDeg,
      w,
      h
    );
  }

  // Back to orbit: the up vector must return to the world's before the
  // orbit math runs, or the globe comes back tilted. The render loop
  // re-applies the orbit camera on the next frame.
  camera.upVector = new Vector3(0, 1, 0);
}

function toggleSkyView(): void {
  if (skyViewActive) {
    exitSkyView();
  } else {
    enterSkyView();

    if (skyViewAltitudeRad < (10 * Math.PI) / 180) {
      skyViewAltitudeRad = (18 * Math.PI) / 180;
      applySkyViewCamera();
    }
  }
}

/** Fly to the viewer's own place — on the ground the observer glides
 *  there, in orbit the camera swings above it. */
function flyHome(): void {
  if (!homeLatLon) {
    return; // No known home yet — the tooltip explains what this is.
  }

  if (skyViewActive && skyViewLatLonDeg) {
    animateGreatCircle(
      skyViewLatLonDeg,
      homeLatLon,
      (latDeg, lonDeg, dir) => {
        skyViewLatLonDeg = { latDeg, lonDeg };
        skyViewSurfacePoint = dir.scale(
          RENDER_EARTH_RADIUS * skyObserverRadiusFactor()
        );
        applySkyViewCamera();
      }
    );
    return;
  }

  const { w, h } = canvasSize();

  animateGreatCircle(
    controller.getCurrentLatLonDeg(),
    homeLatLon,
    (latDeg, lonDeg) => {
      controller.setCentralPosition(latDeg, lonDeg, w, h);
    }
  );
}

/** Wheel over the lat/lon chips: travel the standing point (ground) or
 *  steer the camera along the meridian/parallel (orbit). */
function nudgeLatLon(dLat: number, dLon: number): void {
  cancelSkyFlight();

  if (skyViewActive && skyViewLatLonDeg) {
    const latDeg = Math.min(89, Math.max(-89, skyViewLatLonDeg.latDeg + dLat));
    const lonDeg = normalizeLonDeg(skyViewLatLonDeg.lonDeg + dLon);

    skyViewLatLonDeg = { latDeg, lonDeg };

    const n = controller.latLonNormal(latDeg, lonDeg);
    skyViewSurfacePoint = new Vector3(n.x, n.y, n.z).scale(
      RENDER_EARTH_RADIUS * skyObserverRadiusFactor()
    );
    applySkyViewCamera();
    return;
  }

  const { w, h } = canvasSize();
  const current = controller.getCurrentLatLonDeg();

  controller.setCentralPosition(
    Math.min(89, Math.max(-89, current.latDeg + dLat)),
    normalizeLonDeg(current.lonDeg + dLon),
    w,
    h
  );
}

function skyViewLatLabel(): string {
  const latDeg =
    skyViewActive && skyViewLatLonDeg
      ? skyViewLatLonDeg.latDeg
      : controller.getCurrentLatLonDeg().latDeg;
  return `${Math.round(Math.abs(latDeg))}°${latDeg >= 0 ? 'N' : 'S'}`;
}

function skyViewLonLabel(): string {
  const lonDeg =
    skyViewActive && skyViewLatLonDeg
      ? skyViewLatLonDeg.lonDeg
      : controller.getCurrentLatLonDeg().lonDeg;
  return `${Math.round(Math.abs(lonDeg))}°${lonDeg >= 0 ? 'E' : 'W'}`;
}

// ---- The sky dock / menu (verbatim structure from .Me) ------------
// mode (surface) · sky content (constellations, cities) · position
// (home, lat, lon). Long-press any button to dim the whole group to a
// ghost; long-press again to wake it. "My Worlds" (Group 5) and the
// ground-only tools (rulers, tracking, walk) are intentionally NOT
// included; the surface button's action is PORT-LATER (needs sky view).

let skyButtonsGhost = false;
let skyLongPressTimer: number | null = null;
let skyLongPressFired = false;
const SKY_LONG_PRESS_MS = 600;

function clearSkyLongPressTimer(): void {
  if (skyLongPressTimer !== null) {
    window.clearTimeout(skyLongPressTimer);
    skyLongPressTimer = null;
  }
}

function onSkyButtonPointerDown(): void {
  clearSkyLongPressTimer();
  skyLongPressFired = false;
  skyLongPressTimer = window.setTimeout(() => {
    skyLongPressTimer = null;
    skyLongPressFired = true;
    skyButtonsGhost = !skyButtonsGhost;
    updateDock();
  }, SKY_LONG_PRESS_MS);
}

function onSkyButtonPointerEnd(): void {
  clearSkyLongPressTimer();
}

/** A click that concluded a long-press, or a dormant ghost, does not
 *  act (mirrors the .Me guards on every dock handler). */
function skyActionBlocked(): boolean {
  if (skyLongPressFired) {
    skyLongPressFired = false;
    return true;
  }

  return skyButtonsGhost;
}

function wireDockPress(el: HTMLElement): void {
  el.addEventListener('pointerdown', onSkyButtonPointerDown);
  el.addEventListener('pointerup', onSkyButtonPointerEnd);
  el.addEventListener('pointerleave', onSkyButtonPointerEnd);
  el.addEventListener('pointercancel', onSkyButtonPointerEnd);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

const skyDock = document.createElement('div');
skyDock.className = 'ap-sky-dock';

// GROUP 1 · MODE — stand on the ground (surface). PORT-LATER action.
// The icon always shows the DESTINATION: on the ground → go to ORBIT;
// in orbit → stand on the GROUND.
const SURFACE_ICON_GROUND =
  `<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">` +
  `<path d="M4 27 Q16 21 28 27" /><circle cx="16" cy="12.5" r="2.4" />` +
  `<path d="M16 15.5 V20.5" /><path d="M12.5 17.5 L16 16.2 L19.5 17.5" />` +
  `<path d="M16 20.5 L13.8 24 M16 20.5 L18.2 24" />` +
  `<circle cx="8.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />` +
  `<circle cx="24" cy="5.5" r="1.4" fill="currentColor" stroke="none" /></svg>`;
const SURFACE_ICON_ORBIT =
  `<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">` +
  `<circle cx="16" cy="16" r="6.5" />` +
  `<ellipse cx="16" cy="16" rx="13" ry="4.6" transform="rotate(-28 16 16)" />` +
  `<circle cx="25" cy="9.5" r="1.7" fill="currentColor" stroke="none" /></svg>`;

let surfaceIconIsOrbit = false;

const surfaceBtn = document.createElement('button');
surfaceBtn.type = 'button';
surfaceBtn.className = 'ap-constellation-button ap-sky-main-button';
surfaceBtn.setAttribute(
  'data-tip',
  'View mode · stand on the GROUND: look at the sky from the point under the camera. Drag pans the sky, wheel zooms; tap again to rise back to orbit'
);
surfaceBtn.innerHTML = SURFACE_ICON_GROUND;
surfaceBtn.addEventListener('click', () => {
  if (skyActionBlocked()) {
    return;
  }
  toggleSkyView();
  updateDock();
});
wireDockPress(surfaceBtn);

// GROUP 2 · SKY CONTENT — constellations (analog of the C key).
const constellationBtn = document.createElement('button');
constellationBtn.type = 'button';
constellationBtn.className = 'ap-constellation-button ap-sky-group-gap';
constellationBtn.setAttribute(
  'data-tip',
  'Sky content · constellations: tap to cycle hidden → figures → full (or press C)'
);
constellationBtn.innerHTML =
  `<svg viewBox="0 0 32 32" aria-hidden="true">` +
  `<path class="ap-constellation-icon-lines" d="M5 23 L11 11 L19 15 L27 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />` +
  `<circle cx="5" cy="23" r="2.1" fill="currentColor" />` +
  `<circle cx="11" cy="11" r="2.4" fill="currentColor" />` +
  `<circle cx="19" cy="15" r="1.8" fill="currentColor" />` +
  `<circle cx="27" cy="7" r="2.4" fill="currentColor" /></svg>`;
constellationBtn.addEventListener('click', () => {
  if (skyActionBlocked()) {
    return;
  }
  cycleConstellationLines();
  updateDock();
});
wireDockPress(constellationBtn);

// SKY CONTENT — city names (works in orbit).
const cityBtn = document.createElement('button');
cityBtn.type = 'button';
cityBtn.className = 'ap-constellation-button';
cityBtn.setAttribute(
  'data-tip',
  'Earth content · show/hide major city names — a quiet overlay for orientation'
);
cityBtn.innerHTML =
  `<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M5 27 V14 H12 V27" /><path d="M12 27 V7 H20 V27" />` +
  `<path d="M20 27 V17 H27 V27" /><path d="M3 27 H29" /></svg>`;
cityBtn.addEventListener('click', () => {
  if (skyActionBlocked()) {
    return;
  }
  toggleCityLabels();
  updateDock();
});
wireDockPress(cityBtn);

// GROUP 4 · POSITION — fly home + the lat/lon steering chips.
const homeBtn = document.createElement('button');
homeBtn.type = 'button';
homeBtn.className = 'ap-constellation-button ap-sky-group-gap ap-sky-home-btn';
homeBtn.setAttribute(
  'data-tip',
  'Position · fly home: swing the camera to the point above your own place'
);
homeBtn.innerHTML =
  `<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M5 15 L16 5 L27 15" /><path d="M9 14 V26 H23 V14" />` +
  `<path d="M14 26 V19 H18 V26" /></svg>`;
homeBtn.addEventListener('click', () => {
  if (skyActionBlocked()) {
    return;
  }
  flyHome();
});
wireDockPress(homeBtn);

const positionGroup = document.createElement('div');
positionGroup.className = 'ap-sky-dock-position';

const latChip = document.createElement('span');
latChip.className = 'ap-sky-coord';
latChip.setAttribute(
  'data-tip',
  'Position · latitude under the camera — hover and SCROLL to steer north/south'
);
const lonChip = document.createElement('span');
lonChip.className = 'ap-sky-coord';
lonChip.setAttribute(
  'data-tip',
  'Position · longitude under the camera — hover and SCROLL to steer east/west'
);

const onCoordWheel = (e: WheelEvent, axis: 'lat' | 'lon'): void => {
  e.preventDefault();
  e.stopPropagation();

  if (skyButtonsGhost) {
    return;
  }

  const stepValue = e.deltaY > 0 ? -1 : 1;
  nudgeLatLon(axis === 'lat' ? stepValue : 0, axis === 'lon' ? stepValue : 0);
};

latChip.addEventListener('wheel', (e) => onCoordWheel(e, 'lat'), {
  passive: false
});
lonChip.addEventListener('wheel', (e) => onCoordWheel(e, 'lon'), {
  passive: false
});
wireDockPress(latChip);
wireDockPress(lonChip);

positionGroup.appendChild(latChip);
positionGroup.appendChild(lonChip);

skyDock.appendChild(surfaceBtn);
skyDock.appendChild(constellationBtn);
skyDock.appendChild(cityBtn);
skyDock.appendChild(homeBtn);
skyDock.appendChild(positionGroup);
document.body.appendChild(skyDock);

/** Reflect state into the dock: ghost, constellation mode, city on,
 *  coordinate labels, the traveling glow. Cheap; called each frame. */
function updateDock(): void {
  skyDock.classList.toggle('ap-sky-dock-ghost', skyButtonsGhost);

  const surfaceOn = isSkyViewActive();
  surfaceBtn.classList.toggle('ap-sky-view-on', surfaceOn);
  // Swap the icon ONLY when the mode changes — comparing innerHTML each
  // frame fails (the browser normalizes SVG markup) and re-setting it
  // 60×/s tore the SVG out from under the pointer, killing the click.
  if (surfaceOn !== surfaceIconIsOrbit) {
    surfaceIconIsOrbit = surfaceOn;
    surfaceBtn.innerHTML = surfaceOn ? SURFACE_ICON_ORBIT : SURFACE_ICON_GROUND;
  }

  constellationBtn.classList.toggle(
    'ap-constellation-mode-1',
    getConstellationLineMode() === 1
  );
  constellationBtn.classList.toggle(
    'ap-constellation-mode-2',
    getConstellationLineMode() === 2
  );

  cityBtn.classList.toggle('ap-sky-view-on', isCityLabelsEnabled());

  const latText = skyViewLatLabel();
  const lonText = skyViewLonLabel();
  if (latChip.textContent !== latText) {
    latChip.textContent = latText;
  }
  if (lonChip.textContent !== lonText) {
    lonChip.textContent = lonText;
  }

  const traveling = isSkyFlightActive();
  latChip.classList.toggle('ap-sky-coord-traveling', traveling);
  lonChip.classList.toggle('ap-sky-coord-traveling', traveling);
}

updateDock();

// ---- Render loop: camera follows the controller each frame --------

engine.runRenderLoop(() => {
  // Sky rotation FIRST — the camera (and future tracking) aim at this
  // frame's rotation.
  updateSkyRotation();

  if (skyViewActive) {
    // Standing on the ground: camera on the surface looking at the sky.
    applySkyViewCamera();
  } else {
    // Orbit: the camera follows the controller.
    camera.setPosition(
      new Vector3(
        controller.xCurrent * renderScale,
        controller.yCurrent * renderScale,
        controller.zCurrent * renderScale
      )
    );
    camera.setTarget(Vector3.Zero());
    camera.fov = controller.angleViewCamera;

    updateGlobeDetailGate();
    updateSolarBodyScales();
    updateOrbitCrosshair();
  }

  updateEarthquakeMarkerScale();
  updateDock();
  scene.render();
});
