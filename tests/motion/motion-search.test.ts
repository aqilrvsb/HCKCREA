// Run: npx tsx --tsconfig tsconfig.json --test tests/motion/motion-search.test.ts
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  runCascade,
  filterImageHits,
  parseMotionSearchSettings,
  cacheKey,
  normalizeQuery,
  cleanQuery,
  searchImages,
  searchWeb,
  motionSearchConfigured,
  __setMotionSearchDeps,
  type FetchLike,
  type SearchProviderCfg,
} from "@/lib/motion-search";

type Call = { url: string; init?: RequestInit };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Mock fetch that routes by host and records every call. */
function mockFetch(routes: Record<string, (c: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const host = new URL(url).hostname;
    const h = routes[host];
    if (!h) throw new Error(`unexpected fetch to ${host}`);
    return h({ url, init });
  };
  return { fn, calls };
}

const SERPER_IMAGES = {
  images: [
    {
      title: "Kopi Arabica",
      imageUrl: "https://cdn.example.com/kopi.jpg",
      imageWidth: 1200,
      imageHeight: 800,
      thumbnailUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:abc",
      source: "Example Store",
      domain: "www.example.com",
      link: "https://www.example.com/kopi",
    },
    {
      title: "Kopi 2",
      imageUrl: "https://shop.test.my/a/b.png",
      imageWidth: 900,
      imageHeight: 900,
      thumbnailUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:def",
      source: "Shop",
      link: "https://www.shop.test.my/p/1",
    },
  ],
};

const SERPER_WEB = {
  organic: [
    {
      title: "Kopi pracampur — Wikipedia",
      link: "https://ms.wikipedia.org/wiki/Kopi",
      snippet: "Kopi ialah minuman ...",
      position: 1,
    },
    { title: "No link", snippet: "dropped" },
  ],
};

const BRAVE_IMAGES = {
  type: "images",
  results: [
    {
      type: "image_result",
      title: "Brave kopi",
      url: "https://www.brave-src.com/page",
      source: "brave-src.com",
      thumbnail: { src: "https://imgs.search.brave.com/t.jpg" },
      properties: { url: "https://img.brave-src.com/kopi.webp", width: 1024, height: 768 },
    },
  ],
};

afterEach(() => __setMotionSearchDeps(null));

test("serper images: request shape + field mapping", async () => {
  const { fn, calls } = mockFetch({ "google.serper.dev": () => json(SERPER_IMAGES) });
  const res = await runCascade(
    [{ provider: "serper", key: "SK" }],
    "images",
    "  Kopi   Pracampur  ",
    undefined,
    fn
  );
  assert.equal(res.provider, "serper");
  assert.deepEqual(res.errors, []);
  assert.equal(res.hits.length, 2);
  assert.deepEqual(res.hits[0], {
    url: "https://cdn.example.com/kopi.jpg",
    thumb: "https://encrypted-tbn0.gstatic.com/images?q=tbn:abc",
    width: 1200,
    height: 800,
    title: "Kopi Arabica",
    source: "Example Store",
    domain: "example.com",
  });
  // no `domain` field → falls back to the page link hostname without www.
  assert.equal(res.hits[1].domain, "shop.test.my");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://google.serper.dev/images");
  assert.equal(calls[0].init?.method, "POST");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers["X-API-KEY"], "SK");
  assert.equal(headers["Content-Type"], "application/json");
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.q, "Kopi Pracampur"); // trimmed + collapsed, case kept
  assert.equal(body.gl, "my");
  assert.equal(body.hl, "ms");
  assert.equal(typeof body.num, "number");
  assert.ok(calls[0].init?.signal, "per-call timeout signal attached");
});

test("serper web: organic mapping", async () => {
  const { fn, calls } = mockFetch({ "google.serper.dev": () => json(SERPER_WEB) });
  const res = await runCascade([{ provider: "serper", key: "SK" }], "web", "kopi", undefined, fn);
  assert.equal(calls[0].url, "https://google.serper.dev/search");
  assert.equal(res.provider, "serper");
  assert.deepEqual(res.hits, [
    {
      title: "Kopi pracampur — Wikipedia",
      url: "https://ms.wikipedia.org/wiki/Kopi",
      snippet: "Kopi ialah minuman ...",
      domain: "ms.wikipedia.org",
    },
  ]);
});

