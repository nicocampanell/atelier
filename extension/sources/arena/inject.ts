// Adapted from Pond (MIT) apps/extension/sources/arena/inject.ts @ deb305e
import { emitHook, itemRequest } from "../_lib/emit";
import { installInterceptor, type RequestLens } from "../_lib/intercept";
import {
  asId,
  asText,
  at,
  firstHttpUrl,
  isRecord,
  type JsonRecord,
  type JsonValue,
  nonEmpty,
  parseJsonValue,
} from "../_lib/json";

const GRAPHQL_RE = /\/graphql(?:\?|$)/i;
const CONN_RE = /\/v2\/channels\/[^/]+\/connections(?:\?|$|\/)/;
const BLOCK_RE = /\/v2\/channels\/[^/]+\/blocks(?:\?|$|\/)/;

const SAVE_OPERATIONS = new Set([
  "ConnectCreateConnectionMutation",
  "CreateConnectionMutation",
  "ConnectableCreateConnectionMutation",
  "BlockCreateMutation",
  "CreateBlockMutation",
]);

const IMAGE_PATHS = [
  ["image", "original", "url"],
  ["image", "large", "url"],
  ["image", "display", "url"],
  ["image", "large", "src"],
  ["image", "src"],
  ["image", "url"],
  ["image", "thumb", "url"],
];

function asOperations(json: JsonValue | null): JsonRecord[] {
  if (Array.isArray(json)) return json.filter(isRecord);
  return isRecord(json) ? [json] : [];
}

function pickSaveOpFromRequest(ops: JsonRecord[]): JsonRecord | null {
  for (const op of ops) {
    const operation = asText(op.operationName);
    if (operation && SAVE_OPERATIONS.has(operation)) return op;
    if (at(op, "variables", "connectableId")) return op;
  }
  return null;
}

function pickSaveOpFromResponse(ops: JsonRecord[]): JsonRecord | null {
  for (const op of ops) {
    if (at(op, "data", "create_connection", "connectable", "id")) return op;
  }
  return null;
}

function emitBlock(blockId: string, block: JsonValue | undefined): void {
  emitHook(
    "arena",
    itemRequest(`https://www.are.na/block/${blockId}`, firstHttpUrl(block, IMAGE_PATHS), nonEmpty(at(block, "title"))),
    `arena:block:${blockId}`,
  );
}

export function inject(): void {
  const isInteresting = (url: string) => GRAPHQL_RE.test(url) || CONN_RE.test(url) || BLOCK_RE.test(url);

  installInterceptor({
    id: "arena",
    match: (req: RequestLens) => req.method === "POST" && isInteresting(req.url),
    async onResponse(req, res) {
      if (!res.ok) return;
      const text = await res.readText();
      if (GRAPHQL_RE.test(req.url)) {
        const requestOp = pickSaveOpFromRequest(asOperations(parseJsonValue(await req.readBody())));
        const responseOp = pickSaveOpFromResponse(asOperations(parseJsonValue(text)));
        if (!requestOp && !responseOp) return;
        const connectable = at(responseOp ?? undefined, "data", "create_connection", "connectable");
        const blockId = asId(at(connectable, "id")) ?? asId(at(requestOp ?? undefined, "variables", "connectableId"));
        if (blockId) emitBlock(blockId, connectable);
        return;
      }
      const json = parseJsonValue(text);
      if (!isRecord(json)) return;
      const block = json.block ?? json.connectable ?? (json.id ? json : null);
      const blockId = asId(at(block ?? undefined, "id"));
      if (blockId) emitBlock(blockId, block ?? undefined);
    },
  });
}
