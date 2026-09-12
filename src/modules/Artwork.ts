import common from "./Common";
import * as THREE from "three";
import { resolution1, planeConfigs1 } from "./planeConfigs1";
import { resolution2, planeConfigs2 } from "./planeConfigs2";
import { resolution3, planeConfigs3 } from "./planeConfigs3";
import type { PlaneConfigType } from "./planeConfigType";
import { createPanelGeometries } from "./panelMapping";
import { keyColors } from "./keyColors";

import controls from "./Controls";
import {
	gradientColors,
	gradientPositions,
	fallbackGradientColors,
	resampleGradient,
	evenGradientPositions,
	luminance,
} from "./colorGradient";

import cubeVert from './glsl/cube.vert'
import cubeFrag from './glsl/cube.frag'
import distortionVert from './glsl/distortion.vert'
import distortionFrag from './glsl/distortion.frag'
import projectionVert from './glsl/projection.vert'
import projectionFrag from './glsl/projection.frag'

type PlaneConfigSet = {
	resolution: THREE.Vector2
	planeConfigs: PlaneConfigType[]
}

const planeConfigs = {
	type1: {
		resolution: resolution1,
		planeConfigs: planeConfigs1
	},
	type2: {
		resolution: resolution2,
		planeConfigs: planeConfigs2
	},
	type3: {
		resolution: resolution3,
		planeConfigs: planeConfigs3
	}
} satisfies Record<string, PlaneConfigSet>

type CubeType = keyof typeof planeConfigs

// 国土交通省 川の防災情報 live cameras along the Tama River, one per cube.
// Served with Access-Control-Allow-Origin: *, but 403s any client that does
// not send a browser User-Agent.
const cameraUrls = {
	// 多摩川二子玉川ライズタワーオフィス屋上
	type1: 'https://cam.river.go.jp/cam/now/cctv_130001_31C03994.jpg',
	// 多摩川二子橋
	type2: 'https://cam.river.go.jp/cam/now/cctv_130001_31C03407.jpg',
	// 多摩川田園調布出張所
	type3: 'https://cam.river.go.jp/cam/now/cctv_130001_31C03351.jpg',
} satisfies Record<CubeType, string>

// The cameras publish a new frame about once a minute.
const cameraRefreshMs = 60_000

// A new frame swaps the whole palette, so ease into it instead of cutting.
const gradientFadeSeconds = 1

// debugImage preview: the 480x270 frame at 2x, with a row of key colours under it.
const imagePreview = {
	width: 960,
	height: 540,
	swatchCount: 5,
	swatchRowHeight: 120,
	swatchRadius: 32,
}

interface ArtworkProps {
	wrapper: HTMLElement;
	canvas: HTMLCanvasElement;
}

function isCubeType(value: string | null): value is CubeType {
	return value !== null && value in planeConfigs
}

// BoxGeometry group 2 is the +Y face: the top viewing opening.
function createOpenCubeGeometry() {
	const geometry = new THREE.BoxGeometry(1, 1, 1);
	const index = geometry.getIndex()!;
	const indices: number[] = [];
	for (const group of geometry.groups) {
		if (group.materialIndex === 2) continue;
		for (let i = group.start; i < group.start + group.count; i++) {
			indices.push(index.getX(i));
		}
	}
	geometry.setIndex(indices);
	geometry.clearGroups();
	return geometry;
}

export default class Artwork{
	private readonly clock = new THREE.Clock()
	private readonly uniforms = {
		uTime: { value: 0 },
	}
	private animationFrame?: number
	private isDisposed = false
	private time = 0
	private lightAngle = 0
	private cubeType: CubeType = 'type2'
	private isDebug = true
	private debugProjection = false
	private lilGUI = false
	private debugImage = false
	private imageScene = new THREE.Scene();
	private imageQuad?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
	private imageSwatches: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>[] = [];
	private imageTexture?: THREE.Texture;
	private cameraImage?: HTMLImageElement;
	private cameraTimer?: ReturnType<typeof setInterval>;
	// Arrays the uniforms point at, mutated in place as the fade runs.
	private gradientCurrent?: { colors: THREE.Color[]; positions: number[] };
	private gradientFrom?: { colors: THREE.Color[]; positions: number[] };
	private gradientTo?: { colors: THREE.Color[]; positions: number[] };
	private gradientFade = 1;

