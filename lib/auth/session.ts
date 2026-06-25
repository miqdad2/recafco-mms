import "server-only";

import { createHash, randomBytes } from "crypto";
import { cookies, headers } from "next/headers";

import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { prisma } from "@/lib/db/prisma";

const SESSION_DAYS = 7;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isSecureCookieEnabled() {
  const configuredValue = process.env.AUTH_COOKIE_SECURE;

  if (configuredValue !== undefined) {
    return configuredValue.toLowerCase() === "true";
  }

  return process.env.NODE_ENV === "production";
}

export function hashSessionToken(token: string) {
  return hashToken(token);
}

export async function getSessionToken() {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function createSession(input: {
  userId: string;
  profileId: string;
}) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  );

  await prisma.auth_sessions.create({
    data: {
      user_id: input.userId,
      profile_id: input.profileId,
      session_token_hash: hashToken(token),
      user_agent: headerStore.get("user-agent"),
      ip_address:
        headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      expires_at: expiresAt
    }
  });

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookieEnabled(),
    path: "/",
    expires: expiresAt
  });
}

export async function revokeCurrentSession() {
  const token = await getSessionToken();
  const cookieStore = await cookies();

  if (token) {
    await prisma.auth_sessions.updateMany({
      where: {
        session_token_hash: hashToken(token),
        revoked_at: null
      },
      data: {
        revoked_at: new Date()
      }
    });
  }

  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureCookieEnabled(),
    path: "/",
    maxAge: 0
  });
}
