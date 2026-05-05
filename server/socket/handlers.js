import {
  CONFIG,
  EVENTS,
  SESSION_STATUS
} from "../config/constants.js";
import {
  registerUser,
  getOtpBySocketId,
  getSocketIdByOtp,
  isOtpOnline,
  createSession,
  getSession,
  updateSession,
  endSession,
  endSessionsForOtp,
  removeUserBySocketId,
  getPeerOtp
} from "../utils/users.js";

const pendingTimeouts = new Map();

const emitError = (socket, code, message) => {
  socket.emit(EVENTS.ERROR, { code, message });
};

const sendToOtp = (io, otp, event, payload) => {
  const socketId = getSocketIdByOtp(otp);
  if (!socketId) {
    return false;
  }
  io.to(socketId).emit(event, payload);
  return true;
};

const clearRequestTimeout = (sessionId) => {
  const timeoutId = pendingTimeouts.get(sessionId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    pendingTimeouts.delete(sessionId);
  }
};

const scheduleRequestTimeout = (io, sessionId) => {
  clearRequestTimeout(sessionId);
  const timeoutId = setTimeout(() => {
    const session = getSession(sessionId);
    if (!session || session.status !== SESSION_STATUS.REQUESTED) {
      return;
    }
    const ended = endSession(sessionId, "timeout");
    if (ended) {
      sendToOtp(io, ended.requesterOtp, EVENTS.SESSION_ENDED, {
        sessionId,
        reason: "timeout"
      });
      sendToOtp(io, ended.targetOtp, EVENTS.SESSION_ENDED, {
        sessionId,
        reason: "timeout"
      });
    }
  }, CONFIG.REQUEST_TIMEOUT_MS);
  pendingTimeouts.set(sessionId, timeoutId);
};

