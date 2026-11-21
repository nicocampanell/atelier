import { afterEach, describe, expect, it, vi } from "vitest";
import { resetInterceptors } from "../_lib/intercept";
import { fakeXhr, settle, setup } from "../_lib/testing";
import { inject } from "./inject";

afterEach(() => {
  resetInterceptors();
  vi.restoreAllMocks();
});

const gqlBody = JSON.stringify({
  operationName: "ConnectCreateConnectionMutation",
  variables: { connectableId: "555", connectableType: "BLOCK", channelId: "1" },
});
const gqlRes = JSON.stringify({
  data: {
    create_connection: {
      connectable: { id: 555, title: "Poster", image: { large: { url: "https://d2w9rnfcy7mm78.cloudfront.net/555/large.jpg" } } },
    },
  },
});

describe("are.na hook", () => {
  it("graphql fetch: one image event, response untouched", async () => {
    const { events, original } = setup({ body: gqlRes });
    inject();
    const res = await window.fetch("https://www.are.na/graphql", { method: "POST", body: gqlBody });
    expect(await res.text()).toBe(gqlRes);
    expect(original).toHaveBeenCalledTimes(1);
    await settle();
    expect(events).toEqual([
      {
        channel: "atelier.hook.v1",
        source: "arena",
        request: {
          kind: "image",
          imageUrl: "https://d2w9rnfcy7mm78.cloudfront.net/555/large.jpg",
          pageUrl: "https://www.are.na/block/555",
          title: "Poster",
        },
        dedupeKey: "arena:block:555",
      },
    ]);
  });

  it("graphql with only the request id falls back to a page event", async () => {
    const { events } = setup({ body: "{}" });
    inject();
    await window.fetch("https://www.are.na/graphql", { method: "POST", body: gqlBody });
    await settle();
    expect(events).toHaveLength(1);
    expect(events[0]?.request).toEqual({ kind: "page", url: "https://www.are.na/block/555" });
  });

  it("REST XHR connection create: one event", async () => {
    const res = JSON.stringify({ id: 77, title: "Note" });
    const { events } = setup({ body: res });
    fakeXhr({ body: res });
    inject();
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://api.are.na/v2/channels/my-channel/connections");
    xhr.send("{}");
    await settle();
    expect(events).toHaveLength(1);
    expect(events[0]?.dedupeKey).toBe("arena:block:77");
    expect(events[0]?.request).toEqual({ kind: "page", url: "https://www.are.na/block/77", title: "Note" });
  });

  it("ignores unrelated graphql and GETs", async () => {
    const { events } = setup({ body: JSON.stringify({ data: { me: { id: 1 } } }) });
    inject();
    await window.fetch("https://www.are.na/graphql", {
      method: "POST",
      body: JSON.stringify({ operationName: "ChannelQuery", variables: { id: "x" } }),
    });
    await window.fetch("https://www.are.na/graphql");
    await window.fetch("https://www.are.na/api/other", { method: "POST", body: gqlBody });
    await settle();
    expect(events).toHaveLength(0);
  });
});
