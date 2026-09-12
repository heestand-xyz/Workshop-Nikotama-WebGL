uniform sampler2D uProjection;
varying vec4 vProjected;
void main() {
	if (vProjected.w <= 0.0) {
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
		return;
	}
	vec3 ndc = vProjected.xyz / vProjected.w;
	if (any(greaterThan(abs(ndc), vec3(1.0)))) {
		gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
		return;
	}
	gl_FragColor = texture2D(uProjection, ndc.xy * 0.5 + 0.5);
}