	private sourceScene = new THREE.Scene();
	// Constant intensity with no distance-based falloff.
	private pointLight = new THREE.PointLight(0xffffff, 1, 0, 0);

	private sourceMaterial = new THREE.MeshStandardMaterial({
		color: 0xffffff,
		roughness: 1,
		side: THREE.DoubleSide,
		metalness: 0,
		toneMapped: false,
	});

	private sourceCube = new THREE.Mesh(
		createOpenCubeGeometry(),
		this.sourceMaterial,
	);

	// At y = 1, a 90° square view fits the unit opening at y = 0.5.
	private captureCamera = new THREE.PerspectiveCamera(90, 1, 0.01, 10);
	private sourceTarget?: THREE.WebGLRenderTarget;
	private distortionTarget?: THREE.WebGLRenderTarget;
	private blurIntermediate?: THREE.WebGLRenderTarget;
	private distortionScene = new THREE.Scene();
	private projectionPreviewScene = new THREE.Scene();
	private projectionPreview?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
	private distortionCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	private distortionQuad?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
	private projectionScene = new THREE.Scene();
	private projectionCube?: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
	private projectorMatrix = new THREE.Matrix4();
	private colorUniforms = {
		uGradient: { value: gradientColors },
		uGradientPositions: { value: gradientPositions },
		uExposure: { value: 0 },
		uSaturation: { value: 1 },
		uGamma: { value: 1 },
	};

	private captures: {
		rotation: THREE.Euler;
		camera: THREE.PerspectiveCamera;
		target: THREE.WebGLRenderTarget;
		material: THREE.ShaderMaterial;
	}[] = [];

	constructor(private readonly props: ArtworkProps){
		const urlParams = new URLSearchParams(window.location.search);
		const cubeTypeParam = urlParams.get('cubeType');
		if (isCubeType(cubeTypeParam)) {
			this.cubeType = cubeTypeParam;
		}

		const debugParam = urlParams.get('debug');
		if (debugParam !== null) {
			this.isDebug = debugParam === 'true' || debugParam === '1';
		}
		const projectionParam = urlParams.get('debugProjection');
		this.debugProjection = projectionParam === 'true' || projectionParam === '1';
		const lilGUIParam = urlParams.get('lilGUI');
		this.lilGUI = lilGUIParam === 'true' || lilGUIParam === '1';
		const imageParam = urlParams.get('debugImage');
		this.debugImage = imageParam === 'true' || imageParam === '1';

		if (this.lilGUI) controls.init(() => this.applyKeyColors());

		this.init();
		this.loop()
	}

	private init(){
		const size = this.debugImage
			? { x: imagePreview.width, y: imagePreview.height + imagePreview.swatchRowHeight }
			: this.debugProjection
				? { x: 768, y: 768 }
				: planeConfigs[this.cubeType].resolution;

		common.init({
			wrapper: this.props.wrapper,
			canvas: this.props.canvas,
			width: size.x,
			height: size.y
		});

		const renderer = common.renderer;
		if (!renderer) return;

		if (!renderer.capabilities.isWebGL2) {
			throw new Error("This capture setup requires WebGL 2.");
		}

		const supportsFloat = renderer.extensions.has("EXT_color_buffer_float");
		const supportsHalfFloat = supportsFloat ||
			renderer.extensions.has("EXT_color_buffer_half_float");
		if (!supportsHalfFloat) {
			throw new Error("Floating-point capture is unavailable.");
		}

		// Prefer 32-bit with linear filtering; never fall back to 8-bit.
		const use32Bit = supportsFloat &&
			renderer.extensions.has("OES_texture_float_linear");
		const captureType = use32Bit ? THREE.FloatType : THREE.HalfFloatType;
		console.info(`Capture precision: ${use32Bit ? 32 : 16} bits per channel`);

		renderer.outputEncoding = THREE.sRGBEncoding;
		renderer.toneMapping = THREE.NoToneMapping;

		if (this.debugImage) {
			// Rendered in pixel space by common.camera, so the swatch row sits
			// under the frame rather than over it.
			this.imageQuad = new THREE.Mesh(
				new THREE.PlaneGeometry(imagePreview.width, imagePreview.height),
				// Black until the frame arrives, rather than a white flash.
				new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }),
			);
			this.imageQuad.position.y = imagePreview.swatchRowHeight / 2;
			this.imageScene.add(this.imageQuad);

