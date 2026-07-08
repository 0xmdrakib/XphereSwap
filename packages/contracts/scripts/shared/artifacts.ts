import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DeploymentArtifact } from "./config";

export function repoRootFromContractsScript(scriptDir: string): string {
  return resolve(scriptDir, "../../..");
}

export async function readDeploymentArtifact(path: string): Promise<DeploymentArtifact | null> {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8")) as DeploymentArtifact;
}

export async function writeDeploymentArtifact(path: string, artifact: DeploymentArtifact): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`);
}
