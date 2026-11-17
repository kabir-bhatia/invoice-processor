// Single entry point for all data access. Screens import `api` and nothing else.
// VITE_MOCK=1 swaps in the in-browser mock; otherwise calls go to /api (proxied to FastAPI).
import type { Api } from "./types";
import { httpApi } from "./http";
import { mockApi } from "./mock";

export const IS_MOCK = import.meta.env.VITE_MOCK === "1";
export const api: Api = IS_MOCK ? mockApi : httpApi;
export * from "./types";
