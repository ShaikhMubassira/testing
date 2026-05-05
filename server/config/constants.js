export const CONFIG = {
  PORT: Number(process.env.PORT) || 3000,
  CORS_ORIGIN: process.env.CORS_ORIGIN || "*",
  OTP_LENGTH: 6,
  REQUEST_TIMEOUT_MS: Number(process.env.REQUEST_TIMEOUT_MS) || 60000
};

export const SESSION_STATUS = {
  REQUESTED: "requested",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  ENDED: "ended"
};

export const EVENTS = {
  REGISTER_USER: "register-user",
  REGISTERED: "registered",
  MONITOR_REQUEST: "monitor-request",
  REQUEST_SENT: "request-sent",
  INCOMING_REQUEST: "incoming-request",
  TARGET_RESPONSE: "target-response",
  REQUEST_ACCEPTED: "request-accepted",
  REQUEST_REJECTED: "request-rejected",
  TARGET_READY: "target-ready",
  OFFER: "offer",
  ANSWER: "answer",
  ICE_CANDIDATE: "ice-candidate",
  MUTE_AUDIO: "mute-audio",
  TOGGLE_VIDEO: "toggle-video",
  LEAVE_ROOM: "leave-room",
  END_SESSION: "end-session",
  SESSION_ENDED: "session-ended",
  USER_LEFT: "user-left",
  ERROR: "error-message"
};
