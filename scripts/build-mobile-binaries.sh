#!/usr/bin/env bash
set -e

echo "🔨 Building mobile binaries for CI..."
echo "This will take 5-10 minutes..."

# Set ANDROID_HOME if not set
if [ -z "$ANDROID_HOME" ]; then
  if [ -d "$HOME/Library/Android/sdk" ]; then
    export ANDROID_HOME="$HOME/Library/Android/sdk"
    echo "Set ANDROID_HOME=$ANDROID_HOME"
  else
    echo "❌ ANDROID_HOME not set and ~/Library/Android/sdk not found"
    echo "Install Android Studio or set ANDROID_HOME manually"
    exit 1
  fi
fi

cd apps/mobile

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf android ios

# Generate native code
echo "📦 Running expo prebuild..."
npx expo prebuild --clean

# Build Android
echo "🤖 Building Android APK..."
cd android
./gradlew assembleDebug
cd ..

# Build iOS
echo "🍎 Building iOS app..."
cd ios
xcodebuild -workspace mobile.xcworkspace \
  -scheme mobile \
  -configuration Debug \
  -sdk iphonesimulator \
  -derivedDataPath build \
  -quiet
cd ..

# Verify builds exist
echo "✅ Verifying builds..."
APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"
APP_PATH="ios/build/Build/Products/Debug-iphonesimulator/mobile.app"

if [ ! -f "$APK_PATH" ]; then
  echo "❌ Android APK not found at $APK_PATH"
  exit 1
fi

if [ ! -d "$APP_PATH" ]; then
  echo "❌ iOS app not found at $APP_PATH"
  exit 1
fi

echo ""
echo "✅ Builds complete!"
echo "📱 Android: $APK_PATH"
echo "🍎 iOS: $APP_PATH"
echo ""
echo "📝 Next steps:"
echo "1. Test locally: npm run test:mobile:e2e"
echo "2. Commit binaries: git add apps/mobile/android apps/mobile/ios"
echo "3. Push and CI will use pre-built binaries (no build step, ~3 min)"
echo ""
echo "⚠️  Note: Rebuild and recommit whenever you change mobile app code"