export const registerSocketHandlers = (io) => {
  io.on("connection", (socket) => {
    console.log(`[socket] connected ${socket.id} total=${io.engine.clientsCount}`);

    socket.on(EVENTS.REGISTER_USER, (payload = {}) => {
      const result = registerUser(socket.id, payload.otp);
      if (result.error === "INVALID_OTP") {
        emitError(socket, "INVALID_OTP", "OTP format invalid.");
        return;
      }
      if (result.error === "OTP_IN_USE") {
        emitError(socket, "OTP_IN_USE", "OTP already in use on another device.");
        return;
      }
      socket.emit(EVENTS.REGISTERED, { otp: result.otp });
      console.log(`[user] joined otp=${result.otp}`);
    });

    socket.on(EVENTS.MONITOR_REQUEST, (payload = {}) => {
      const requesterOtp = getOtpBySocketId(socket.id);
      if (!requesterOtp) {
        emitError(socket, "NOT_REGISTERED", "Register first to receive OTP.");
        return;
      }
      const targetOtp = payload.targetOtp;
      if (typeof targetOtp !== "string") {
        emitError(socket, "INVALID_OTP", "Target OTP is required.");
        return;
      }
      if (!isOtpOnline(targetOtp)) {
        emitError(socket, "TARGET_OFFLINE", "Target user is offline.");
        return;
      }
      const sessionResult = createSession(requesterOtp, targetOtp);
      if (sessionResult.error === "SAME_OTP") {
        emitError(socket, "SAME_OTP", "Requester and target cannot be the same.");
        return;
      }
      if (sessionResult.error === "OTP_BUSY") {
        emitError(socket, "OTP_BUSY", "One of the users is already in a session.");
        return;
      }
      if (sessionResult.error === "INVALID_OTP") {
        emitError(socket, "INVALID_OTP", "Invalid OTP format.");
        return;
      }

      const { sessionId } = sessionResult;
      const delivered = sendToOtp(io, targetOtp, EVENTS.INCOMING_REQUEST, {
        sessionId,
        fromOtp: requesterOtp
      });
      if (!delivered) {
        endSession(sessionId, "target-offline");
        emitError(socket, "TARGET_OFFLINE", "Target user is offline.");
        return;
      }
      socket.emit(EVENTS.REQUEST_SENT, { sessionId, targetOtp });
      scheduleRequestTimeout(io, sessionId);
      console.log(`[call] request from ${requesterOtp} to ${targetOtp}`);
    });

    socket.on(EVENTS.TARGET_RESPONSE, (payload = {}) => {
      const responderOtp = getOtpBySocketId(socket.id);
      const sessionId = payload.sessionId;
      const accept = Boolean(payload.accept);
      if (!responderOtp) {
        emitError(socket, "NOT_REGISTERED", "Register first to respond.");
        return;
      }
      const session = getSession(sessionId);
      if (!session) {
        emitError(socket, "SESSION_NOT_FOUND", "Session not found.");
        return;
      }
      if (session.targetOtp !== responderOtp) {
        emitError(socket, "NOT_TARGET", "Only target can respond.");
        return;
      }

      clearRequestTimeout(sessionId);
      if (!accept) {
        updateSession(sessionId, { status: SESSION_STATUS.REJECTED });
        sendToOtp(io, session.requesterOtp, EVENTS.REQUEST_REJECTED, { sessionId });
        endSession(sessionId, "rejected");
        console.log(`[call] rejected by ${responderOtp}`);
        return;
      }

      updateSession(sessionId, { status: SESSION_STATUS.ACCEPTED });
      sendToOtp(io, session.requesterOtp, EVENTS.REQUEST_ACCEPTED, {
        sessionId,
        targetOtp: responderOtp
      });
      console.log(`[call] accepted by ${responderOtp}`);
    });

    socket.on(EVENTS.TARGET_READY, (payload = {}) => {
      const sessionId = payload.sessionId;
      const targetOtp = getOtpBySocketId(socket.id);
      if (!targetOtp) {
        emitError(socket, "NOT_REGISTERED", "Register first to continue.");
        return;
      }
      const session = getSession(sessionId);
      if (!session) {
        emitError(socket, "SESSION_NOT_FOUND", "Session not found.");
        return;
      }
      if (session.targetOtp !== targetOtp) {
        emitError(socket, "NOT_TARGET", "Only target can mark ready.");
        return;
      }
      if (session.status !== SESSION_STATUS.ACCEPTED) {
        emitError(socket, "NOT_ACCEPTED", "Session is not accepted yet.");
        return;
      }
      updateSession(sessionId, { targetReady: true });
      sendToOtp(io, session.requesterOtp, EVENTS.TARGET_READY, {
        sessionId,
        targetOtp
      });
      console.log(`[call] target ready ${targetOtp}`);
    });

    socket.on(EVENTS.OFFER, (payload = {}) => {
      const sessionId = payload.sessionId;
      const offer = payload.offer;
      const senderOtp = getOtpBySocketId(socket.id);
      if (!senderOtp) {
        emitError(socket, "NOT_REGISTERED", "Register first to send offer.");
        return;
      }
      const session = getSession(sessionId);
      if (!session) {
        emitError(socket, "SESSION_NOT_FOUND", "Session not found.");
        return;
      }
      if (session.status !== SESSION_STATUS.ACCEPTED || !session.targetReady) {
        emitError(socket, "NOT_READY", "Target is not ready yet.");
        return;
      }
      if (session.targetOtp !== senderOtp) {
        emitError(socket, "NOT_TARGET", "Only target can send offer.");
        return;
      }
      sendToOtp(io, session.requesterOtp, EVENTS.OFFER, {
        sessionId,
        offer,
        fromOtp: senderOtp
      });
      console.log(`[webrtc] offer from ${senderOtp}`);
    });

    socket.on(EVENTS.ANSWER, (payload = {}) => {
      const sessionId = payload.sessionId;
      const answer = payload.answer;
      const senderOtp = getOtpBySocketId(socket.id);
      if (!senderOtp) {
        emitError(socket, "NOT_REGISTERED", "Register first to send answer.");
        return;
      }
      const session = getSession(sessionId);
      if (!session) {
        emitError(socket, "SESSION_NOT_FOUND", "Session not found.");
        return;
      }
      if (session.requesterOtp !== senderOtp) {
        emitError(socket, "NOT_REQUESTER", "Only requester can send answer.");
        return;
      }
      sendToOtp(io, session.targetOtp, EVENTS.ANSWER, {
        sessionId,
        answer,
        fromOtp: senderOtp
      });
      console.log(`[webrtc] answer from ${senderOtp}`);
    });

    socket.on(EVENTS.ICE_CANDIDATE, (payload = {}) => {
      const sessionId = payload.sessionId;
      const candidate = payload.candidate;
      const senderOtp = getOtpBySocketId(socket.id);
      if (!senderOtp) {
        emitError(socket, "NOT_REGISTERED", "Register first to send ICE.");
        return;
      }
      const session = getSession(sessionId);
      if (!session) {
        emitError(socket, "SESSION_NOT_FOUND", "Session not found.");
        return;
      }
      if (session.status !== SESSION_STATUS.ACCEPTED || !session.targetReady) {
        emitError(socket, "NOT_READY", "Target is not ready yet.");
        return;
      }
      const peerOtp = getPeerOtp(session, senderOtp);
      if (!peerOtp) {
        emitError(socket, "NOT_IN_SESSION", "Sender is not in this session.");
        return;
      }
      sendToOtp(io, peerOtp, EVENTS.ICE_CANDIDATE, {
        sessionId,
        candidate,
        fromOtp: senderOtp
      });
    });

    socket.on(EVENTS.MUTE_AUDIO, (payload = {}) => {
      const sessionId = payload.sessionId;
      const muted = Boolean(payload.muted);
      const senderOtp = getOtpBySocketId(socket.id);
      const session = getSession(sessionId);
      if (!senderOtp || !session) {
        emitError(socket, "SESSION_NOT_FOUND", "Session not found.");
        return;
      }
      if (session.targetOtp !== senderOtp) {
        emitError(socket, "NOT_TARGET", "Only target can update audio state.");
        return;
      }
      sendToOtp(io, session.requesterOtp, EVENTS.MUTE_AUDIO, {
        sessionId,
        muted,
        fromOtp: senderOtp
      });
    });

    socket.on(EVENTS.TOGGLE_VIDEO, (payload = {}) => {
      const sessionId = payload.sessionId;
      const videoEnabled = Boolean(payload.videoEnabled);
      const senderOtp = getOtpBySocketId(socket.id);
      const session = getSession(sessionId);
      if (!senderOtp || !session) {
        emitError(socket, "SESSION_NOT_FOUND", "Session not found.");
        return;
      }
      if (session.targetOtp !== senderOtp) {
        emitError(socket, "NOT_TARGET", "Only target can update video state.");
        return;
      }
      sendToOtp(io, session.requesterOtp, EVENTS.TOGGLE_VIDEO, {
        sessionId,
        videoEnabled,
        fromOtp: senderOtp
      });
    });

    const handleEndSession = (sessionId, reason) => {
      const senderOtp = getOtpBySocketId(socket.id);
      const session = getSession(sessionId);
      if (!senderOtp || !session) {
        emitError(socket, "SESSION_NOT_FOUND", "Session not found.");
        return;
      }
      const peerOtp = getPeerOtp(session, senderOtp);
      if (!peerOtp) {
        emitError(socket, "NOT_IN_SESSION", "Sender is not in this session.");
        return;
      }
      clearRequestTimeout(sessionId);
      endSession(sessionId, reason);
      sendToOtp(io, peerOtp, EVENTS.SESSION_ENDED, {
        sessionId,
        reason,
        fromOtp: senderOtp
      });
      socket.emit(EVENTS.SESSION_ENDED, { sessionId, reason });
      console.log(`[user] left otp=${senderOtp} reason=${reason}`);
    };

    socket.on(EVENTS.END_SESSION, (payload = {}) => {
      handleEndSession(payload.sessionId, "end-session");
    });

    socket.on(EVENTS.LEAVE_ROOM, (payload = {}) => {
      handleEndSession(payload.sessionId, "leave-room");
    });

    socket.on("disconnect", () => {
      const otp = removeUserBySocketId(socket.id);
      if (!otp) {
        return;
      }
      const endedSessions = endSessionsForOtp(otp, "disconnect");
      endedSessions.forEach((session) => {
        clearRequestTimeout(session.sessionId);
        const peerOtp = getPeerOtp(session, otp);
        if (peerOtp) {
          sendToOtp(io, peerOtp, EVENTS.USER_LEFT, {
            sessionId: session.sessionId,
            otp,
            reason: "disconnect"
          });
        }
      });
      console.log(`[user] left otp=${otp} reason=disconnect`);
    });
  });
};
