import React from 'react'
import { View } from 'react-native'

const insets = { top: 0, right: 0, bottom: 0, left: 0 }
const frame = { x: 0, y: 0, width: 1024, height: 768 }

export const initialWindowMetrics = { frame, insets }
export const initialWindowSafeAreaInsets = insets
export const SafeAreaInsetsContext = React.createContext(insets)
export const SafeAreaFrameContext = React.createContext(frame)
export const SafeAreaConsumer = SafeAreaInsetsContext.Consumer
export const SafeAreaProvider = ({ children }) => (
  <SafeAreaFrameContext.Provider value={frame}>
    <SafeAreaInsetsContext.Provider value={insets}>
      {children}
    </SafeAreaInsetsContext.Provider>
  </SafeAreaFrameContext.Provider>
)
export const SafeAreaView = ({ children, ...props }) => (
  <View {...props}>{children}</View>
)
export const useSafeAreaInsets = () => insets
export const useSafeAreaFrame = () => frame
