import { createHash } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "seoranko_master";

export function isMasterSession(): boolean {
  const masterEmail = process.env.MASTER_EMAIL;
  const masterPassword = process.env.MASTER_PASSWORD;
  if (!masterEmail || !masterPassword) return false;

  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return false;

  const expected = createHash("sha256")
    .update(`${masterEmail}:${masterPassword}:master`)
    .digest("hex");

  return token === expected;
}
