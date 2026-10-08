import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { configDir } from "./config.ts";
import { validateCopilotPetEvent, type CopilotPetEvent } from "./copilot-events.ts";

export const MAX_COPILOT_MESSAGE_BYTES = 16 * 1024;
const FRAME_TIMEOUT_MS = 2000;
const ACK = '{"ok":true}\n';
const NACK = '{"ok":false}\n';

export function copilotSocketPath(): string {
  return join(configDir(), "copilot-ipc", "events.sock");
}

export async function sendCopilotEvent(socketPath: string, event: CopilotPetEvent): Promise<boolean> {
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(ok);
    };
    const timeout = setTimeout(() => finish(false), 2000);

    Bun.connect({
      unix: socketPath,
      socket: {
        open(socket) {
          socket.write(`${JSON.stringify(event)}\n`);
        },
        data(socket, data) {
          const response = Buffer.from(data).toString("utf8").trim();
          finish(response === '{"ok":true}');
          socket.end();
        },
        close() {
          finish(false);
        },
        error() {
          finish(false);
        },
      },
    }).catch(() => finish(false));
  });
}

export async function listenForCopilotEvents(
  socketPath: string,
  onEvent: (event: CopilotPetEvent) => void,
): Promise<{ close(): void }> {
  const directory = dirname(socketPath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const dirStat = lstatSync(directory);
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory() || dirStat.uid !== process.getuid()) {
    throw new Error(`Unsafe Copilot IPC directory: ${directory}`);
  }
  chmodSync(directory, 0o700);

  if (existsSync(socketPath)) {
    const existingStat = lstatSync(socketPath);
    if (!existingStat.isSocket() || existingStat.uid !== process.getuid()) {
      throw new Error(`Refusing to replace an unrecognized Copilot IPC path: ${socketPath}`);
    }
    let active = false;
    try {
      const connection = await Bun.connect({
        unix: socketPath,
        socket: { data() {}, error() {} },
      });
      connection.end();
      active = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ECONNREFUSED" && code !== "ENOENT") {
        throw new Error(`Could not check existing Copilot IPC socket: ${socketPath}`, { cause: error });
      }
    }
    if (active) throw new Error(`Copilot IPC socket is already in use: ${socketPath}`);
    unlinkSync(socketPath);
  }

  const buffers = new WeakMap<object, string>();
  const frameTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();
  const armFrameTimeout = (socket: object & { write(data: string): number; end(): void }) => {
    const existingTimer = frameTimers.get(socket);
    if (existingTimer) clearTimeout(existingTimer);
    frameTimers.set(
      socket,
      setTimeout(() => {
        socket.write(NACK);
        socket.end();
      }, FRAME_TIMEOUT_MS),
    );
  };
  const respond = (socket: object & { write(data: string): number; end(): void }, response: string) => {
    const timer = frameTimers.get(socket);
    if (timer) clearTimeout(timer);
    socket.write(response);
    socket.end();
  };
  const server = Bun.listen({
    unix: socketPath,
    socket: {
      open(socket) {
        armFrameTimeout(socket);
      },
      data(socket, data) {
        const text = (buffers.get(socket) ?? "") + Buffer.from(data).toString("utf8");
        if (Buffer.byteLength(text) > MAX_COPILOT_MESSAGE_BYTES) {
          respond(socket, NACK);
          return;
        }
        const newline = text.indexOf("\n");
        if (newline === -1) {
          buffers.set(socket, text);
          armFrameTimeout(socket);
          return;
        }
        if (text.slice(newline + 1).trim()) {
          respond(socket, NACK);
          return;
        }

        let raw: unknown;
        try {
          raw = JSON.parse(text.slice(0, newline));
        } catch {
          respond(socket, NACK);
          return;
        }
        const event = validateCopilotPetEvent(raw);
        if (!event) {
          respond(socket, NACK);
          return;
        }
        try {
          onEvent(event);
          respond(socket, ACK);
        } catch (error) {
          console.error("peon-pet: failed to handle Copilot event", error);
          respond(socket, NACK);
        }
      },
      close(socket) {
        const timer = frameTimers.get(socket);
        if (timer) clearTimeout(timer);
      },
    },
  });
  chmodSync(socketPath, 0o600);

  return {
    close() {
      server.stop(true);
      if (existsSync(socketPath)) unlinkSync(socketPath);
    },
  };
}