test("serper 500 ⇒ falls through to brave", async () => {
  const { fn, calls } = mockFetch({
    "google.serper.dev": () => new Response("upstream exploded", { status: 500 }),
    "api.search.brave.com": () => json(BRAVE_IMAGES),
  });
  const res = await runCascade(
    [
      { provider: "serper", key: "SK" },
      { provider: "brave", key: "BK" },
    ],
    "images",
    "kopi",
    { num: 5 },
    fn
  );
  assert.equal(res.provider, "brave");
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /^serper: HTTP 500/);
  assert.deepEqual(res.hits[0], {
    url: "https://img.brave-src.com/kopi.webp",
    thumb: "https://imgs.search.brave.com/t.jpg",
    width: 1024,
    height: 768,
    title: "Brave kopi",
    source: "brave-src.com",
    domain: "brave-src.com",
  });
  const braveUrl = new URL(calls[1].url);
  assert.equal(braveUrl.pathname, "/res/v1/images/search");
  assert.equal(braveUrl.searchParams.get("q"), "kopi");
  assert.equal(braveUrl.searchParams.get("safesearch"), "strict");
  assert.equal(braveUrl.searchParams.get("country"), "MY");
  assert.ok(braveUrl.searchParams.get("count"));
  assert.equal((calls[1].init?.headers as Record<string, string>)["X-Subscription-Token"], "BK");
});

test("all providers fail ⇒ empty hits + every error, never throws", async () => {
  const { fn } = mockFetch({
    "google.serper.dev": () => json({ images: [] }), // 0 usable hits
    "api.search.brave.com": () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      });
    },
    "api.tavily.com": () => new Response('{"detail":"bad key TK"}', { status: 401 }),
  });
  const res = await runCascade(
    [
      { provider: "serper", key: "SK" },
      { provider: "brave", key: "BK" },
      { provider: "tavily", key: "TK" },
    ],
    "images",
    "kopi",
    undefined,
    fn
  );
  assert.equal(res.provider, null);
  assert.deepEqual(res.hits, []);
  assert.equal(res.errors.length, 3);
  assert.equal(res.errors[0], "serper: no results");
  assert.equal(res.errors[1], "brave: timeout (8s)");
  assert.match(res.errors[2], /^tavily: HTTP 401/);
  assert.ok(!res.errors[2].includes("TK"), "key is redacted from error text");
});

test("tavily: web from results[], images from images[] (string or {url})", async () => {
  const { fn, calls } = mockFetch({
    "api.tavily.com": (c) => {
      const body = JSON.parse(String(c.init?.body));
      return json(
        body.include_images
          ? {
              images: [
                "https://t.example.org/one.jpg",
                { url: "https://www.t2.example.org/two.jpeg", description: "two" },
              ],
              results: [],
            }
          : {
              results: [
                { title: "T", url: "https://www.tav.com/x", content: "fact", score: 0.9 },
              ],
            }
      );
    },
  });
  const p: SearchProviderCfg[] = [{ provider: "tavily", key: "TK" }];
  const img = await runCascade(p, "images", "kopi", undefined, fn);
  assert.equal(img.provider, "tavily");
  assert.deepEqual(
    img.hits.map((h) => [h.url, h.domain]),
    [
      ["https://t.example.org/one.jpg", "t.example.org"],
      ["https://www.t2.example.org/two.jpeg", "t2.example.org"],
    ]
  );
  const web = await runCascade(p, "web", "kopi", undefined, fn);
  assert.deepEqual(web.hits, [
    { title: "T", url: "https://www.tav.com/x", snippet: "fact", domain: "tav.com" },
  ]);
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.query, "kopi");
  assert.equal(body.search_depth, "basic");
  assert.equal(typeof body.max_results, "number");
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer TK");
});

test("image filtering: svg/gif, tiny, non-http, dupes", () => {
  const out = filterImageHits(
    [
      { url: "https://a.com/logo.svg" },
      { url: "https://a.com/anim.GIF?x=1" },
      { url: "data:image/png;base64,AAAA" },
      { url: "ftp://a.com/x.jpg" },
      { url: "https://a.com/small.jpg", width: 300, height: 900 },
      { url: "https://a.com/short.jpg", width: 900, height: 120 },
      { url: "https://www.ok.com/big.jpg", width: 1600, height: 900 },
      { url: "https://www.ok.com/big.jpg", width: 1600, height: 900 }, // dupe
      { url: "https://ok.com/unknown-size.jpg" }, // unknown size kept
    ],
    10
  );
  assert.deepEqual(
    out.map((h) => h.url),
    ["https://www.ok.com/big.jpg", "https://ok.com/unknown-size.jpg"]
  );
  assert.equal(out[0].domain, "ok.com");
  // cap
  assert.equal(
    filterImageHits(
      Array.from({ length: 12 }, (_, i) => ({ url: `https://x.com/${i}.jpg` })),
      8
    ).length,
    8
  );
});

