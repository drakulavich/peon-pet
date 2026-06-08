import { test, expect, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { acquireSingleInstance } from "../src/app/single-instance.ts";

const SOCK = `/tmp/peon-single-instance-test-${process.pid}.sock`;

afterAll(() => {
  try {
    if (existsSync(SOCK)) unlinkSync(SOCK);
  } catch {}
});

test("first acquire succeeds, second (same socket) bails", async () => {
  expect(await acquireSingleInstance(SOCK)).toBe(true);
  // The first listener is held alive, so a second attempt sees a live instance.
  expect(await acquireSingleInstance(SOCK)).toBe(false);
});

test("a stale socket file is reclaimed", async () => {
  // Simulate a leftover file with no listener behind it.
  const stale = `${SOCK}.stale`;
  await Bun.write(stale, "");
  expect(existsSync(stale)).toBe(true);
  expect(await acquireSingleInstance(stale)).toBe(true); // unlinks + claims
  try {
    unlinkSync(stale);
  } catch {}
});
