import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const VERSION = "v22.23.1";
const TOOLCHAIN_DIR = resolve(ROOT, ".toolchain");

function nodeArchive() {
  if (process.platform === "win32" && process.arch === "x64") {
    return {
      url: `https://nodejs.org/dist/${VERSION}/node-${VERSION}-win-x64.zip`,
      folder: `node-${VERSION}-win-x64`,
      binDir: resolve(TOOLCHAIN_DIR, `node-${VERSION}-win-x64`),
      archivePath: resolve(TOOLCHAIN_DIR, `node-${VERSION}-win-x64.zip`),
    };
  }

  if (process.platform === "linux" && process.arch === "x64") {
    return {
      url: `https://nodejs.org/dist/${VERSION}/node-${VERSION}-linux-x64.tar.xz`,
      folder: `node-${VERSION}-linux-x64`,
      binDir: resolve(TOOLCHAIN_DIR, `node-${VERSION}-linux-x64`),
      archivePath: resolve(TOOLCHAIN_DIR, `node-${VERSION}-linux-x64.tar.xz`),
    };
  }

  throw new Error(`Unsupported platform for automatic Node install: ${process.platform}/${process.arch}`);
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: "inherit",
      shell: false,
    });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? 1}`));
    });
  });
}

async function download(url, outPath) {
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Could not download ${url}: HTTP ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(outPath));
}

async function extract(archive) {
  if (process.platform === "win32") {
    const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
    await run("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath ${quote(archive.archivePath)} -DestinationPath ${quote(TOOLCHAIN_DIR)} -Force`,
    ]);
    return;
  }

  await run("tar", ["-xJf", archive.archivePath, "-C", TOOLCHAIN_DIR]);
}

async function main() {
  const archive = nodeArchive();
  const nodeExe = process.platform === "win32" ? resolve(archive.binDir, "node.exe") : resolve(archive.binDir, "bin", "node");
  if (existsSync(nodeExe)) {
    console.log(`Node ${VERSION} already installed at ${archive.binDir}`);
    return;
  }

  await mkdir(TOOLCHAIN_DIR, { recursive: true });
  await rm(archive.archivePath, { force: true });
  await rm(archive.binDir, { recursive: true, force: true });
  await download(archive.url, archive.archivePath);
  console.log(`Extracting ${basename(archive.archivePath)}`);
  await extract(archive);
  if (!existsSync(nodeExe)) {
    throw new Error(`Node executable was not found after extraction: ${nodeExe}`);
  }
  console.log(`Installed Node ${VERSION} at ${archive.binDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
