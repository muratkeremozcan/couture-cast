// Linux has no CoreGraphics; Foundation itself defines CGRect, CGPoint, CGSize and CGFloat there.
// This module lets the iOS sources keep `import CoreGraphics` unchanged on the Linux rules job
// (story 6.15 D6), so the source blob the X-IPAD-ANCHOR proof records stays the proven one. Only
// Package.swift's Linux branch builds it; the podspec compiles top-level sources only.
@_exported import Foundation
