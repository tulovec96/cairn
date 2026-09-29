/** Integration runs: make sure the administrator exists before any test registers a normal user (first account = admin). */
export default async function setup() {
  const base = process.env.ITEST_BASE_URL;
  if (!base) return; // unit-test run
  const creds = { email: "admin@itest.test", password: "admin passphrase for integration tests" };
  const headers = { "content-type": "application/json", origin: base, "x-forwarded-for": "10.0.0.1" };
  const login = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers, body: JSON.stringify(creds) });
  if (login.status === 200) return;
  const reg = await fetch(`${base}/api/v1/auth/register`, { method: "POST", headers, body: JSON.stringify({ ...creds, displayName: "Admin" }) });
  if (reg.status !== 201) throw new Error(`Could not create the integration-test administrator: ${reg.status} ${await reg.text()}`);
}