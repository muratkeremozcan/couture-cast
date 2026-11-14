#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Reads a React Native paragraph view (RCTParagraphComponentView) through its public surface: the
 * attributedText property kept for introspection tools, and the props every Fabric component view
 * exposes (RCTComponentViewProtocol `props`), whose paragraph attributes carry numberOfLines and
 * ellipsizeMode as the view draws them.
 */
@interface TLPParagraphReader : NSObject

/// Exactly an RCTParagraphComponentView.
+ (BOOL)isParagraphView:(UIView *)view
    NS_SWIFT_NAME(isParagraphView(_:));

/// An RCTParagraphComponentView or a subclass of it.
+ (BOOL)isParagraphLikeView:(UIView *)view
    NS_SWIFT_NAME(isParagraphLikeView(_:));

+ (nullable NSAttributedString *)attributedTextOfParagraph:(UIView *)view
    NS_SWIFT_NAME(attributedTextOfParagraph(_:));

/// The paragraph's maximumNumberOfLines (0 for no limit), or -1 when its props cannot be read.
+ (NSInteger)maximumNumberOfLinesOfParagraph:(UIView *)view
    NS_SWIFT_NAME(maximumNumberOfLinesOfParagraph(_:));

/// The line break mode the paragraph truncates with, from its ellipsizeMode.
+ (NSLineBreakMode)lineBreakModeOfParagraph:(UIView *)view
    NS_SWIFT_NAME(lineBreakModeOfParagraph(_:));

@end

NS_ASSUME_NONNULL_END
