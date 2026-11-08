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

const roots: string[] = [];
const extensionSource = "// @peon-pet-managed-pi-extension\nexport default function () {}\n";

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "peon-pi-extension-"));
  roots.push(root);
  return root;
}

async function loadInstaller() {
  try {
    return await import("../src/app/pi-extension-installer.ts");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      return null;
    }
    throw error;
  }
}

describe("Pi Agent extension installer", () => {
  test("resolves PI_CODING_AGENT_DIR or the default user agent directory", async () => {
    const installer = await loadInstaller();
    expect(installer).not.toBeNull();
    if (!installer) return;
    expect(installer.piExtensionsDirectory("/home/vlad")).toBe("/home/vlad/.pi/agent/extensions");
    expect(installer.piExtensionsDirectory("/home/vlad", "/custom/pi-agent")).toBe(
      "/custom/pi-agent/extensions",
    );
  });

  test("install is idempotent and uninstall removes only the managed extension", async () => {
    const installer = await loadInstaller();
    expect(installer).not.toBeNull();
    if (!installer) return;
    const root = makeRoot();
    const first = installer.installPiExtension({ home: root, extensionSource });
    const second = installer.installPiExtension({ home: root, extensionSource });
    const installedPath = join(root, ".pi", "agent", "extensions", "peon-pet.ts");
    const unrelatedPath = join(root, ".pi", "agent", "extensions", "other.ts");
    writeFileSync(unrelatedPath, "export default () => {};\n");

    expect(first).toBe("installed");
    expect(second).toBe("already-installed");
    expect(readFileSync(installedPath, "utf8")).toBe(extensionSource);
    expect(installer.uninstallPiExtension({ home: root })).toBe(true);
    expect(existsSync(installedPath)).toBe(false);
    expect(existsSync(unrelatedPath)).toBe(true);
  });

  test("refuses to overwrite or remove an unrelated extension", async () => {
    const installer = await loadInstaller();
    expect(installer).not.toBeNull();
    if (!installer) return;
    const root = makeRoot();
    const target = join(root, ".pi", "agent", "extensions", "peon-pet.ts");
    await Bun.write(target, "export default () => 'user-owned';\n");

    expect(() => installer.installPiExtension({ home: root, extensionSource })).toThrow(/unrecognized/i);
    expect(() => installer.uninstallPiExtension({ home: root })).toThrow(/unrecognized/i);
    expect(await Bun.file(target).text()).toBe("export default () => 'user-owned';\n");
  });

  test("refuses to follow a managed-path symlink", async () => {
    const installer = await loadInstaller();
    expect(installer).not.toBeNull();
    if (!installer) return;
    const root = makeRoot();
    const directory = join(root, ".pi", "agent", "extensions");
    const target = join(directory, "peon-pet.ts");
    const outside = join(root, "outside.ts");
    await Bun.write(outside, "preserve\n");
    mkdirSync(directory, { recursive: true });
    symlinkSync(outside, target);

    expect(() => installer.installPiExtension({ home: root, extensionSource })).toThrow(/unrecognized/i);
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(readFileSync(outside, "utf8")).toBe("preserve\n");
  });

  test("launcher installs and removes the Pi extension without starting AppKit", () => {
    const root = makeRoot();
    const piAgentDir = join(root, "pi-agent");
    const launcher = fileURLToPath(new URL("../bin/peon-pet", import.meta.url));
    const environment = { ...process.env, PI_CODING_AGENT_DIR: piAgentDir };

    const installed = Bun.spawnSync(["bun", launcher, "pi", "install"], {
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
    });
    const managedPath = join(piAgentDir, "extensions", "peon-pet.ts");
    expect(installed.exitCode).toBe(0);
    expect(existsSync(managedPath)).toBe(true);
    expect(readFileSync(managedPath, "utf8")).toContain("registerPiLifecycleHandlers");

    const removed = Bun.spawnSync(["bun", launcher, "pi", "uninstall"], {
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(removed.exitCode).toBe(0);
    expect(existsSync(managedPath)).toBe(false);
  });
});