			const spacing = imagePreview.width / imagePreview.swatchCount;
			for (let i = 0; i < imagePreview.swatchCount; i++) {
				const swatch = new THREE.Mesh(
					new THREE.CircleGeometry(imagePreview.swatchRadius, 64),
					new THREE.MeshBasicMaterial({ toneMapped: false }),
				);
				swatch.position.set(
					-imagePreview.width / 2 + spacing * (i + 0.5),
					-imagePreview.height / 2,
					0,
				);
				// Shown only once a colour has been found for it.
				swatch.visible = false;
				this.imageSwatches.push(swatch);
				this.imageScene.add(swatch);
			}

		}

		// The frame drives the gradient in every mode, not just the preview.
		this.loadCameraFrame();
		this.cameraTimer = setInterval(() => this.loadCameraFrame(), cameraRefreshMs);

		// The +Y opening lets one camera see the interior faces from above.
		this.sourceScene.add(this.sourceCube);
		this.sourceScene.add(this.pointLight);

		const makeTarget = (size: number, depthBuffer = true) => {
			const target = new THREE.WebGLRenderTarget(size, size, {
				type: captureType,
				format: THREE.RGBAFormat,
				minFilter: THREE.LinearFilter,
				magFilter: THREE.LinearFilter,
				generateMipmaps: false,
				depthBuffer,
				stencilBuffer: false,
			});
			target.texture.encoding = THREE.LinearEncoding;
			return target;
		};

		this.sourceTarget = makeTarget(2048);
		// Filter the source before large blurs sample it at reduced resolution.
		this.sourceTarget.texture.generateMipmaps = true;
		this.sourceTarget.texture.minFilter = THREE.LinearMipmapLinearFilter;
		this.distortionTarget = makeTarget(2048, false);
		this.blurIntermediate = makeTarget(2048, false);
		this.sourceScene.background = new THREE.Color(0x000000);
		this.projectionScene.background = new THREE.Color(0x000000);
		this.captureCamera.position.set(0, 1, 0);
		this.captureCamera.up.set(0, 0, -1);
		this.captureCamera.lookAt(0, 0, 0);
		this.captureCamera.updateMatrixWorld(true);
		this.projectorMatrix.multiplyMatrices(
			this.captureCamera.projectionMatrix,
			this.captureCamera.matrixWorldInverse,
		);

		this.distortionQuad = new THREE.Mesh(
			new THREE.PlaneGeometry(2, 2),
			new THREE.ShaderMaterial({
				vertexShader: distortionVert,
				fragmentShader: distortionFrag,
				uniforms: {
					uCapture: { value: this.sourceTarget.texture },
					uBlurRadius: { value: controls.params.blurRadius },
					uDirection: { value: new THREE.Vector2(1 / this.sourceTarget.width, 0) },
				},
				depthTest: false,
				depthWrite: false,
				toneMapped: false,
			}),
		);
		this.distortionScene.add(this.distortionQuad);

		this.projectionPreview = new THREE.Mesh(
			new THREE.PlaneGeometry(2, 2),
			new THREE.ShaderMaterial({
				vertexShader: distortionVert,
				fragmentShader: cubeFrag,
				defines: { GRADIENT_SIZE: gradientColors.length },
				uniforms: {
					uCapture: { value: this.distortionTarget.texture },
					...this.colorUniforms,
				},
				depthTest: false,
				depthWrite: false,
				toneMapped: false,
			}),
		);
		this.projectionPreviewScene.add(this.projectionPreview);

		// This material only reprojects colors; it adds no second lighting pass.
		this.projectionCube = new THREE.Mesh(
			this.sourceCube.geometry.clone(),
			new THREE.ShaderMaterial({
				vertexShader: projectionVert,
				fragmentShader: projectionFrag,
				uniforms: {
					uProjection: { value: this.distortionTarget.texture },
					uProjectorMatrix: { value: this.projectorMatrix },
				},
				side: THREE.DoubleSide,
				toneMapped: false,
			}),
		);
		this.projectionScene.add(this.projectionCube);

		const rotations = [
			new THREE.Euler(0, 0, 0), // +Z
			new THREE.Euler(0, Math.PI / 2, 0), // +X
			new THREE.Euler(0, Math.PI, 0), // -Z
			new THREE.Euler(0, -Math.PI / 2, 0), // -X
			new THREE.Euler(Math.PI / 2, 0, 0), // -Y
		];

		this.captures = rotations.map((rotation) => {
			const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 10);
			camera.position.set(0, 0, 1).applyEuler(rotation);
			camera.up.set(0, 1, 0).applyEuler(rotation);
			camera.lookAt(0, 0, 0);

			const target = makeTarget(1024);

			const material = new THREE.ShaderMaterial({
				vertexShader: cubeVert,
				fragmentShader: cubeFrag,
				defines: { GRADIENT_SIZE: gradientColors.length },
				uniforms: {
					uCapture: { value: target.texture },
					...this.colorUniforms,
				},
				side: THREE.DoubleSide,
				toneMapped: false,
			});

			return { rotation, camera, target, material };
		});

		planeConfigs[this.cubeType].planeConfigs.forEach((config) => {
			const capture = this.captures.find(({ rotation }) =>
				Math.abs(rotation.x - config.rotation.x) < 0.0001 &&
				Math.abs(rotation.y - config.rotation.y) < 0.0001
			);
			if (!capture) {
				throw new Error("No capture matches this panel");
			}

			const geometries = createPanelGeometries(config, this.isDebug, this.cubeType === 'type1');
			for (const geometry of geometries) {
				common.scene.add(new THREE.Mesh(geometry, capture.material));
			}
		});
	}


	dispose() {
		this.isDisposed = true;

		if (this.cameraTimer !== undefined) {
			clearInterval(this.cameraTimer);
			this.cameraTimer = undefined;
		}

		if (this.animationFrame !== undefined) {
			cancelAnimationFrame(this.animationFrame);
		}

		common.scene.traverse((object) => {
			if (object instanceof THREE.Mesh) {
				object.geometry.dispose();
			}
		});

		common.scene.clear();

		for (const capture of this.captures) {
			capture.target.dispose();
			capture.material.dispose();
		}

		this.captures = [];

		this.sourceTarget?.dispose();
		this.distortionTarget?.dispose();
		this.blurIntermediate?.dispose();
		this.distortionQuad?.geometry.dispose();
		this.distortionQuad?.material.dispose();
		this.distortionScene.clear();
		this.projectionPreview?.geometry.dispose();
		this.projectionPreview?.material.dispose();
		this.projectionPreviewScene.clear();
		this.projectionCube?.geometry.dispose();
		this.projectionCube?.material.dispose();
		this.projectionScene.clear();
		this.imageQuad?.geometry.dispose();
		this.imageQuad?.material.dispose();
		for (const swatch of this.imageSwatches) {
			swatch.geometry.dispose();
			swatch.material.dispose();
		}
		this.imageSwatches = [];
		this.imageTexture?.dispose();
		this.cameraImage = undefined;
		this.imageScene.clear();
		this.sourceCube.geometry.dispose();
		this.sourceMaterial.dispose();
		this.sourceScene.clear();

		controls.dispose();
		common.dispose();
	}

	private loadCameraFrame() {
		if (this.isDisposed) return;

		const url = cameraUrls[this.cubeType];
		const loader = new THREE.TextureLoader();
		loader.setCrossOrigin('anonymous');
		// Cache-bust so each refresh fetches the current frame, not the stored one.
		loader.load(`${url}?t=${Date.now()}`, (texture) => {
			if (this.isDisposed) {
				texture.dispose();
				return;
			}

			texture.encoding = THREE.sRGBEncoding;
			const previous = this.imageTexture;
			this.imageTexture = texture;
			this.cameraImage = texture.image as HTMLImageElement;

			if (this.imageQuad) {
				this.imageQuad.material.map = texture;
				this.imageQuad.material.color.setHex(0xffffff);
				this.imageQuad.material.needsUpdate = true;
			}

			// Only once nothing points at it any more.
			previous?.dispose();

			this.applyKeyColors();
		}, undefined, () => {
			console.error(`Camera image failed to load: ${url}`);
			// Keep whatever the last good frame gave us; only fall back if the
			// very first fetch never landed.
			if (!this.cameraImage) this.setGradient(fallbackGradientColors);
		});
	}

	// Re-reads the frame with the current thresholds, then repaints the swatch
	// row and the gradient the artwork samples.
	private applyKeyColors() {
		if (!this.cameraImage) return;

		const sampled = keyColors(this.cameraImage, imagePreview.swatchCount, {
			minSaturation: controls.params.minSaturation,
			minBrightness: controls.params.minBrightness,
			resolution: 50,
		});

		// The frames are sRGB, and so are the values sampled from them.
		const colors = sampled
			.map((color) => new THREE.Color()
				.setRGB(color.r, color.g, color.b)
				.convertSRGBToLinear())
			.sort((a, b) => luminance(a) - luminance(b));

		console.info(`Key colours found: ${colors.length}/${imagePreview.swatchCount}`);

		this.imageSwatches.forEach((swatch, i) => {
			const color = colors[i];
			swatch.visible = color !== undefined;
			if (color) swatch.material.color.copy(color);
		});

		// Two stops are the minimum a gradient can interpolate between.
		this.setGradient(colors.length < 2 ? fallbackGradientColors : colors);
	}

	private setGradient(colors: THREE.Color[]) {
		// GRADIENT_SIZE is compiled into the shader, so any palette has to be
		// redistributed over exactly that many stops.
		const count = gradientColors.length;
		const target = {
			colors: resampleGradient(colors, count),
			positions: evenGradientPositions(count),
		};

		// Take ownership of the uniform arrays on the first change, so the
		// fade never writes into the imported palette.
		if (!this.gradientCurrent) {
			this.gradientCurrent = {
				colors: gradientColors.map((color) => color.clone()),
				positions: [...gradientPositions],
			};
			this.colorUniforms.uGradient.value = this.gradientCurrent.colors;
			this.colorUniforms.uGradientPositions.value = this.gradientCurrent.positions;
		}

		this.gradientFrom = {
			colors: this.gradientCurrent.colors.map((color) => color.clone()),
			positions: [...this.gradientCurrent.positions],
		};
		this.gradientTo = target;
		this.gradientFade = 0;
	}

	private advanceGradientFade(delta: number) {
		const current = this.gradientCurrent;
		const from = this.gradientFrom;
		const to = this.gradientTo;
		if (!current || !from || !to || this.gradientFade >= 1) return;

		this.gradientFade = Math.min(1, this.gradientFade + delta / gradientFadeSeconds);

		// Array uniforms re-upload every frame, so mutating in place is enough.
		for (let i = 0; i < current.colors.length; i++) {
			current.colors[i].lerpColors(from.colors[i], to.colors[i], this.gradientFade);
			current.positions[i] = THREE.MathUtils.lerp(
				from.positions[i],
				to.positions[i],
				this.gradientFade,
			);
		}
	}

	private update() {
		const renderer = common.renderer;
		if (!renderer) return;

		if (this.debugImage) {
			renderer.setRenderTarget(null);
			renderer.render(this.imageScene, common.camera);
			return;
		}

		const delta = this.clock.getDelta();
		this.time += delta;
		this.advanceGradientFade(delta);
		if (!controls.params.isTimePaused) {
			this.lightAngle += delta * controls.params.lightSpeed;
		}

		this.uniforms.uTime.value = controls.params.isTimePaused
			? controls.params.debugTime
			: this.time;

		const angle = controls.params.isTimePaused
			? controls.params.debugTime * controls.params.lightSpeed
			: this.lightAngle;
		this.pointLight.position.set(
			Math.cos(angle) * controls.params.lightRadius,
			controls.params.lightY,
			Math.sin(angle) * controls.params.lightRadius,
		);

		if (!this.sourceTarget || !this.distortionTarget || !this.blurIntermediate ||
			!this.distortionQuad || !this.projectionCube || !this.projectionPreview) return;
		this.colorUniforms.uExposure.value = controls.params.exposure;
		this.colorUniforms.uSaturation.value = controls.params.saturation;
		this.colorUniforms.uGamma.value = controls.params.gamma;

		renderer.setRenderTarget(this.sourceTarget);
		renderer.render(this.sourceScene, this.captureCamera);

		let processedTexture = this.sourceTarget.texture;
		if (controls.params.blurRadius > 0) {
			// Keep the kernel dense without increasing samples for large radii.
			// Radius remains measured in the original 2048px capture's pixels.
			const reduction = Math.pow(2, Math.floor(Math.log2(
				Math.max(1, controls.params.blurRadius / 16),
			)));
			const width = Math.max(1, Math.floor(this.sourceTarget.width / reduction));
			const height = Math.max(1, Math.floor(this.sourceTarget.height / reduction));
			if (this.blurIntermediate.width !== width || this.blurIntermediate.height !== height) {
				this.blurIntermediate.setSize(width, height);
				this.distortionTarget.setSize(width, height);
			}

			// Separable blur: horizontal, then vertical, in floating-point targets.
			const uniforms = this.distortionQuad.material.uniforms;
			uniforms.uBlurRadius.value = controls.params.blurRadius;
			uniforms.uCapture.value = this.sourceTarget.texture;
			uniforms.uDirection.value.set(1 / this.sourceTarget.width, 0);
			renderer.setRenderTarget(this.blurIntermediate);
			renderer.render(this.distortionScene, this.distortionCamera);

			uniforms.uCapture.value = this.blurIntermediate.texture;
			uniforms.uDirection.value.set(0, 1 / this.sourceTarget.height);
			renderer.setRenderTarget(this.distortionTarget);
			renderer.render(this.distortionScene, this.distortionCamera);
			processedTexture = this.distortionTarget.texture;
		}

		// Radius zero bypasses both passes and samples the original capture.
		this.projectionCube.material.uniforms.uProjection.value = processedTexture;
		this.projectionPreview.material.uniforms.uCapture.value = processedTexture;

		if (this.debugProjection) {
			renderer.setRenderTarget(null);
			renderer.render(this.projectionPreviewScene, this.distortionCamera);
			return;
		}

		for (const capture of this.captures) {
			renderer.setRenderTarget(capture.target);
			renderer.render(this.projectionScene, capture.camera);
		}

		// Draw the installation using the captured textures.
		renderer.setRenderTarget(null);

		const camera = this.isDebug
			? common.debugCamera
			: common.camera;

		renderer.render(common.scene, camera);
	}

	private loop = () => {
		if(!this.isDisposed){
			this.update();
			this.animationFrame = window.requestAnimationFrame(this.loop);
		}
	}
}
