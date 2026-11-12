const ALLOWED_ORIGINS = new Set(["https://pradeepchugani123-sudo.github.io"]);
const ALLOWED_HOSTNAMES = new Set(["pradeepchugani123-sudo.github.io"]);
const GEMINI_MODEL = "gemini-3.5-flash-lite";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "null",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, corsHeaders(origin))
  });
}
function cleanText(value, max) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim().slice(0, max || 12000);
}
function getMeta(html, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i);
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
    if (name && content && name[1].toLowerCase() === key.toLowerCase()) return content[1];
  }
  return "";
}function findProductJsonLd(html) {
  const blocks = Array.from(html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1]);
      const nodes = Array.isArray(parsed) ? parsed : (parsed["@graph"] || [parsed]);
      const product = nodes.find(function(x) {
        return x && (x["@type"] === "Product" || (Array.isArray(x["@type"]) && x["@type"].includes("Product")));
      });
      if (product) return product;
    } catch (e) {}
  }
  return null;
}
async function getProduct(urlText) {
  let url;
  try { url = new URL(urlText); } catch (e) { throw new Error("Please enter a valid product URL."); }
  if (!["https:", "http:"].includes(url.protocol) || !url.pathname.includes("/products/") ||
      url.username || url.password || url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")) {
    throw new Error("Enter a public Shopify product page URL.");
  }
  const response = await fetch(url.toString(), {
    headers: { "Accept": "text/html", "User-Agent": "Mozilla/5.0 ShopifyTools/1.0" },
    redirect: "follow",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error("Could not open that product page (HTTP " + response.status + ").");
  const html = (await response.text()).slice(0, 1500000);
  const product = findProductJsonLd(html);
  const title = cleanText((product && product.name) || getMeta(html, "og:title") || ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ""));
  const description = cleanText((product && product.description) || getMeta(html, "og:description") || getMeta(html, "description") || "");
  let image = "";
  const imageValue = (product && product.image) || getMeta(html, "og:image");
  if (Array.isArray(imageValue)) image = typeof imageValue[0] === "string" ? imageValue[0] : ((imageValue[0] && imageValue[0].url) || "");
  else if (typeof imageValue === "object" && imageValue) image = imageValue.url || "";
  else image = imageValue || "";
  if (!title && !description) throw new Error("I couldn't read product details from that page. Check that the product is public and try again.");
  return { title: title, description: description, image_url: image, product_url: url.toString() };
}
async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET) throw new Error("Cloudflare is missing the TURNSTILE_SECRET setting.");
  if (typeof token !== "string" || !token || token.length > 2048) throw new Error("Complete the security check and try again.");
  const form = new URLSearchParams({
    secret: env.TURNSTILE_SECRET,
    response: token,
    remoteip: request.headers.get("CF-Connecting-IP") || ""
  });
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error("Security verification is temporarily unavailable. Please try again.");
  const result = await response.json();
  if (!result.success || result.action !== "shopify_tools_generate" ||
      !ALLOWED_HOSTNAMES.has(result.hostname)) {
    throw new Error("Security check expired. Please try again.");
  }
}
async function askGemini(env, prompt) {
  if (!env.GEMINI_API_KEY) throw new Error("Cloudflare is missing the GEMINI_API_KEY setting.");
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" +
    GEMINI_MODEL + ":generateContent?key=" + encodeURIComponent(env.GEMINI_API_KEY);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.35 }
    }),
    signal: AbortSignal.timeout(45000)
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch (e) { throw new Error("Gemini returned an unreadable response."); }
  if (!response.ok) {
    const detail = (data && data.error && data.error.message) || ("Gemini request failed (" + response.status + ").");
    throw new Error(detail.slice(0, 350));
  }
  const text = (data.candidates && data.candidates[0] && data.candidates[0].content &&
    data.candidates[0].content.parts.map(function(p) { return p.text || ""; }).join("")) || "";
  if (!text) throw new Error("Gemini did not return generated content.");
  try { return JSON.parse(text); } catch (e) { throw new Error("Gemini returned invalid JSON. Please try again."); }
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return json({ ok: true, service: "Shopify Tools API" }, 200, origin);
    }
    if (!ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: "This website is not authorized to use the API." }, 403, origin);
    if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405, origin);
    const path = new URL(request.url).pathname;
    if (path !== "/api/image-prompt" && path !== "/api/description") {
      return json({ ok: false, error: "Unknown API route." }, 404, origin);
    }
    try {
      const body = await request.json();
      await verifyTurnstile(request, env, body.turnstile_token);
      const product = await getProduct(body.product_url);
      if (path === "/api/image-prompt") {
        const count = Number(body.model_count) === 2 ? 2 : 1;
        const promptText = "You create highly detailed ecommerce fashion image-generation prompts for a clothing wholesaler. Read the product information and return ONLY valid JSON with keys: product_name, product_description, image_generation_prompt, styling_notes, negative_prompt. Preserve the product's exact visible colors, garment construction, print artwork, logos, and proportions. Do not invent details that are not supplied. The image_generation_prompt should request a photorealistic professional ecommerce image, with " + count + " model(s), age category " + cleanText(body.age_category || "auto-detect", 40) + ", model 1 ethnicity " + cleanText(body.ethnicity1 || "Hispanic/Latino", 60) + ", model 2 ethnicity " + cleanText(body.ethnicity2 || "African American", 60) + ". Show movement: " + (!!body.show_movement) + ". Footwear options: sneakers " + (!!body.add_sneakers) + ", socks " + (!!body.add_socks) + ", casual shoes " + (!!body.add_shoes) + ", work boots " + (!!body.add_work_boots) + ". Include a clean white or neutral ecommerce background, realistic fabric texture, natural fit, and clear full garment visibility. Product title: " + product.title + ". Product description: " + product.description + ". Reference image URL: " + product.image_url + ". Product URL: " + product.product_url + ".";
        const generated = await askGemini(env, promptText);
        const result = {
          model: "nano-banana-v1",
          inputs: { title: product.title, description: product.description, image_url: product.image_url || null },
          options: { format: "json" },
          generation: generated,
          reference_image: product.image_url || null
        };
        return json({ ok: true, prompt: result }, 200, origin);
      }
      const description = await askGemini(env, "You are an expert Shopify ecommerce copywriter. Based only on the supplied product facts, return ONLY valid JSON with keys: title, description_markdown, seo_title, seo_description. Write a useful, polished product title and original product description with concise feature bullets. Do not invent fabric content, sizes, fit, colors, care instructions, or other specifications not supplied. Make SEO title concise (max 60 characters) and SEO description about 150-155 characters. Product title: " + product.title + ". Product details: " + product.description + ". Product URL: " + product.product_url + ".");
      return json({ ok: true, outputs: {
        title: cleanText(description.title || product.title, 180),
        description_markdown: String(description.description_markdown || ""),
        seo_title: cleanText(description.seo_title || product.title, 70),
        seo_description: cleanText(description.seo_description || product.description, 200)
      } }, 200, origin);
    } catch (error) {
      const message = (error && error.message) || "Something went wrong. Please try again.";
      const status = /security|turnstile|unauthorized|authorized/i.test(message) ? 403 : 400;
      return json({ ok: false, error: message }, status, origin);
    }
  }
};
