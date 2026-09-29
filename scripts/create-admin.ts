/**
 * Creates an administrator (or promotes/resets an existing account).
 *
 *   npm run admin:create -- you@example.com "a long passphrase" "Display Name"
 *
 * The first account registered through the web UI also becomes an administrator, so this is mainly
 * for headless setups and password recovery (there's no email server to send reset links).
 */
import { db } from "../src/server/db";
import { hashPassword } from "../src/server/crypto";
import { newId } from "../src/server/ids";
import { emailSchema, validatePassword } from "../src/server/services/auth";

async function main() {
  const [rawEmail, password, name] = process.argv.slice(2);
  if (!rawEmail || !password) {
    console.error('Usage: npm run admin:create -- <email> <password> ["Display name"]');
    process.exit(1);
  }
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) {
    console.error(parsed.error.issues[0]?.message ?? "Invalid email");
    process.exit(1);
  }
  const email = parsed.data;
  const problem = validatePassword(password, email);
  if (problem) {
    console.error(`Password rejected: ${problem}`);
    process.exit(1);
  }
  const passwordHash = await hashPassword(password);
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    await db.user.update({ where: { id: existing.id }, data: { role: "admin", status: "active", passwordHash, suspendedReason: null } });
    await db.session.deleteMany({ where: { userId: existing.id } });
    console.log(`Updated ${email}: now an active administrator with the new password (all sessions revoked).`);
  } else {
    await db.user.create({ data: { id: newId("usr"), email, displayName: name || email.split("@")[0], passwordHash, role: "admin" } });
    console.log(`Created administrator ${email}.`);
  }
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
