import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCopilotHookConfig,
  copilotHooksDirectory,
  installCopilotHooks,
  uninstallCopilotHooks,
} from "../src/app/copilot-hooks.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeHome(): string {
  const root = mkdtempSync(join(tmpdir(), "peon-copilot-hooks-"));
  roots.push(root);
  return root;
}

describe("Copilot hook configuration", () => {
  test("uses COPILOT_HOME when set and otherwise uses the home directory", () => {
    expect(copilotHooksDirectory("/home/vlad", "/custom/copilot")).toBe("/custom/copilot/hooks");
    expect(copilotHooksDirectory("/home/vlad", undefined)).toBe("/home/vlad/.copilot/hooks");
  });

  test("generates only supported lifecycle hooks with direct executable arguments", () => {
    const config = buildCopilotHookConfig("/opt/peon-pet/bin/peon-pet");
    expect(Object.keys(config.hooks)).toEqual([
      "sessionStart",
      "sessionEnd",
      "userPromptSubmitted",
      "permissionRequest",
      "postToolUseFailure",
      "preCompact",
      "agentStop",
      "subagentStart",
      "subagentStop",
    ]);
    expect(config.hooks.userPromptSubmitted).toEqual([
      {
        type: "command",
        exec: "/opt/peon-pet/bin/peon-pet",
        args: ["--copilot-hook", "userPromptSubmitted"],
        timeoutSec: 5,
      },
    ]);
  });

  test("install is idempotent and uninstall removes only Peon Pet's file", () => {
    const home = makeHome();
    const first = installCopilotHooks({
      home,
      executablePath: "/opt/peon-pet/bin/peon-pet",
    });
    const second = installCopilotHooks({
      home,
      executablePath: "/opt/peon-pet/bin/peon-pet",
    });
    const hooksDir = join(home, ".copilot", "hooks");
    const managedFile = join(hooksDir, "peon-pet.json");
    const otherFile = join(hooksDir, "other.json");
    writeFileSync(otherFile, "{}");

    expect(first).toBe("installed");
    expect(second).toBe("already-installed");
    expect(JSON.parse(readFileSync(managedFile, "utf8"))).toEqual(
      buildCopilotHookConfig("/opt/peon-pet/bin/peon-pet"),
    );
    expect(uninstallCopilotHooks({ home })).toBe(true);
    expect(existsSync(managedFile)).toBe(false);
    expect(existsSync(otherFile)).toBe(true);
  });

  test("install and uninstall honor COPILOT_HOME", () => {
    const root = makeHome();
    const copilotHome = join(root, "copilot-home");
    installCopilotHooks({
      home: root,
      copilotHome,
      executablePath: "/opt/peon-pet/bin/peon-pet",
    });
    const managedFile = join(copilotHome, "hooks", "peon-pet.json");

    expect(existsSync(managedFile)).toBe(true);
    expect(uninstallCopilotHooks({ home: root, copilotHome })).toBe(true);
    expect(existsSync(managedFile)).toBe(false);
  });

  test("launcher installs and removes hooks without starting AppKit", () => {
    const root = makeHome();
    const copilotHome = join(root, "copilot-home");
    const launcher = fileURLToPath(new URL("../bin/peon-pet", import.meta.url));
    const environment = { ...process.env, COPILOT_HOME: copilotHome };

    const installed = Bun.spawnSync(["bun", launcher, "copilot", "install"], {
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(installed.exitCode).toBe(0);
    expect(existsSync(join(copilotHome, "hooks", "peon-pet.json"))).toBe(true);

    const removed = Bun.spawnSync(["bun", launcher, "copilot", "uninstall"], {
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(removed.exitCode).toBe(0);
    expect(existsSync(join(copilotHome, "hooks", "peon-pet.json"))).toBe(false);
  });

  test("refuses to overwrite an unrelated file and leaves it unchanged", () => {
    const home = makeHome();
    const hooksDir = copilotHooksDirectory(home, undefined);
    const managedFile = join(hooksDir, "peon-pet.json");
    const original = JSON.stringify({ hooks: { sessionStart: "user data" } });
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(managedFile, original);

    expect(() =>
      installCopilotHooks({ home, executablePath: "/opt/peon-pet/bin/peon-pet" }),
    ).toThrow(/refusing to overwrite/i);
    expect(readFileSync(managedFile, "utf8")).toBe(original);
    expect(() => uninstallCopilotHooks({ home })).toThrow(/refusing to remove/i);
    expect(readFileSync(managedFile, "utf8")).toBe(original);
  });

  test("refuses to replace a dangling symlink at the managed path", () => {
    const home = makeHome();
    const hooksDir = copilotHooksDirectory(home, undefined);
    const managedFile = join(hooksDir, "peon-pet.json");
    mkdirSync(hooksDir, { recursive: true });
    symlinkSync(join(home, "outside.json"), managedFile);

    expect(() =>
      installCopilotHooks({ home, executablePath: "/opt/peon-pet/bin/peon-pet" }),
    ).toThrow(/refusing to overwrite/i);
    expect(lstatSync(managedFile).isSymbolicLink()).toBe(true);
  });
});
