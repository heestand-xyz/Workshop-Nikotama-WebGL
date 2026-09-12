uniform sampler2D uCapture;
uniform float uBlurRadius;
uniform vec2 uDirection;
varying vec2 vUv;

vec2 mirrorUv(vec2 uv) {
	// Reflect beyond either edge, including negative coordinates.
	return 1.0 - abs(mod(uv, 2.0) - 1.0);
}

void main() {
	if (uBlurRadius <= 0.0) {
		gl_FragColor = texture2D(uCapture, vUv);
		return;
	}

	// Gaussian kernel spanning +/- radius pixels along the current axis.
	vec4 color = vec4(0.0);
	float totalWeight = 0.0;
	for (int i = -16; i <= 16; i++) {
		float position = float(i) / 16.0;
		float weight = exp(-4.5 * position * position);
		vec2 sampleUv = mirrorUv(vUv + uDirection * position * uBlurRadius);
		color += texture2D(uCapture, sampleUv) * weight;
		totalWeight += weight;
	}
	gl_FragColor = color / totalWeight;
}
