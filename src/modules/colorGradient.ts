import * as THREE from 'three';

// Stops run from low to high luminance. Accepts #RGB / #RRGGBB,
// with or without the leading #. Edit this array to change the palette.
export const gradientHexColors = [
	'#C9D0FC',
	'#ECDBEA',
	'#BBDF87',
	'#94BC73',
	'#C3A4B6',
	'#A99EC7',
	'#A99EC7', // Hold the final color from 94% to 100%.
];

export const gradientPositions = [0, 0.31, 0.51, 0.75, 0.88, 0.94, 1];

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

if (gradientHexColors.length < 2) {
	throw new Error('The color gradient needs at least two stops.');
}

if (gradientPositions.length !== gradientHexColors.length ||
	gradientPositions[0] !== 0 || gradientPositions[gradientPositions.length - 1] !== 1 ||
	gradientPositions.some((position, i) => !Number.isFinite(position) ||
		position < 0 || position > 1 || (i > 0 && position <= gradientPositions[i - 1]))) {
	throw new Error('Gradient positions must match the colors and increase from 0 to 1.');
}

export const gradientColors = gradientHexColors.map(decodeHexColor);
