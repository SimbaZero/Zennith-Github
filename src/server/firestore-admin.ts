// Server-only Firestore access for Worker code (cron jobs, webhooks).
//
// The browser SDK in src/firebase.ts acts as whoever is signed in, so
// firestore.rules apply to it. A cron run or an SMSPortal webhook has no
// signed-in user, and the rules reject anonymous reads of appointments and
// patients. The Worker therefore authenticates as a Google service account
// (FIREBASE_SERVICE_ACCOUNT) and uses the Firestore REST API, which is also
// the only Firestore client that runs cleanly on Workers.
import { readEnv } from "./env";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export type FirestoreData = Record<string, unknown>;

export interface FirestoreDoc {
  id: string;
  data: FirestoreData;
  /** The document's version, for pinning a later write to what was read. */
  updateTime?: string;
}

/** A conditional write lost to a concurrent change; re-read and decide again. */
export class WriteConflict extends Error {}

export interface WriteOptions {
  /** Fields to set; a listed field missing from `data` is deleted. Omit to replace the whole document. */
  mask?: string[];
  /** Only write if the document is still at this version, or does / doesn't exist. */
  precondition?: { updateTime: string } | { exists: boolean };
}

export interface FieldFilter {
  field: string;
  op: "EQUAL" | "IN" | "GREATER_THAN_OR_EQUAL" | "LESS_THAN";
  value: unknown;
}

export type FirestoreWrite =
  | { update: [collection: string, id: string]; data: FirestoreData; appendToArrays?: Record<string, unknown[]> }
  | { create: string; data: FirestoreData }
  /** Replaces the whole document, optionally only if it's still at a known version. */
  | { set: [collection: string, id: string]; data: FirestoreData; precondition?: WriteOptions["precondition"] };

type RestValue = Record<string, unknown>;

interface RestDocument {
  name: string;
  fields?: Record<string, RestValue>;
  updateTime?: string;
}

export class FirestoreConfigError extends Error {}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATASTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

// Access tokens last an hour; reuse them across requests in the same isolate.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function firestoreAdminFromEnv(env: unknown): FirestoreAdmin {
  const raw = readEnv(env, "FIREBASE_SERVICE_ACCOUNT");
  if (!raw) throw new FirestoreConfigError("FIREBASE_SERVICE_ACCOUNT is not set");

  let account: Partial<ServiceAccount>;
  try {
    account = JSON.parse(raw) as Partial<ServiceAccount>;
  } catch {
    throw new FirestoreConfigError("FIREBASE_SERVICE_ACCOUNT is not valid JSON");
  }
  if (!account.project_id || !account.client_email || !account.private_key) {
    throw new FirestoreConfigError(
      "FIREBASE_SERVICE_ACCOUNT must include project_id, client_email and private_key",
    );
  }
  return new FirestoreAdmin(account as ServiceAccount);
}

export class FirestoreAdmin {
  private readonly documentsUrl: string;

  /** Outbound requests made so far (token exchanges included), for subrequest budgeting. */
  requestCount = 0;

  constructor(private readonly account: ServiceAccount) {
    this.documentsUrl = `https://firestore.googleapis.com/v1/projects/${account.project_id}/databases/(default)/documents`;
  }

  /** The Firebase project this service account belongs to. */
  get projectId(): string {
    return this.account.project_id;
  }

  async get(collection: string, id: string): Promise<FirestoreDoc | null> {
    const res = await this.request(`${this.docUrl(collection, id)}`, { method: "GET" }, [404]);
    if (res.status === 404) return null;
    return fromRestDocument((await res.json()) as RestDocument);
  }

  async query(collection: string, filters: FieldFilter[]): Promise<FirestoreDoc[]> {
    const fieldFilters = filters.map((f) => ({
      fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: encodeValue(f.value) },
    }));
    const where =
      fieldFilters.length === 0
        ? undefined
        : fieldFilters.length === 1
          ? fieldFilters[0]
          : { compositeFilter: { op: "AND", filters: fieldFilters } };

