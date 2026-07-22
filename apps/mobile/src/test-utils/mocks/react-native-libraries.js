import React from 'react'

// Mock implementation for react-native libraries that contain Flow types
export const codegenNativeComponent = (name) => name
export const codegenNativeCommands = (options) => ({})
export const AppContainer = ({ children }) => <>{children}</>

export default {
  codegenNativeComponent,
  codegenNativeCommands,
  AppContainer,
}
