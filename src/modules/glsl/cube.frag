uniform sampler2D uCapture;
uniform float uExposure;
uniform float uSaturation;
uniform float uGamma;
uniform vec3 uGradient[GRADIENT_SIZE];
uniform float uGradientPositions[GRADIENT_SIZE];
varying vec2 vUv;

vec3 gradientColor(float luminance) {
	float position = clamp(luminance, 0.0, 1.0);
	for (int i = 0; i < GRADIENT_SIZE - 1; i++) {
		if (position <= uGradientPositions[i + 1]) {
			float blend = (position - uGradientPositions[i]) /
				(uGradientPositions[i + 1] - uGradientPositions[i]);
			return mix(uGradient[i], uGradient[i + 1], blend);
		}
	}
	return uGradient[GRADIENT_SIZE - 1];
}

void main() {
	vec3 captured = texture2D(uCapture, vUv).rgb * exp2(uExposure);
	float luminance = dot(captured, vec3(0.2126, 0.7152, 0.0722));
	vec3 color = gradientColor(luminance);
	float mappedLuminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
	color = mix(vec3(mappedLuminance), color, uSaturation);
	color = pow(max(color, vec3(0.0)), vec3(1.0 / uGamma));
	gl_FragColor = vec4(color, 1.0);
	// Display encoding is applied once, after all floating-point passes.
	#include <encodings_fragment>
}
