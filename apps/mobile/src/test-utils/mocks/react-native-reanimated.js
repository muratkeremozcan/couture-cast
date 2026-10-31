// `app/_layout.tsx` imports react-native-reanimated for its side effects only. The real
// package reaches React Native's Flow-typed `Libraries/Renderer/shims/ReactFabric.js`,
// which Vite's dependency scan cannot parse, so one test that mounts the layout would
// stop every mobile test file. No browser test drives an animation; nothing is exported.
export default {}
