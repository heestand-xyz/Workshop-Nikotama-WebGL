import common from "./Common";
import * as THREE from "three";
import { resolution1, planeConfigs1 } from "./planeConfigs1";
import { resolution2, planeConfigs2 } from "./planeConfigs2";
import { resolution3, planeConfigs3 } from "./planeConfigs3";
import type { PlaneConfigType } from "./planeConfigType";
import { createPanelGeometries } from "./panelMapping";

import controls from "./Controls";
import { gradientColors, gradientPositions } from "./colorGradient";

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

		controls.init();

		this.init();
		this.loop()
	}

	private init(){
		common.init({
			wrapper: this.props.wrapper,
			canvas: this.props.canvas,
			width: this.debugProjection ? 768 : planeConfigs[this.cubeType].resolution.x,
			height: this.debugProjection ? 768 : planeConfigs[this.cubeType].resolution.y
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
		this.sourceCube.geometry.dispose();
		this.sourceMaterial.dispose();
		this.sourceScene.clear();

		controls.dispose();
		common.dispose();
	}

	private update() {
		const renderer = common.renderer;
		if (!renderer) return;

		const delta = this.clock.getDelta();
		this.time += delta;
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
