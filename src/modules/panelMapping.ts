import * as THREE from 'three';
import type { PlaneConfigType } from './planeConfigType';

// Type 1's physical drawing: 2880mm modules separated by 260mm seams.
// Its 720px face packs two 360px modules without pixels for the seam.
export const type1PhysicalDimensions = {
	moduleMm: 2880,
	gapMm: 260,
};

type Interval = { start: number; end: number };

function splitAtSeam(scale: number, offset: number, includeGaps: boolean): Interval[] {
	const faceStart = (0 - 0.5 - offset) * scale + 0.5 + offset;
	const seam = (0.5 - faceStart) / scale;
	if (includeGaps && seam > 0 && seam < 1) {
		return [{ start: 0, end: seam }, { start: seam, end: 1 }];
	}
	return [{ start: 0, end: 1 }];
}

function faceCoordinate(value: number, scale: number, offset: number): number {
	return (value - 0.5 - offset) * scale + 0.5 + offset;
}

function physicalCoordinate(value: number, upperModule: boolean, includeGaps: boolean): number {
	if (!includeGaps) return value;
	const { moduleMm, gapMm } = type1PhysicalDimensions;
	return (value * moduleMm * 2 + (upperModule ? gapMm : 0)) /
		(moduleMm * 2 + gapMm);
}

export function createPanelGeometries(
	config: PlaneConfigType,
	isDebug: boolean,
	includeGaps: boolean,
): THREE.PlaneGeometry[] {
	const horizontal = splitAtSeam(config.scale.x, config.offsetPos.x, includeGaps);
	const vertical = splitAtSeam(config.scale.y, config.offsetPos.y, includeGaps);
	const geometries: THREE.PlaneGeometry[] = [];

	for (const x of horizontal) {
		for (const y of vertical) {
			// Each module has its own vertices so no triangle bridges a physical gap.
			const rightModule = faceCoordinate((x.start + x.end) / 2, config.scale.x, config.offsetPos.x) > 0.5;
			const upperModule = faceCoordinate((y.start + y.end) / 2, config.scale.y, config.offsetPos.y) > 0.5;
			const u0 = physicalCoordinate(faceCoordinate(x.start, config.scale.x, config.offsetPos.x), rightModule, includeGaps);
			const u1 = physicalCoordinate(faceCoordinate(x.end, config.scale.x, config.offsetPos.x), rightModule, includeGaps);
			const v0 = physicalCoordinate(faceCoordinate(y.start, config.scale.y, config.offsetPos.y), upperModule, includeGaps);
			const v1 = physicalCoordinate(faceCoordinate(y.end, config.scale.y, config.offsetPos.y), upperModule, includeGaps);

			const debugGeometry = new THREE.PlaneGeometry(u1 - u0, v1 - v0);
			debugGeometry.translate((u0 + u1) / 2 - 0.5, (v0 + v1) / 2 - 0.5, 0.5);
			debugGeometry.rotateX(config.rotation.x);
			debugGeometry.rotateY(config.rotation.y);
			const initialPosition = debugGeometry.attributes.position.clone();

			let geometry = debugGeometry;
			if (!isDebug) {
				// Keep the delivery atlas packed: gaps occupy physical space, not pixels.
				geometry = new THREE.PlaneGeometry(
					config.fboSize.x * (x.end - x.start),
					config.fboSize.y * (y.end - y.start),
				);
				geometry.translate(
					config.screenPosition.x + ((x.start + x.end) / 2 - 0.5) * config.fboSize.x,
					config.screenPosition.y + ((y.start + y.end) / 2 - 0.5) * config.fboSize.y,
					0,
				);
				debugGeometry.dispose();
			}

			geometry.setAttribute('initialPosition', initialPosition);
			const uv = geometry.attributes.uv;
			for (let i = 0; i < uv.count; i++) {
				uv.setXY(i, THREE.MathUtils.lerp(u0, u1, uv.getX(i)), THREE.MathUtils.lerp(v0, v1, uv.getY(i)));
			}
			uv.needsUpdate = true;
			geometries.push(geometry);
		}
	}
	return geometries;
}
