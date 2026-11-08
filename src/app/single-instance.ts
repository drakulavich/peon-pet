// Single-instance guard via a Unix domain socket. If another instance is already
// listening, we bail; a stale socket file from a crash is cleaned up and reclaimed.

import { existsSync, unlinkSync } from "node:fs";

export const DEFAULT_SOCKET_PATH = "/tmp/peon-pet.sock";

let held: unknown = null; // keep the listener alive for the process lifetime

export async function acquireSingleInstance(socketPath = DEFAULT_SOCKET_PATH): Promise<boolean> {
  // Is a live instance already listening on the socket?
  try {
    const sock = await Bun.connect({
      unix: socketPath,
      socket: { data() {}, error() {} },
    });
    sock.end();
    return false; // someone answered → another instance is alive
  } catch {
    // Nobody answered. Remove any stale socket file before claiming it.
    try {
      if (existsSync(socketPath)) unlinkSync(socketPath);
    } catch {}
  }

  try {
    held = Bun.listen({
      unix: socketPath,
      socket: { data() {}, open() {}, error() {} },
    });
    return true;
  } catch {
    return false;
  }
}
