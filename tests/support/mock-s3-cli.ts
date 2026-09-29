/**
 * Runs the mock S3 server on its own, for `npm run test:integration:s3`.
 *   tsx tests/support/mock-s3-cli.ts <port> <bucket>
 */
import { startMockS3 } from "./mockS3";

async function main() {
  const port = Number(process.argv[2] || 3220);
  const bucket = process.argv[3] || "cairn-itest";
  const mock = await startMockS3(bucket, 1000, port);
  console.log(`mock-s3 listening on ${mock.url} (bucket ${bucket})`);
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
  setInterval(() => {
    const problem = mock.problem();
    if (problem) console.error(`mock-s3 rejected a request: ${problem}`);
  }, 5000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});