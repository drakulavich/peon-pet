import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  unlinkSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listenForCopilotEvents, sendCopilotEvent } from "../src/app/copilot-ipc.ts";
import { copilotSessionId } from "../src/app/copilot-events.ts";

let directory: string;
let socketPath: string;
let closeServer: (() => void) | undefined;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "peon-copilot-ipc-"));
  chmodSync(directory, 0o700);
  socketPath = join(directory, "events.sock");
});

afterEach(() => {
  closeServer?.();
  closeServer = undefined;
  if (existsSync(socketPath)) unlinkSync(socketPath);
  rmdirSync(directory);
});

describe("Copilot event socket", () => {
  test("delivers only validated, allowlisted event fields and uses private permissions", async () => {
    const received: unknown[] = [];
    const server = await listenForCopilotEvents(socketPath, (event) => received.push(event));
    closeServer = () => server.close();
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(socketPath).mode & 0o777).toBe(0o600);

    const delivered = await sendCopilotEvent(socketPath, {
      kind: "session",
      sessionId: copilotSessionId("session-1"),
      event: "UserPromptSubmit",
      cwd: "/Users/vlad/project",
      timestamp: 1_800_000_000_000,
    });

    expect(delivered).toBe(true);
    expect(received).toEqual([
      {
        kind: "session",
        sessionId: copilotSessionId("session-1"),
        event: "UserPromptSubmit",
        cwd: "/Users/vlad/project",
        timestamp: 1_800_000_000_000,
      },
    ]);
  });

  test("rejects malformed IPC JSON without delivering an event", async () => {
    const received: unknown[] = [];
    const server = await listenForCopilotEvents(socketPath, (event) => received.push(event));
    closeServer = () => server.close();

    expect(await sendRaw("not-json\n")).toBe('{"ok":false}');
    expect(received).toEqual([]);
  });

  test("rejects oversized IPC messages", async () => {
    const received: unknown[] = [];
    const server = await listenForCopilotEvents(socketPath, (event) => received.push(event));
    closeServer = () => server.close();

    expect(await sendRaw(`${"x".repeat(17 * 1024)}\n`)).toBe('{"ok":false}');
    expect(received).toEqual([]);
  });

  test("refuses to replace a non-socket file at the IPC path", async () => {
    writeFileSync(socketPath, "preserve me");
    await expect(listenForCopilotEvents(socketPath, () => {})).rejects.toThrow(/unrecognized/i);
    expect(readFileSync(socketPath, "utf8")).toBe("preserve me");
  });
});

function sendRaw(message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let response = "";
    const timeout = setTimeout(() => reject(new Error("raw IPC response timed out")), 1500);
    const finish = (value: string) => {
      clearTimeout(timeout);
      resolve(value);
    };
    Bun.connect({
      unix: socketPath,
      socket: {
        open(socket) {
          const chunks = [message.slice(0, 8192), message.slice(8192, 16384), message.slice(16384)];
          socket.write(chunks[0]);
          setTimeout(() => {
            socket.write(chunks[1]);
            setTimeout(() => socket.write(chunks[2]), 10);
          }, 10);
        },
        data(socket, data) {
          response += Buffer.from(data).toString("utf8");
          finish(response.trim());
          socket.end();
        },
        close() {
          if (response) finish(response.trim());
        },
        error(_socket, error) {
          clearTimeout(timeout);
          reject(error);
        },
      },
    }).catch((error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
