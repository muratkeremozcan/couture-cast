import { requireOptionalNativeModule } from 'expo-modules-core'
interface ModalSystemBarsModule {
  setDarkStatusBar(tag: number): Promise<boolean>
}
const module = () => requireOptionalNativeModule<ModalSystemBarsModule>('ModalSystemBars')
export function modalSystemBarsAvailable(): boolean {
  return module() !== null
}
export function setModalDarkStatusBar(tag: number): Promise<boolean> | null {
  return module()?.setDarkStatusBar(tag) ?? null
}
