/** Per-flow Maestro budget for the native harness; the iOS first-flow gate keeps its fixed budget. */
import { DEFAULT_FLOW_TIMEOUT_MS, flowTimeoutMs } from '../lib/story68-flow-timeouts.mjs'

export const OPEN_APP_FLOW = 'maestro/story65/open-app.yaml'

/**
 * open-app.yaml is the first flow of the iOS startup gate, so on iOS every run of it keeps the
 * fixed 120000 ms child budget the gate measures against. Other flows use their derived budget.
 */
export const nativeFlowTimeoutMs = (flow, platform) =>
  platform === 'ios' && flow === OPEN_APP_FLOW
    ? DEFAULT_FLOW_TIMEOUT_MS
    : flowTimeoutMs(flow)
