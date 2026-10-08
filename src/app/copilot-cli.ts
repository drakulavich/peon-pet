import { parseCopilotHookEvent, type CopilotPetEvent } from "./copilot-events.ts";
import { copilotSocketPath, sendCopilotEvent } from "./copilot-ipc.ts";

export const MAX_COPILOT_HOOK_INPUT_BYTES = 64 * 1024;

export type CopilotHookDispatchResult = "delivered" | "invalid" | "unavailable";
export type CopilotEventSender = (socketPath: string, event: CopilotPetEvent) => Promise<boolean>;

export async function dispatchCopilotHook(
  hookName: string,
  input: string,
  socketPath = copilotSocketPath(),
  send: CopilotEventSender = sendCopilotEvent,
): Promise<CopilotHookDispatchResult> {
  if (Buffer.byteLength(input, "utf8") > MAX_COPILOT_HOOK_INPUT_BYTES) return "invalid";

  let payload: unknown;
  try {
    payload = JSON.parse(input);
  } catch {
    return "invalid";
  }
  const event = parseCopilotHookEvent(hookName, payload);
  if (!event) return "invalid";
  try {
    return (await send(socketPath, event)) ? "delivered" : "unavailable";
  } catch {
    return "unavailable";
  }
}
