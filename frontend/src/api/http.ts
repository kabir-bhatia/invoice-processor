import type { Api, RunEvent } from "./types";

const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const httpApi: Api = {
  listInvoices: (tab, q) =>
    req(`/invoices?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ""}`),

  uploadInvoice: (file, source, filename) => {
    const fd = new FormData();
    fd.append("file", file, filename ?? (file instanceof File ? file.name : "capture.jpg"));
    fd.append("source", source);
    return req("/invoices", { method: "POST", body: fd });
  },

  listSamples: () => req("/samples"),
  runSample: (id) => req(`/samples/${id}/run`, { method: "POST" }),
  getInvoice: (id) => req(`/invoices/${id}`),

  subscribeRun: (id, onEvent) => {
    const es = new EventSource(`${BASE}/invoices/${id}/events`);
    const on = (type: RunEvent["type"]) => (e: MessageEvent) => {
      try {
        onEvent({ type, data: JSON.parse(e.data) } as RunEvent);
      } catch {
        /* ignore malformed frame */
      }
      if (type === "done") es.close();
    };
    es.addEventListener("stage", on("stage"));
    es.addEventListener("flag", on("flag"));
    es.addEventListener("decision", on("decision"));
    es.addEventListener("done", on("done"));
    // The server's own `error` event carries data; a transport error does not.
    es.addEventListener("error", (e) => {
      if ((e as MessageEvent).data) on("error")(e as MessageEvent);
    });
    return () => es.close();
  },

  act: (id, action, reason) => req(`/invoices/${id}/action`, json("POST", { action, reason: reason ?? "" })),
  sendVendorMessage: (id, subject, body) =>
    req(`/invoices/${id}/vendor-message/send`, json("POST", { subject, body })),
  patchField: (id, key, value) => req(`/invoices/${id}/fields`, json("PATCH", { key, value })),
  rerun: (id) => req(`/invoices/${id}/rerun`, { method: "POST" }),

  getDashboard: () => req("/dashboard"),
  getRules: () => req("/settings/rules"),
  putRules: (r) => req("/settings/rules", json("PUT", r)),
  listVendors: () => req("/vendors"),
  patchVendor: (id, body) => req(`/vendors/${id}`, json("PATCH", body)),
  listPOs: () => req("/procurement/pos"),
  listPastInvoices: () => req("/procurement/invoices"),
  resetDemo: () => req("/demo/reset", { method: "POST" }),
  getGmail: () => req("/integrations/gmail"),
  putGmail: (body) => req("/integrations/gmail", json("PUT", body)),
  checkGmail: () => req("/integrations/gmail/check", { method: "POST" }),
};
