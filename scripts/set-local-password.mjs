import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const [, , profileId, email, password] = process.argv;

if (!profileId || !email || !password) {
  console.error("Usage: npm run auth:set-password -- <profile-id> <email> <password>");
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const profiles = await prisma.$queryRaw`
    select id
    from public.profiles
    where id = ${profileId}::uuid
    limit 1
  `;

  if (!profiles.length) {
    throw new Error(`Profile not found: ${profileId}`);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.auth_users.upsert({
    where: { profile_id: profileId },
    create: {
      profile_id: profileId,
      email: email.toLowerCase(),
      password_hash: passwordHash,
      password_set_at: new Date()
    },
    update: {
      email: email.toLowerCase(),
      password_hash: passwordHash,
      password_set_at: new Date(),
      failed_login_count: 0,
      locked_until: null
    }
  });

  console.log(`Local login updated for ${email.toLowerCase()} (${profileId}).`);
} finally {
  await prisma.$disconnect();
}
