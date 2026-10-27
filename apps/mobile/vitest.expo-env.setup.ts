// babel-preset-expo inlines process.env.EXPO_OS on every platform. Vitest compiles without
// it, so expo-modules-core warned that EXPO_OS is undefined whenever an Expo package
// loaded. These suites render through react-native-web, so the default is 'web'. This file
// runs before each test file, so a file that simulates a native platform still assigns
// process.env.EXPO_OS in vi.hoisted before Expo packages load.
process.env.EXPO_OS = 'web'