    const res = await this.request(`${this.documentsUrl}:runQuery`, {
      method: "POST",
      body: JSON.stringify({
        structuredQuery: { from: [{ collectionId: collection }], ...(where ? { where } : {}) },
      }),
    });
    // runQuery answers with one entry per result; an empty result is a single
    // entry with only a readTime.
    const rows = (await res.json()) as Array<{ document?: RestDocument }>;
    return rows.flatMap((row) => (row.document ? [fromRestDocument(row.document)] : []));
  }

  /** Reads several documents from one collection in a single request. Missing IDs are absent from the map. */
  async getMany(collection: string, ids: string[]): Promise<Map<string, FirestoreDoc>> {
    const found = new Map<string, FirestoreDoc>();
    const unique = [...new Set(ids)];
    if (unique.length === 0) return found;

    const res = await this.request(`${this.documentsUrl}:batchGet`, {
      method: "POST",
      body: JSON.stringify({ documents: unique.map((id) => this.docName(collection, id)) }),
    });
    const rows = (await res.json()) as Array<{ found?: RestDocument }>;
    for (const row of rows) {
      if (row.found) {
        const doc = fromRestDocument(row.found);
        found.set(doc.id, doc);
      }
    }
    return found;
  }

  /**
   * Applies several writes atomically in one request and returns each
   * document's new version. `update` sets only the given fields on an
   * existing document; `appendToArrays` adds values to array fields the way
   * arrayUnion does, so concurrent runs can't drop each other's entries.
   * `create` makes a new document with an auto ID. `set` replaces a document,
   * optionally pinned to a version. If any precondition fails, nothing is
   * written and WriteConflict is thrown.
   */
  async commit(writes: FirestoreWrite[]): Promise<string[]> {
    const res = await this.request(
      `${this.documentsUrl}:commit`,
      { method: "POST", body: JSON.stringify({ writes: writes.map((write) => this.toRestWrite(write)) }) },
      [400, 404, 409],
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status !== 400 || /FAILED_PRECONDITION/.test(detail)) throw new WriteConflict(`commit: ${res.status}`);
      throw new Error(`Firestore POST ${res.status}: ${detail.slice(0, 300)}`);
    }
    const body = (await res.json()) as { writeResults?: Array<{ updateTime?: string }> };
    return (body.writeResults ?? []).map((result) => result.updateTime ?? "");
  }

  /**
   * Writes one document at a known ID and returns its new version. With a
   * precondition, a write that lost a race throws WriteConflict instead of
   * overwriting the other change.
   */
  async write(collection: string, id: string, data: FirestoreData, options: WriteOptions = {}): Promise<string> {
    const params = new URLSearchParams();
    for (const field of options.mask ?? []) params.append("updateMask.fieldPaths", quoteFieldPath(field));
    const pre = options.precondition;
    if (pre && "updateTime" in pre) params.set("currentDocument.updateTime", pre.updateTime);
    if (pre && "exists" in pre) params.set("currentDocument.exists", String(pre.exists));
    const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    const query = params.toString();

    const res = await this.request(
      `${this.docUrl(collection, id)}${query ? `?${query}` : ""}`,
      { method: "PATCH", body: JSON.stringify({ fields: encodeFields(defined) }) },
      pre ? [400, 404, 409] : [],
    );
    if (!res.ok) {
      // Only reachable with a precondition: a version mismatch is
      // FAILED_PRECONDITION (400), exists:false on an existing doc is 409, and
      // a doc deleted since it was read is 404.
      const detail = await res.text().catch(() => "");
      if (res.status !== 400 || /FAILED_PRECONDITION/.test(detail)) {
        throw new WriteConflict(`${collection}/${id}: ${res.status}`);
      }
      throw new Error(`Firestore PATCH ${res.status}: ${detail.slice(0, 300)}`);
    }
    return ((await res.json()) as RestDocument).updateTime ?? "";
  }

  private toRestWrite(write: FirestoreWrite) {
    const data = Object.fromEntries(Object.entries(write.data).filter(([, v]) => v !== undefined));
    if ("create" in write) {
      return {
        update: { name: this.docName(write.create, autoId()), fields: encodeFields(data) },
        currentDocument: { exists: false },
      };
    }
    if ("set" in write) {
      const [collection, id] = write.set;
      return {
        update: { name: this.docName(collection, id), fields: encodeFields(data) },
        ...(write.precondition ? { currentDocument: write.precondition } : {}),
      };
    }
    const [collection, id] = write.update;
    return {
      update: { name: this.docName(collection, id), fields: encodeFields(data) },
      updateMask: { fieldPaths: Object.keys(data).map(quoteFieldPath) },
      updateTransforms: Object.entries(write.appendToArrays ?? {}).map(([field, values]) => ({
        fieldPath: quoteFieldPath(field),
        appendMissingElements: { values: values.map(encodeValue) },
      })),
      currentDocument: { exists: true },
    };
  }

  private docName(collection: string, id: string) {
    return `projects/${this.account.project_id}/databases/(default)/documents/${collection}/${id}`;
  }

  private docUrl(collection: string, id: string) {
    return `${this.documentsUrl}/${collection}/${encodeURIComponent(id)}`;
  }

  private async request(url: string, init: RequestInit, allowedStatuses: number[] = []) {
    const token = await this.accessToken();
    this.requestCount++;
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok && !allowedStatuses.includes(res.status)) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Firestore ${init.method} ${res.status}: ${detail.slice(0, 300)}`);
    }
    return res;
  }

  private async accessToken(): Promise<string> {
    const cached = tokenCache.get(this.account.client_email);
    if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

    this.requestCount++;
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: await signServiceAccountJwt(this.account),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Google token exchange failed ${res.status}: ${detail.slice(0, 300)}`);
    }
    const { access_token, expires_in } = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    tokenCache.set(this.account.client_email, {
      token: access_token,
      expiresAt: Date.now() + expires_in * 1000,
    });
    return access_token;
  }
}

