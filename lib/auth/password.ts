import "server-only";

import bcrypt from "bcryptjs";

const PASSWORD_COST = 12;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, PASSWORD_COST);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}
