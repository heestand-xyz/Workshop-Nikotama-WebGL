import {GUI} from 'lil-gui'

type ControlParams = {
	isTimePaused: boolean
	debugTime: number
	lightRadius: number
	lightY: number
	lightSpeed: number
	blurRadius: number
	minSaturation: number
	minBrightness: number
	exposure: number
	saturation: number
	gamma: number
}

class Controls {
	gui?: GUI
	params: ControlParams =  {
		isTimePaused: false,
		debugTime: 0,
		lightRadius: 0.5,
		lightY: 0,
		lightSpeed: 0.5,
		blurRadius: 128,
		minSaturation: 0.1,
		minBrightness: 0.1,
		exposure: 0,
		saturation: 1,
		gamma: 1,
	}

	init(onKeyColorsChange?: () => void) {
		this.dispose()
		this.gui = new GUI()

		const keyColorFolder = this.gui.addFolder('Key Colours')
		keyColorFolder.add(this.params, 'minSaturation', 0, 1, 0.01).name('Min Saturation')
			.onChange(() => onKeyColorsChange?.())
		keyColorFolder.add(this.params, 'minBrightness', 0, 1, 0.01).name('Min Brightness')
			.onChange(() => onKeyColorsChange?.())

		const blurFolder = this.gui.addFolder('Blur')
		blurFolder.add(this.params, 'blurRadius', 0, 256, 0.1).name('Radius (pixels)')

		const colorFolder = this.gui.addFolder('Final Color')
		colorFolder.add(this.params, 'exposure', -5, 5, 0.01).name('Exposure (stops)')
		colorFolder.add(this.params, 'saturation', 0, 2, 0.01).name('Saturation')
		colorFolder.add(this.params, 'gamma', 0.1, 3, 0.01).name('Gamma')

		const lightFolder = this.gui.addFolder('Light')
		lightFolder.add(this.params, 'lightRadius', 0, 10, 0.01).name('Radius')
		lightFolder.add(this.params, 'lightY', -10, 10, 0.01).name('Y Position')
		lightFolder.add(this.params, 'lightSpeed', -3, 3, 0.01).name('Speed (rad/s)')

		const timeFolder = this.gui.addFolder('Time')
		timeFolder.open()
		const debugTimeController = timeFolder.add(this.params, 'debugTime', 0, 1000).name('Debug Time')
		debugTimeController.domElement.style.pointerEvents = 'none';
		debugTimeController.domElement.style.opacity = '0.5';
		timeFolder.add(this.params, 'isTimePaused').name('Pause Time').onChange((value: boolean) => {
			if(value){
				debugTimeController.domElement.style.pointerEvents = 'auto';
				debugTimeController.domElement.style.opacity = '1.0';
			} else {
				debugTimeController.domElement.style.pointerEvents = 'none';
				debugTimeController.domElement.style.opacity = '0.5';
			}
		})
	}

	dispose() {
		this.gui?.destroy()
		this.gui = undefined
	}
}

export default new Controls