async function signServiceAccountJwt(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: account.client_email,
    scope: DATASTORE_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const encoder = new TextEncoder();
  const unsigned = `${base64Url(encoder.encode(JSON.stringify(header)))}.${base64Url(
    encoder.encode(JSON.stringify(claims)),
  )}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

function pemToDer(pem: string): ArrayBuffer {
  // Keys pasted into a secret often keep the JSON "\n" escapes literally.
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i);
  return der.buffer;
}

const AUTO_ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A 20-character random document ID, like the SDK generates for addDoc. */
function autoId(): string {
  let id = "";
  while (id.length < 20) {
    for (const byte of crypto.getRandomValues(new Uint8Array(40))) {
      // 248 = 4 * 62: dropping higher bytes keeps every character equally likely.
      if (byte < 248 && id.length < 20) id += AUTO_ID_CHARS[byte % 62];
    }
  }
  return id;
}

/** Field paths that aren't plain identifiers must be backtick-quoted. */
function quoteFieldPath(field: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(field) ? field : `\`${field.replace(/[`\\]/g, "\\$&")}\``;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromRestDocument(doc: RestDocument): FirestoreDoc {
  return { id: doc.name.split("/").pop() ?? "", data: decodeFields(doc.fields ?? {}), updateTime: doc.updateTime };
}

function encodeFields(data: FirestoreData): Record<string, RestValue> {
  const fields: Record<string, RestValue> = {};
  for (const [key, value] of Object.entries(data)) {
    // Matches the SDK's ignoreUndefinedProperties behaviour rather than failing.
    if (value !== undefined) fields[key] = encodeValue(value);
  }
  return fields;
}

function encodeValue(value: unknown): RestValue {
  if (value === null || value === undefined) return { nullValue: "NULL_VALUE" };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") return { mapValue: { fields: encodeFields(value as FirestoreData) } };
  throw new TypeError(`Cannot store a ${typeof value} in Firestore`);
}

function decodeFields(fields: Record<string, RestValue>): FirestoreData {
  const data: FirestoreData = {};
  for (const [key, value] of Object.entries(fields)) data[key] = decodeValue(value);
  return data;
}

function decodeValue(value: RestValue): unknown {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  // Kept as the ISO string; nothing here needs a Date object.
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) {
    const values = (value.arrayValue as { values?: RestValue[] }).values ?? [];
    return values.map(decodeValue);
  }
  if ("mapValue" in value) {
    return decodeFields((value.mapValue as { fields?: Record<string, RestValue> }).fields ?? {});
  }
  if ("referenceValue" in value) return value.referenceValue;
  if ("geoPointValue" in value) return value.geoPointValue;
  if ("bytesValue" in value) return value.bytesValue;
  return undefined;
}
