/**
 * SDK barrel exports for the Agent Integrity Protocol.
 *
 * Provides the public surface of the SDK: client factory,
 * client interface, and HTTP signing utilities.
 */

export { createClient } from "./client.js";
export type { AIPClient } from "./client.js";
export { signPayload, verifySignature } from "./http.js";
