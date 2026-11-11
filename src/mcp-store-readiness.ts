/**
 * Lets the MCP server answer the host's first request before the Store is open
 * (FR7.2). Every Store method waits for the open to finish; when it failed, the
 * call fails with the reason instead of staying silent or hanging. The Store
 * contract itself is unchanged: handlers keep calling `store.<method>()`.
 */
import { redactText } from "./redact.js";
import type { Store } from "./stores/types.js";

export type StoreReadinessState = "waiting" | "opening" | "ready" | "failed";

export class StoreNotReadyError extends Error {
  constructor(public readonly reason: string) {
    super(`memory store is not ready: ${reason}`);
    this.name = "StoreNotReadyError";
  }
}

export interface StoreReadiness {
  /** Behaves as the opened Store once ready; before that, each call waits. */
  store: Store;
  /** Starts opening the Store. Calling it again does nothing. */
  begin(): void;
  /** Resolves when the open has finished, whichever way. Never rejects. */
  settled(): Promise<void>;
  state(): StoreReadinessState;
  /** Closes the opened Store; does nothing when the open failed or never started. */
  close(): Promise<void>;
}

function failureReason(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error)).text;
}

export function createStoreReadiness(open: () => Promise<Store>): StoreReadiness {
  let state: StoreReadinessState = "waiting";
  let opened: Store | null = null;
  let reason = "";
  let release!: () => void;
  const settledPromise = new Promise<void>((resolve) => {
    release = resolve;
  });

  const begin = (): void => {
    if (state !== "waiting") return;
    state = "opening";
    open().then(
      (store) => {
        opened = store;
        state = "ready";
        release();
      },
      (error: unknown) => {
        reason = failureReason(error);
        state = "failed";
        release();
      },
    );
  };

  const store = new Proxy({} as Store, {
    get(_target, property) {
      if (typeof property === "symbol" || property === "then") return undefined;
      if (property === "backend") return opened?.backend;
      return async (...args: unknown[]): Promise<unknown> => {
        await settledPromise;
        if (opened === null) throw new StoreNotReadyError(reason);
        const method = (opened as unknown as Record<string, unknown>)[property];
        if (typeof method !== "function") throw new StoreNotReadyError(`unknown store method: ${property}`);
        return method.apply(opened, args);
      };
    },
  });

  return {
    store,
    begin,
    settled: () => settledPromise,
    state: () => state,
    close: async () => {
      if (state === "opening") await settledPromise;
      if (opened !== null) await opened.close();
    },
  };
}
