import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPage, isPrivateAddress, normalizeSiteUrl, rankSiteImages, siteSnippets, type SiteInfo } from "@/lib/motion-site";

test("normalizeSiteUrl: adds https, keeps public sites, refuses internal / odd URLs", () => {
  assert.equal(normalizeSiteUrl("gluverahq.com"), "https://gluverahq.com/");
  assert.equal(normalizeSiteUrl(" https://gluverahq.com/step/checkout#top "), "https://gluverahq.com/step/checkout");
  for (const bad of ["", "localhost", "http://localhost:3000", "http://127.0.0.1/", "http://[::1]/", "http://10.0.0.5",
    "ftp://gluverahq.com", "https://user:pw@gluverahq.com", "https://gluverahq.com:8443/", "http://printer.local", "intranet"]) {
    assert.equal(normalizeSiteUrl(bad), null, `should refuse: ${bad}`);
  }
});

test("isPrivateAddress: private / loopback / link-local / CGNAT out, public in", () => {
  for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  for (const ip of ["104.21.3.4", "8.8.8.8", "2606:4700::6810:1"]) assert.ok(!isPrivateAddress(ip), ip);
});

const HTML = `<!doctype html><html><head><title>Gluvera Diabetic Patch | Gluvera HQ</title>
<meta property="og:site_name" content="Gluvera">
<meta name="description" content="Patch transdermal Gluvera &amp; cara guna.">
<meta property="og:image" content="https://gluverahq.com/wp-content/uploads/hero.jpg">
<script>var x = "<img src='/evil.jpg'>";</script><style>.a{background:url(/wp-content/style-bg.jpg)}</style></head>
<body>
<img src="/wp-content/uploads/2026/10/gluvera-box-front-300x300.webp" alt="" width="300" height="300">
<img data-src="/wp-content/uploads/2026/10/patch-on-arm.jpg" src="data:image/gif;base64,R0lGOD" alt="Tampal di lengan">
<img srcset="/a/usage-480.jpg 480w, /a/usage-1200.jpg 1200w" alt="Cara guna">
<img src="/wp-content/uploads/logo.png"><img src="/x/payment-fpx.png"><img src="/y/200w.gif"><img src="/z/tiny.jpg" width="40" height="40">
<div style="background-image:url('/wp-content/uploads/lifestyle.jpg')"></div>
<h1>Gluvera Patch</h1><p>Tampal di bahu, perut atau belakang lutut. Pakai 8 hingga 12 jam sehari.</p>
<p>Jangan tampal pada kulit luka. Jauhkan dari air supaya gam kekal lekat.</p>
<a href="/step/checkout-gluvera-1-kotak/">Beli</a><a href="https://gluverahq.com/privacy-policy/">Privacy</a>
<a href="https://shopee.com.my/x">Shopee</a><a href="/wp-content/uploads/a.pdf">PDF</a>
</body></html>`;

test("extractPage: product photos (lazy / srcset / css / og / full-size), no junk, text + shop links", () => {
  const p = extractPage(HTML, "https://gluverahq.com/");
  const urls = p.images.map((h) => h.url);
  assert.ok(urls.includes("https://gluverahq.com/wp-content/uploads/hero.jpg"), "og:image");
  assert.ok(urls.includes("https://gluverahq.com/wp-content/uploads/2026/10/gluvera-box-front.webp"), "WordPress thumbnail → original");
  assert.ok(urls.includes("https://gluverahq.com/wp-content/uploads/2026/10/patch-on-arm.jpg"), "data-src over a placeholder src");
  assert.ok(urls.includes("https://gluverahq.com/a/usage-1200.jpg"), "largest srcset entry");
  assert.ok(urls.includes("https://gluverahq.com/wp-content/uploads/lifestyle.jpg"), "css background");
  for (const junk of ["logo", "payment", "200w.gif", "tiny.jpg", "evil.jpg"]) assert.ok(!urls.some((u) => u.includes(junk)), `no ${junk}`);
  const box = p.images.find((h) => h.url.includes("gluvera-box-front"));
  assert.equal(box?.title, "gluvera box front", "file name words when alt is empty");
  assert.equal(p.images.find((h) => h.url.includes("patch-on-arm"))?.title, "Tampal di lengan");
  assert.equal(p.siteName, "Gluvera");
  assert.equal(p.description, "Patch transdermal Gluvera & cara guna.");
  assert.match(p.text, /Pakai 8 hingga 12 jam sehari/);
  assert.doesNotMatch(p.text, /var x/);
  assert.deepEqual(p.links, ["https://gluverahq.com/step/checkout-gluvera-1-kotak/"]);
});

const SITE: SiteInfo = {
  ok: true, url: "https://gluverahq.com/", host: "gluverahq.com", name: "Gluvera", title: "Gluvera Diabetic Patch",
  description: "", pages: 1, via: "scrape",
  text: "Gluvera Patch\nTampal di bahu, perut atau belakang lutut. Pakai 8 hingga 12 jam sehari.\nJangan tampal pada kulit luka. Jauhkan dari air supaya gam kekal lekat.",
  images: [
    { url: "https://gluverahq.com/u/function.webp", title: "function" },
    { url: "https://gluverahq.com/u/gluvera-box-front.webp", title: "gluvera box front" },
    { url: "https://gluverahq.com/u/patch-on-arm.jpg", title: "patch on arm" },
  ],
};

test("rankSiteImages: word match first, used photos sink so moments get different shots", () => {
  const used = new Map<string, number>();
  assert.equal(rankSiteImages(SITE.images, "Gluvera box", used)[0].url, "https://gluverahq.com/u/gluvera-box-front.webp");
  assert.equal(rankSiteImages(SITE.images, "patch applied on arm", used)[0].url, "https://gluverahq.com/u/patch-on-arm.jpg");
  used.set("https://gluverahq.com/u/gluvera-box-front.webp", 2);
  assert.notEqual(rankSiteImages(SITE.images, "Gluvera box", used)[0].url, "https://gluverahq.com/u/gluvera-box-front.webp");
  assert.equal(rankSiteImages(SITE.images, "anything", new Map()).length, 3, "always a full pool to choose from");
});

test("siteSnippets: the site's own paragraphs as fact snippets", () => {
  const s = siteSnippets(SITE, "berapa jam pakai patch");
  assert.equal(s[0].domain, "gluverahq.com");
  assert.match(s[0].snippet, /8 hingga 12 jam/);
  assert.deepEqual(siteSnippets(SITE, "harga promosi"), []);
});
