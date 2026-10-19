module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    // FormatJS uses static blocks. Run this before Expo's class-field transforms.
    plugins: ['@babel/plugin-transform-class-static-block'],
  }
}
