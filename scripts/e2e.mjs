import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/e2e/server.ts"],
  { stdio: "ignore", windowsHide: true },
);
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      ready = (await fetch("http://127.0.0.1:3100/health")).ok;
    } catch {}
    if (ready) break;
    await setTimeout(250);
  }
  if (!ready) throw new Error("Test server unavailable");
  const runner = spawn(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
    { stdio: "inherit", windowsHide: true },
  );
  process.exitCode = await new Promise((resolve) =>
    runner.on("exit", (code) => resolve(code ?? 1)),
  );
} finally {
  server.kill();
}
