import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

test("first startup generates protected one-time administrator credentials", () => {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "teachingroom-bootstrap-"));
  const dataDir = path.join(tempDir, "data");
  const dbPath = path.join(dataDir, "bootstrap.sqlite");

  try {
    const result = spawnSync(process.execPath, ["src/seed.js"], {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        DB_PATH: dbPath,
        INITIAL_ADMIN_PASSWORD: ""
      }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const credentialPath = path.join(dataDir, "initial-admin-password.txt");
    assert.equal(fs.statSync(credentialPath).mode & 0o777, 0o600);
    const credentialText = fs.readFileSync(credentialPath, "utf8");
    const password = credentialText.match(/^password=(.+)$/m)?.[1] || "";
    assert.ok(password.length >= 20);

    const bootstrapDb = new Database(dbPath, { readonly: true });
    const users = bootstrapDb.prepare("SELECT username, role, password_hash FROM users ORDER BY id").all();
    bootstrapDb.close();
    assert.equal(users.length, 1);
    assert.equal(users[0].username, "admin");
    assert.equal(users[0].role, "admin");
    assert.equal(bcrypt.compareSync(password, users[0].password_hash), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
