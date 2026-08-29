// Issue #520: use a published SDK the way a real user would, not internal
// APIs. This module now goes through @trident-indexer/sdk's TridentClient
// (real retry/backoff, Zod response validation, typed errors, and a
// per-attempt timeout) instead of a hand-rolled fetchWithTimeout — the
// timeout the wrapper used to enforce now lives in the SDK itself, so every
// SDK consumer gets it rather than just this app. The SDK is not published to npm yet, so
// package.json references it via a local `file:` dependency
// (file:../sdk/typescript) until it is; swap that for a real version range
// once #517/#429 land a published release.
//
// The SDK's own types are camelCase (contractId, ledgerSequence, ...) to
// match its own conventions, while every .astro page in this app was
// written against the raw REST API's snake_case JSON shape (contract_id,
// ledger_sequence, ...). Translating at this one boundary — rather than
// migrating every field access across index.astro, contract/[address]/
// index.astro, and contract/[address]/event/[id].astro (including inline
// client-side <script> blocks that re-fetch this same shape from
// /api/events.json) — gets the real behavioral benefit (actual retry
// logic, actual response validation) without a large, higher-risk
// find-and-rename across presentation code this session can't visually
// verify rendered correctly.

import { TridentClient, type SorobanEvent as SdkSorobanEvent } from "@trident-indexer/sdk";
import type { SorobanEvent, ListEventsResponse, Network } from "./types";

const TESTNET_URL =
  import.meta.env.TRIDENT_TESTNET_API_URL ?? "https://api.testnet.trident.dev";
const MAINNET_URL =
  import.meta.env.TRIDENT_MAINNET_API_URL ?? "https://api.mainnet.trident.dev";
const API_KEY: string = import.meta.env.EXPLORER_API_KEY ?? "";

/**
 * Per-request timeout handed to the SDK. Pages render this figure in their
 * timeout error state, so it is exported rather than duplicated as a literal —
 * the previous hand-rolled client hardcoded 30s in both places and the two
 * drifted apart the moment the fetch wrapper was replaced.
 */
export const TRIDENT_TIMEOUT_MS = 30_000;

function apiUrlFor(network: Network): string {
  return network === "mainnet" ? MAINNET_URL : TESTNET_URL;
}

const clientCache = new Map<Network, TridentClient>();

function clientFor(network: Network): TridentClient {
  const cached = clientCache.get(network);
  if (cached) return cached;

  const client = new TridentClient({
    apiUrl: apiUrlFor(network),
    apiKey: API_KEY || undefined,
    network,
    timeoutMs: TRIDENT_TIMEOUT_MS,
  });
  clientCache.set(network, client);
  return client;
}

function toSnakeCaseEvent(event: SdkSorobanEvent): SorobanEvent {
  return {
    id: event.id,
    contract_id: event.contractId,
    ledger_sequence: event.ledgerSequence,
    ledger_timestamp: event.ledgerTimestamp,
    transaction_hash: event.transactionHash,
    event_index: event.eventIndex,
    event_type: event.eventType,
    topics: event.topics,
    data: typeof event.data === "string" ? event.data : JSON.stringify(event.data),
    created_at: event.createdAt,
  };
}

export interface QueryEventsParams {
  contractId?: string;
  topic0?: string;
  ledgerFrom?: number;
  ledgerTo?: number;
  cursor?: string;
  limit?: number;
  network?: Network;
}

export async function listEvents(
  params: QueryEventsParams = {},
): Promise<ListEventsResponse> {
  const network: Network = params.network ?? "testnet";
  const client = clientFor(network);

  const result = await client.queryEvents({
    contractId: params.contractId,
    topic0: params.topic0,
    ledgerFrom: params.ledgerFrom,
    ledgerTo: params.ledgerTo,
    after: params.cursor,
    limit: params.limit ?? 25,
  });

  return {
    events: result.events.map(toSnakeCaseEvent),
    has_more: result.hasMore,
    next_cursor: result.cursor,
  };
}

export async function getEvent(
  id: string,
  network: Network = "testnet",
): Promise<SorobanEvent> {
  const client = clientFor(network);
  const event = await client.getEventById({ id });
  return toSnakeCaseEvent(event);
}
