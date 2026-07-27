// Copies .env.example to .env (frontend: .env.local) in the given directory
// unless one already exists. Used by the root `setup` scripts.
import * as fs from "node:fs";
import * as path from "node:path";

const targetDir = process.argv[2]?.trim();

if (!targetDir) {
  console.error("Please provide a directory path as an argument.");
  process.exit(1);
}

const examplePath = path.join(targetDir, ".env.example");
const isFrontend = fs.existsSync(path.join(targetDir, "next.config.ts"));
const envPath = path.join(targetDir, isFrontend ? ".env.local" : ".env");

if (!fs.existsSync(examplePath)) {
  console.error(`.env.example file does not exist in ${targetDir}`);
  process.exit(1);
}

if (fs.existsSync(envPath)) {
  console.log(`${envPath} already exists, no action taken.`);
} else {
  fs.copyFileSync(examplePath, envPath);
  console.log(`.env.example has been copied to ${envPath}`);
}
