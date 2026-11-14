#import "TLPParagraphReader.h"

#import <React/RCTParagraphComponentView.h>
#import <react/renderer/components/text/ParagraphProps.h>

using namespace facebook::react;

/// The paragraph props the view last rendered with, or null for any other view.
static std::shared_ptr<const ParagraphProps> TLPParagraphPropsOf(UIView *view)
{
  if (![view isKindOfClass:[RCTParagraphComponentView class]]) {
    return nullptr;
  }
  Props::Shared props = [(RCTParagraphComponentView *)view props];
  // RCTParagraphComponentView only ever receives ParagraphProps.
  return std::static_pointer_cast<const ParagraphProps>(props);
}

@implementation TLPParagraphReader

+ (BOOL)isParagraphView:(UIView *)view
{
  return [view isMemberOfClass:[RCTParagraphComponentView class]];
}

+ (BOOL)isParagraphLikeView:(UIView *)view
{
  return [view isKindOfClass:[RCTParagraphComponentView class]];
}

+ (nullable NSAttributedString *)attributedTextOfParagraph:(UIView *)view
{
  if (![view isKindOfClass:[RCTParagraphComponentView class]]) {
    return nil;
  }
  return ((RCTParagraphComponentView *)view).attributedText;
}

+ (NSInteger)maximumNumberOfLinesOfParagraph:(UIView *)view
{
  auto props = TLPParagraphPropsOf(view);
  if (!props) {
    return -1;
  }
  return MAX(0, props->paragraphAttributes.maximumNumberOfLines);
}

+ (NSLineBreakMode)lineBreakModeOfParagraph:(UIView *)view
{
  auto props = TLPParagraphPropsOf(view);
  if (!props) {
    return NSLineBreakByTruncatingTail;
  }
  switch (props->paragraphAttributes.ellipsizeMode) {
    case EllipsizeMode::Clip:
      return NSLineBreakByClipping;
    case EllipsizeMode::Head:
      return NSLineBreakByTruncatingHead;
    case EllipsizeMode::Middle:
      return NSLineBreakByTruncatingMiddle;
    case EllipsizeMode::Tail:
    default:
      return NSLineBreakByTruncatingTail;
  }
}

@end
