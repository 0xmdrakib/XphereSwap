import { copyFile, access, readFile, appendFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
const examplePath = resolve(process.cwd(), ".env.example");

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function envKeys(raw) {
  return new Set(
    raw
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1])
      .filter(Boolean),
  );
}

if (!(await exists(envPath))) {
  await copyFile(examplePath, envPath);
  console.log("Created .env from .env.example.");
} else {
  const [envRaw, exampleRaw] = await Promise.all([readFile(envPath, "utf8"), readFile(examplePath, "utf8")]);
  const existing = envKeys(envRaw);
  const missingLines = exampleRaw
    .split(/\r?\n/)
    .filter((line) => {
      const key = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1];
      return key && !existing.has(key);
    });

  if (missingLines.length === 0) {
    console.log(".env already exists and matches .env.example keys.");
  } else {
    await appendFile(envPath, `\n# Added by pnpm env:init\n${missingLines.join("\n")}\n`);
    console.log(`.env already exists; appended ${missingLines.length} missing key(s) from .env.example.`);
  }
}
