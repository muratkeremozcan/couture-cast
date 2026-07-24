#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(WidgetSharedModule, NSObject)

RCT_EXTERN_METHOD(
  setWidgetData:(NSString *)payload
  resolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
)

@end
