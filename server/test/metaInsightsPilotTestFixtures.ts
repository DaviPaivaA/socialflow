import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import type { SimulationHttpsRequest } from "../experiments/metaInsightsBatchHttpsExecutor.ts";

export const PILOT_NOW = Date.parse("2026-10-22T12:00:00Z");
export const PILOT_QUERY = { pageId: "123456", graphApiVersion: "v26.0", metric: "page_media_view", period: "day",
  since: 1792454400, until: 1792540800 } as const;
export const PILOT_CREDENTIAL = { tokenKind: "page", accessToken: "SYNTHETIC_PAGE_10C", appSecret: "SYNTHETIC_SECRET_10C" } as const;
export const PILOT_DATA = { data: [{ name: "page_media_view", period: "day", values: [
  { value: 0, end_time: "2026-10-21T00:00:00+0000" },
] }] };
export const pilotBatch = (body: unknown = PILOT_DATA, code = 200) => JSON.stringify([{ code, headers: [], body: JSON.stringify(body) }]);

export function pilotWire(scenario: { status?: number; text?: string; errorCode?: string; hold?: boolean;
  noClose?: boolean; large?: boolean; abruptClose?: boolean } = {}) {
  let calls = 0;
  let start!: () => void;
  let close!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const closed = new Promise<void>(resolve => { close = resolve; });
  let options: RequestOptions | undefined;
  let bytes: Buffer | undefined;
  let response: PassThrough | undefined;
  let callback: ((r: IncomingMessage) => void) | undefined;
  const outgoing = Object.assign(new EventEmitter(), { destroyed: false,
    end(body: Buffer) { bytes = Buffer.from(body); queueMicrotask(() => {
      start(); if (outgoing.destroyed || scenario.hold) return;
      if (scenario.errorCode) { outgoing.emit("error", Object.assign(new Error("SENSITIVE_IO"), { code: scenario.errorCode })); return; }
      if (scenario.abruptClose) { outgoing.destroy(); return; }
      deliver();
      response!.end(scenario.large ? Buffer.alloc(1048577) : scenario.text ?? pilotBatch());
    }); },
    destroy() { if (outgoing.destroyed) return; outgoing.destroyed = true;
      if (!scenario.noClose) queueMicrotask(() => { outgoing.emit("close"); close(); }); },
  });
  const deliver = () => { response = Object.assign(new PassThrough(), { statusCode: scenario.status ?? 200,
    headers: {}, socket: { encrypted: true, authorized: true } }); callback!(response as unknown as IncomingMessage); };
  const request: SimulationHttpsRequest = (input, cb) => { calls++; options = input; callback = cb; return outgoing as unknown as ClientRequest; };
  return { request, started, closed, outgoing, deliverLate: deliver,
    closeNow() { outgoing.emit("close"); close(); },
    get calls() { return calls; }, get options() { return options!; }, get bytes() { return bytes!; }, get response() { return response; },
  };
}
export async function awaitPilotDispatch(wire: ReturnType<typeof pilotWire>, result: Promise<unknown>) {
  await Promise.race([wire.started, result.then(() => { throw Error("driver_not_started"); }, () => { throw Error("driver_not_started"); })]);
}
