uniform mat4 uProjectorMatrix;
varying vec4 vProjected;
void main() {
	vec4 worldPosition = modelMatrix * vec4(position, 1.0);
	vProjected = uProjectorMatrix * worldPosition;
	gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
