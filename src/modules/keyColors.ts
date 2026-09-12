// Port of the AsyncGraphics `keyPixelColors` algorithm: farthest-point sampling
// in RGB over the saturated, bright pixels of a downscaled copy of an image.

export type RGB = { r: number; g: number; b: number }

// HSB saturation and brightness, matching PixelColor's definitions.
function saturation({ r, g, b }: RGB): number {
	const max = Math.max(r, g, b)
	if (max === 0) return 0
	return (max - Math.min(r, g, b)) / max
}

function brightness({ r, g, b }: RGB): number {
	return Math.max(r, g, b)
}

function distance(a: RGB, b: RGB): number {
	return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
}

export function keyColors(
	image: HTMLImageElement,
	maxCount: number,
	{
		minSaturation = 0.1,
		minBrightness = 0.1,
		resolution = 50,
	}: { minSaturation?: number; minBrightness?: number; resolution?: number } = {},
): RGB[] {
	if (maxCount <= 0) return []

	// Aspect fit inside the sample resolution, and only ever downscale.
	const scale = Math.min(
		resolution / image.naturalWidth,
		resolution / image.naturalHeight,
	)
	const width = scale < 1 ? Math.max(1, Math.round(image.naturalWidth * scale)) : image.naturalWidth
	const height = scale < 1 ? Math.max(1, Math.round(image.naturalHeight * scale)) : image.naturalHeight

	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	const context = canvas.getContext('2d', { willReadFrequently: true })
	if (!context) return []
	// The nearest available stand-in for the original's Lanczos resize.
	context.imageSmoothingEnabled = true
	context.imageSmoothingQuality = 'high'
	context.drawImage(image, 0, 0, width, height)

	// Reading back needs the image to be CORS-clean, which these cameras are.
	const { data } = context.getImageData(0, 0, width, height)

	const colors: RGB[] = []
	for (let i = 0; i < data.length; i += 4) {
		const color = { r: data[i] / 255, g: data[i + 1] / 255, b: data[i + 2] / 255 }
		if (saturation(color) > minSaturation && brightness(color) > minBrightness) {
			colors.push(color)
		}
	}
	if (colors.length <= maxCount) return colors

	// Seed with the most saturated pixel, then repeatedly take the pixel
	// farthest from everything already chosen.
	const keys: RGB[] = [
		colors.reduce((best, color) => (saturation(color) > saturation(best) ? color : best)),
	]

	while (keys.length < maxCount) {
		let maxDistance = 0
		let farthest: RGB | undefined
		for (const color of colors) {
			let minDistance = Infinity
			for (const key of keys) {
				minDistance = Math.min(minDistance, distance(color, key))
			}
			if (minDistance > maxDistance) {
				maxDistance = minDistance
				farthest = color
			}
		}
		// The Swift original spins forever here when every remaining pixel
		// duplicates one already chosen. Stop short instead.
		if (!farthest) break
		keys.push(farthest)
	}

	return keys
}
