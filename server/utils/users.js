import { randomUUID } from "crypto";
import { CONFIG, SESSION_STATUS } from "../config/constants.js";

const otpToUser = new Map();
const socketToOtp = new Map();
const sessions = new Map();

const isValidOtp = (otp) =>
  typeof otp === "string" &&
  otp.length === CONFIG.OTP_LENGTH &&
  /^[0-9]+$/.test(otp);

const generateOtp = () => {
  const maxAttempts = 20;
  for (let i = 0; i < maxAttempts; i += 1) {
    let otp = "";
    for (let j = 0; j < CONFIG.OTP_LENGTH; j += 1) {
      otp += Math.floor(Math.random() * 10).toString();
    }
    if (!otpToUser.has(otp)) {
      return otp;
    }
  }
  throw new Error("OTP_GENERATION_FAILED");
};

export const registerUser = (socketId, providedOtp) => {
  const existingOtp = socketToOtp.get(socketId);
  if (existingOtp) {
    return { otp: existingOtp, isNew: false };
  }

  if (providedOtp) {
    if (!isValidOtp(providedOtp)) {
      return { error: "INVALID_OTP" };
    }
    const existingUser = otpToUser.get(providedOtp);
    if (existingUser && existingUser.socketId !== socketId) {
      return { error: "OTP_IN_USE" };
    }
    otpToUser.set(providedOtp, { socketId, createdAt: Date.now() });
    socketToOtp.set(socketId, providedOtp);
    return { otp: providedOtp, isNew: false };
  }

  const otp = generateOtp();
  otpToUser.set(otp, { socketId, createdAt: Date.now() });
  socketToOtp.set(socketId, otp);
  return { otp, isNew: true };
};

export const getOtpBySocketId = (socketId) => socketToOtp.get(socketId) || null;

export const getSocketIdByOtp = (otp) => otpToUser.get(otp)?.socketId || null;

export const isOtpOnline = (otp) => otpToUser.has(otp);

export const isOtpBusy = (otp) => {
  for (const session of sessions.values()) {
    const activeStatus =
      session.status !== SESSION_STATUS.ENDED &&
      session.status !== SESSION_STATUS.REJECTED;
    if (activeStatus && (session.requesterOtp === otp || session.targetOtp === otp)) {
      return true;
    }
  }
  return false;
};

export const createSession = (requesterOtp, targetOtp) => {
  if (!isValidOtp(requesterOtp) || !isValidOtp(targetOtp)) {
    return { error: "INVALID_OTP" };
  }
  if (requesterOtp === targetOtp) {
    return { error: "SAME_OTP" };
  }
  if (isOtpBusy(requesterOtp) || isOtpBusy(targetOtp)) {
    return { error: "OTP_BUSY" };
  }

  const sessionId = randomUUID();
  const session = {
    sessionId,
    requesterOtp,
    targetOtp,
    status: SESSION_STATUS.REQUESTED,
    targetReady: false,
    createdAt: Date.now()
  };
  sessions.set(sessionId, session);
  return { sessionId, session };
};

export const getSession = (sessionId) => sessions.get(sessionId) || null;

export const updateSession = (sessionId, updates) => {
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }
  const nextSession = { ...session, ...updates };
  sessions.set(sessionId, nextSession);
  return nextSession;
};

export const endSession = (sessionId, reason = "ended") => {
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }
  sessions.delete(sessionId);
  return {
    ...session,
    status: SESSION_STATUS.ENDED,
    endedAt: Date.now(),
    reason
  };
};

export const endSessionsForOtp = (otp, reason = "disconnect") => {
  const endedSessions = [];
  for (const [sessionId, session] of sessions.entries()) {
    if (session.requesterOtp === otp || session.targetOtp === otp) {
      sessions.delete(sessionId);
      endedSessions.push({
        ...session,
        status: SESSION_STATUS.ENDED,
        endedAt: Date.now(),
        reason
      });
    }
  }
  return endedSessions;
};

export const removeUserBySocketId = (socketId) => {
  const otp = socketToOtp.get(socketId);
  if (!otp) {
    return null;
  }
  socketToOtp.delete(socketId);
  otpToUser.delete(otp);
  return otp;
};

export const getPeerOtp = (session, otp) => {
  if (!session) {
    return null;
  }
  if (session.requesterOtp === otp) {
    return session.targetOtp;
  }
  if (session.targetOtp === otp) {
    return session.requesterOtp;
  }
  return null;
};