test("empty key is skipped (no request made, no error noise)", async () => {
  const { fn, calls } = mockFetch({
    "api.search.brave.com": () =>
      json({ web: { results: [{ title: "B", url: "https://b.com/", description: "<strong>kopi</strong> sedap" }] } }),
  });
  const res = await runCascade(
    [
      { provider: "serper", key: "   " },
      { provider: "brave", key: "BK" },
    ],
    "web",
    "kopi",
    undefined,
    fn
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.search\.brave\.com\/res\/v1\/web\/search\?/);
  assert.equal(res.provider, "brave");
  assert.deepEqual(res.errors, []);
  assert.equal(res.hits[0].snippet, "kopi sedap");

  // settings parser also drops empty keys / unknown providers, keeps order
  assert.deepEqual(
    parseMotionSearchSettings({
      providers: [
        { provider: "serper", key: "" },
        { provider: "google", key: "x" },
        { provider: "tavily", key: " TK " },
        { provider: "brave", key: "BK" },
      ],
    }),
    [
      { provider: "tavily", key: "TK" },
      { provider: "brave", key: "BK" },
    ]
  );
  assert.deepEqual(parseMotionSearchSettings(null), []);

  // nothing configured at all ⇒ clear error, no fetch
  const none = await runCascade([{ provider: "serper", key: "" }], "web", "kopi", undefined, fn);
  assert.equal(none.provider, null);
  assert.deepEqual(none.errors, ["no search provider configured"]);
  assert.equal(calls.length, 1);
});

test("query normalisation + cache key", () => {
  assert.equal(cleanQuery("  Kopi \n  Arabica\t"), "Kopi Arabica");
  assert.equal(normalizeQuery("  Kopi   ARABICA "), "kopi arabica");
  assert.equal(cleanQuery("x".repeat(500)).length, 120);
  const a = cacheKey("images", "Kopi  Arabica");
  assert.equal(a, cacheKey("images", " kopi arabica "));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, cacheKey("web", "kopi arabica"));
  assert.notEqual(a, cacheKey("images", "kopi arabica", { num: 4 }));
  assert.equal(a, cacheKey("images", "kopi arabica", { num: 8, gl: "my", hl: "ms" }));
});

test("searchImages wrapper: cache miss → provider → cache write; then cache hit", async () => {
  const store = new Map<string, { provider: string; results: unknown }>();
  const { fn, calls } = mockFetch({ "google.serper.dev": () => json(SERPER_IMAGES) });
  __setMotionSearchDeps({
    loadProviders: async () => [{ provider: "serper", key: "SK" }],
    cacheGet: async (k) => store.get(k) ?? null,
    cacheSet: async (row) => {
      store.set(row.key, { provider: row.provider, results: row.results });
    },
    fetchImpl: fn,
  });
  const first = await searchImages("Kopi Arabica");
  assert.equal(first.cached, false);
  assert.equal(first.provider, "serper");
  assert.equal(first.hits.length, 2);
  assert.equal(store.size, 1);

  const second = await searchImages("  kopi   arabica ");
  assert.equal(second.cached, true);
  assert.equal(second.provider, "serper");
  assert.deepEqual(second.hits, first.hits);
  assert.equal(calls.length, 1, "second call served from cache");
});

test("searchWeb wrapper: cache read/write + settings failures never break search", async () => {
  const { fn } = mockFetch({ "google.serper.dev": () => json(SERPER_WEB) });
  __setMotionSearchDeps({
    loadProviders: async () => [{ provider: "serper", key: "SK" }],
    cacheGet: async () => {
      throw new Error("db down");
    },
    cacheSet: async () => {
      throw new Error("db down");
    },
    fetchImpl: fn,
  });
  const res = await searchWeb("kopi");
  assert.equal(res.provider, "serper");
  assert.equal(res.cached, false);
  assert.equal(res.hits.length, 1);

  __setMotionSearchDeps({
    loadProviders: async () => {
      throw new Error("settings down");
    },
    cacheGet: async () => null,
    cacheSet: async () => {},
    fetchImpl: fn,
  });
  const res2 = await searchWeb("kopi");
  assert.equal(res2.provider, null);
  assert.deepEqual(res2.hits, []);
  assert.deepEqual(res2.errors, ["no search provider configured"]);
  assert.equal(await motionSearchConfigured(), false);

  __setMotionSearchDeps({ loadProviders: async () => [{ provider: "brave", key: "BK" }] });
  assert.equal(await motionSearchConfigured(), true);
});
