import * as THREE from 'three';

export function decodeHexColor(hex: string): THREE.Color {
	let digits = hex.trim().replace(/^#/, '');
	if (!/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(digits)) {
		throw new Error(`Invalid gradient hex color: ${hex}`);
	}
	if (digits.length === 3) {
		digits = [...digits].map((digit) => digit + digit).join('');
	}
	const value = Number.parseInt(digits, 16);
	// Hex colors are sRGB; shader interpolation and processing use linear RGB.
	return new THREE.Color().setRGB(
		((value >> 16) & 255) / 255,
		((value >> 8) & 255) / 255,
		(value & 255) / 255,
	).convertSRGBToLinear();
}

// Shown until the first camera frame lands.
export const initialGradientColors = ['#000000', '#FFFFFF'].map(decodeHexColor);

// Used when the camera frame yields too few key colors to build a gradient.
export const fallbackGradientColors = ['#FF0000', '#00FF00', '#0000FF'].map(decodeHexColor);

// Relative luminance of a linear-RGB color.
export function luminance(color: THREE.Color): number {
	return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

// Redistribute a palette over `count` evenly spaced stops, so a gradient of any
// length can drive a shader whose GRADIENT_SIZE is fixed at compile time.
export function resampleGradient(colors: THREE.Color[], count: number): THREE.Color[] {
	if (colors.length === 0 || count < 1) return [];
	if (colors.length === 1) {
		return Array.from({ length: count }, () => colors[0].clone());
	}
	return Array.from({ length: count }, (_, i) => {
		const position = count === 1 ? 0 : (i / (count - 1)) * (colors.length - 1);
		const low = Math.min(Math.floor(position), colors.length - 2);
		return new THREE.Color().lerpColors(colors[low], colors[low + 1], position - low);
	});
}

export function evenGradientPositions(count: number): number[] {
	if (count === 1) return [0];
	return Array.from({ length: count }, (_, i) => i / (count - 1));
}
