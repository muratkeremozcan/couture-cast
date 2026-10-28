/** Maestro string variables the TalkBack runner supplies to every flow it starts. */
export function talkbackFlowStrings(english) {
  const n = english.community.notifications
  return {
    MAESTRO_TITLE: n.title,
    MAESTRO_SIGNIN: n.signin,
    MAESTRO_SEND: n.sendCode,
    MAESTRO_VERIFY: n.verify,
    MAESTRO_CODE_SENT: n.codeSent,
    MAESTRO_EMAIL_LABEL: n.email,
    MAESTRO_CODE_LABEL: n.code,
    MAESTRO_ENABLED: n.enabled,
    MAESTRO_SIGNOUT: n.signout,
    // open-app.yaml evaluates its iOS back runFlow condition on every platform.
    MAESTRO_BACK: english.common.back,
  }
}
