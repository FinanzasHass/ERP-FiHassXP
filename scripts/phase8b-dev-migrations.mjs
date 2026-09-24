import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const folder = "docs/fase-8b";
const expectedBaseline = Array.from({ length: 43 }, (_, index) => {
  const number = index + 1;
  const day = number <= 11 ? "09" : number <= 16 ? "10" : number <= 23 ? "11" : number <= 32 ? "12" : "13";
  return `202609${day}${String(number).padStart(4, "0")}`;
});
const approved = [
  "202609220044",
  "202609220045",
  "202609220046",
  "202609220047",
  "202609220048",
  "202609230049",
  "202609230050",
  "202609230051",
  "202609240052",
];

await mkdir(folder, { recursive: true });
const projectRef = (await readFile("supabase/.temp/project-ref", "utf8")).trim();
const configuredHost = new URL(process.env.SUPABASE_URL).hostname;
if (process.env.NODE_ENV === "production" || configuredHost !== `${projectRef}.supabase.co`) {
  throw new Error("DEV project mismatch");
}
const cli = "node_modules/@supabase/cli-windows-x64/bin/supabase.exe";
const report = {
  executedAt: new Date().toISOString(),
  mode: process.argv.includes("--apply") ? "APPLY" : "PREFLIGHT",
  sameProjectAsApplication: true,
  projectFingerprint: createHash("sha256").update(projectRef).digest("hex").slice(0, 16),
  status: "BLOCKED_EXTERNAL",
  steps: [],
};

async function command(args) {
  try {
    const result = await run(cli, args, {
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { ok: true, text: `${result.stdout}\n${result.stderr}` };
  } catch (error) {
    const output = `${error.stdout || ""}\n${error.stderr || ""}`;
    return {
      ok: false,
      diagnostic: /28P01/.test(output)
        ? "28P01"
        : /access token|supabase login|not logged/i.test(output)
          ? "CLI_LOGIN_REQUIRED"
          : /denied|forbidden/i.test(output)
            ? "ACCESS_DENIED"
            : /network|connect|resolve|dial tcp/i.test(output)
              ? "NETWORK_CONNECTION"
              : error.killed
                ? "TIMEOUT"
                : "CLI_FAILED",
    };
  }
}

function migrations(output) {
  try {
    const parsed = JSON.parse(output.slice(0, output.lastIndexOf("}") + 1));
    return parsed.migrations.map((row) => ({
      local: /^\d{12}$/.test(row.local) ? row.local : null,
      remote: /^\d{12}$/.test(row.remote) ? row.remote : null,
    }));
  } catch {
    return output
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*`(\d{12})`\s*\|\s*`\s*(\d{12})?\s*`/))
      .filter(Boolean)
      .map((match) => ({ local: match[1], remote: match[2] ?? null }));
  }
}

async function persist() {
  await writeFile(`${folder}/migraciones-dev.json`, JSON.stringify(report, null, 2));
}

async function execute() {
try {
  try {
    const previous = await readFile(`${folder}/migraciones-dev.json`, "utf8");
    await mkdir(`${folder}/historico`, { recursive: true });
    await writeFile(`${folder}/historico/migraciones-dev-${Date.now()}.json`, previous);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const gate = JSON.parse(await readFile(`${folder}/puerta-local.json`, "utf8"));
  if (gate.status !== "PASS") throw new Error("Local gate required");
  for (const [name, hash] of Object.entries(gate.migrationHashes)) {
    const actual = createHash("sha256")
      .update(await readFile(`supabase/migrations/${name}`))
      .digest("hex");
    if (actual !== hash) throw new Error("Migration changed after local gate");
  }
  const gateVersions = Object.keys(gate.migrationHashes).map((name) => name.split("_")[0]);
  if (JSON.stringify(gateVersions) !== JSON.stringify(approved)) {
    throw new Error("Unexpected Phase 8B migration set");
  }

  const before = await command(["migration", "list", "--linked", "--output", "json"]);
  const beforeRows = before.ok ? migrations(before.text) : [];
  report.steps.push({
    operation: "migration list before",
    status: before.ok ? "PASS" : "BLOCKED_EXTERNAL",
    diagnostic: before.diagnostic,
    versions: beforeRows,
  });
  if (!before.ok) return;

  const baselineComplete = expectedBaseline.every((version) =>
    beforeRows.some((row) => row.local === version && row.remote === version),
  );
  const unexpectedDrift = beforeRows.some(
    (row) => row.local !== row.remote && !approved.includes(row.local),
  );
  if (!baselineComplete || unexpectedDrift) throw new Error("Unexpected DEV migration drift");

  if (!process.argv.includes("--apply")) {
    report.status = "PREFLIGHT_PASS";
    return;
  }

  const pushed = await command(["db", "push", "--linked", "--yes"]);
  report.steps.push({
    operation: "db push DEV",
    status: pushed.ok ? "PASS" : "BLOCKED_EXTERNAL",
    diagnostic: pushed.diagnostic,
  });
  if (!pushed.ok) return;

  const after = await command(["migration", "list", "--linked", "--output", "json"]);
  const afterRows = after.ok ? migrations(after.text) : [];
  const allApplied =
    after.ok &&
    approved.every((version) =>
      afterRows.some((row) => row.local === version && row.remote === version),
    );
  report.steps.push({
    operation: "migration list after",
    status: allApplied ? "PASS" : "FAIL",
    diagnostic: after.diagnostic,
    versions: afterRows,
  });
  report.status = allApplied ? "PASS" : "FAIL";
} catch (error) {
  report.status = "FAIL";
  report.diagnostic = error instanceof Error ? error.message : "Unknown error";
  process.exitCode = 1;
} finally {
  await persist();
  console.log(JSON.stringify({ status: report.status, steps: report.steps.map(({ operation, status }) => ({ operation, status })) }));
}
}

await execute();
