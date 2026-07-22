import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import PDFDocument from "pdfkit";

const required = ["GITHUB_TOKEN", "BUFFER_API_KEY"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required secret: ${name}`);
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const BUFFER_API_KEY = process.env.BUFFER_API_KEY;
const GITHUB_MODEL = process.env.GITHUB_MODEL || "openai/gpt-4o-mini";
const DRY_RUN = process.env.DRY_RUN === "true";
const REPOSITORY = process.env.GITHUB_REPOSITORY || "sahils2912-ux/sahil-linkedin-automation";
const BRANCH = process.env.GITHUB_REF_NAME || "main";
const TIMEZONE = "Asia/Kolkata";

const pillars = [
  "brand and marketing strategy",
  "client servicing lessons",
  "leadership and team management",
  "consumer-durable marketing",
  "AI used practically in marketing",
  "celebrity and influencer campaigns",
  "agency life and stakeholder management",
  "career growth from execution to leadership"
];

const now = new Date();
const indiaDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(now);
const indiaWeekday = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  weekday: "short"
}).format(now);

const formats = {
  Sun: "text",
  Mon: "text",
  Tue: "image",
  Wed: "carousel",
  Thu: "text",
  Fri: "image",
  Sat: "carousel"
};

const format = formats[indiaWeekday] || "text";
const dayNumber = Math.floor(Date.parse(`${indiaDate}T00:00:00Z`) / 86400000);
const pillar = pillars[dayNumber % pillars.length];

const systemPrompt = `You create LinkedIn content for Sahil Srivastava, a Group Account Head in client servicing with 9+ years of marketing experience. He has led integrated campaigns across consumer durables, mobility and B2B, managed celebrity and sports-led campaigns, and leads a team.

His objective is to build a personal brand as a practical marketing thought leader and problem solver.

Rules:
- Write in first person as Sahil.
- Human, crisp, experience-led and specific. Never sound motivational or AI-generated.
- Do not invent clients, campaign results, numbers, awards, conversations or personal incidents.
- Never disclose confidential information.
- Plain text only. Never use Markdown, asterisks, underscores, backticks, headings or emojis.
- Never use long dashes.
- Caption must start with a strong hook, use short paragraphs, end naturally, and include only 2 or 3 hashtags.
- Build the content around one sharp tension, trade-off, mistake, framework or practical decision from marketing and client servicing.
- Prefer concrete observations, checklists and decision frameworks over broad advice.
- Never use generic phrases such as fast-paced market, authenticity builds trust, feedback is gold, adapt to stay relevant, long-term success, consumer is king, key takeaway or game changer.
- Do not lecture the reader. Write at the level of a senior practitioner speaking to another senior practitioner.
- Return valid JSON only.`;

function formatPrompt() {
  const common = `Create original LinkedIn content for ${indiaDate} around: ${pillar}. Use a useful angle that a senior marketer or client-servicing leader would genuinely share.`;
  if (format === "text") {
    return `${common}\nReturn JSON: {"caption":"700 to 1400 character final post"}`;
  }
  if (format === "image") {
    return `${common}\nCreate a single-image thought-leadership post. Return JSON: {"caption":"500 to 1100 character post","headline":"maximum 9 words","subheadline":"maximum 18 words","takeaway":"maximum 16 words"}`;
  }
  return `${common}\nCreate a 7-page educational PDF carousel with this exact narrative flow: page 1 a bold tension or contrarian hook, page 2 the real problem, page 3 the insight most marketers miss, page 4 a usable framework, page 5 a common mistake, page 6 one practical action, page 7 a punchy conclusion. Every page must add a new idea and the sequence must feel connected. Return JSON: {"caption":"350 to 800 character post","title":"maximum 8 words","slides":[{"title":"maximum 7 words","body":"maximum 35 words"}],"cta":"maximum 16 words"}. slides must contain exactly 7 items.`;
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${url} failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

function cleanText(value = "") {
  return String(value)
    .trim()
    .replace(/\*+/g, "")
    .replace(/`+/g, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/[—–]/g, "-")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`Model returned invalid JSON: ${text}`);
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function generateContent() {
  const body = await jsonRequest("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({
      model: GITHUB_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: formatPrompt() }
      ],
      temperature: 0.75,
      max_tokens: 1200,
      response_format: { type: "json_object" }
    })
  });

  const raw = body.choices?.[0]?.message?.content;
  if (!raw) throw new Error(`GitHub Models returned no content: ${JSON.stringify(body)}`);
  const data = parseJson(raw);
  data.caption = cleanText(data.caption);
  if (data.caption.length < 250 || data.caption.length > 2800) {
    throw new Error(`Generated caption length ${data.caption.length} is outside the safe range.`);
  }
  data.headline = cleanText(data.headline);
  data.subheadline = cleanText(data.subheadline);
  data.takeaway = cleanText(data.takeaway);
  data.title = cleanText(data.title);
  data.cta = cleanText(data.cta);
  if (Array.isArray(data.slides)) {
    data.slides = data.slides.slice(0, 7).map(slide => ({
      title: cleanText(slide.title),
      body: cleanText(slide.body)
    }));
  }
  if (format === "carousel" && data.slides?.length !== 7) {
    throw new Error(`Carousel requires exactly 7 slides; model returned ${data.slides?.length || 0}.`);
  }
  return data;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapWords(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function svgLines(text, { x, y, size, lineHeight, maxChars, color = "#FFFFFF", weight = 700 }) {
  return wrapWords(text, maxChars)
    .map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" fill="${color}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="${weight}">${escapeXml(line)}</text>`)
    .join("\n");
}

function imageSvg(content) {
  return `<svg width="1080" height="1350" viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">
  <rect width="1080" height="1350" fill="#071A2E"/>
  <circle cx="970" cy="90" r="240" fill="#123A4A"/>
  <circle cx="80" cy="1280" r="280" fill="#0E3044"/>
  <rect x="72" y="70" width="120" height="10" rx="5" fill="#79E0B5"/>
  <text x="72" y="132" fill="#79E0B5" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" letter-spacing="3">SAHIL SRIVASTAVA</text>
  <text x="72" y="175" fill="#B8C8D3" font-family="Arial, Helvetica, sans-serif" font-size="22">MARKETING • CLIENT SERVICING • LEADERSHIP</text>
  ${svgLines(content.headline, { x: 72, y: 360, size: 70, lineHeight: 84, maxChars: 22 })}
  ${svgLines(content.subheadline, { x: 72, y: 700, size: 34, lineHeight: 48, maxChars: 47, color: "#D7E2E9", weight: 400 })}
  <rect x="72" y="1035" width="936" height="190" rx="28" fill="#79E0B5"/>
  ${svgLines(content.takeaway, { x: 112, y: 1110, size: 34, lineHeight: 45, maxChars: 45, color: "#071A2E" })}
  <text x="72" y="1290" fill="#8095A5" font-family="Arial, Helvetica, sans-serif" font-size="20">Practical lessons from the work, not theory.</text>
</svg>`;
}

async function renderImage(content, outputPath) {
  await sharp(Buffer.from(imageSvg(content))).png({ quality: 95 }).toFile(outputPath);
}

function addWrappedText(doc, text, x, y, options) {
  doc.text(text, x, y, {
    width: options.width,
    lineGap: options.lineGap || 8,
    align: options.align || "left"
  });
}

async function renderCarousel(content, pdfPath, coverPath) {
  const doc = new PDFDocument({ size: [1080, 1350], margin: 0, autoFirstPage: false });
  const chunks = [];
  doc.on("data", chunk => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  for (let index = 0; index < content.slides.length; index += 1) {
    const slide = content.slides[index];
    doc.addPage();
    doc.rect(0, 0, 1080, 1350).fill("#071A2E");
    doc.circle(index % 2 ? 990 : 70, index % 2 ? 100 : 1260, 250).fill("#103849");
    doc.rect(72, 72, 120, 10).fill("#79E0B5");
    doc.fillColor("#79E0B5").font("Helvetica-Bold").fontSize(26).text("SAHIL SRIVASTAVA", 72, 112, { characterSpacing: 2 });
    doc.fillColor("#8095A5").font("Helvetica").fontSize(22).text(`${String(index + 1).padStart(2, "0")} / 07`, 900, 112);
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(index === 0 ? 76 : 60);
    addWrappedText(doc, slide.title, 72, index === 0 ? 330 : 300, { width: 900, lineGap: 12 });
    doc.fillColor("#D7E2E9").font("Helvetica").fontSize(index === 0 ? 38 : 36);
    addWrappedText(doc, slide.body, 72, index === 0 ? 690 : 600, { width: 900, lineGap: 14 });
    if (index === content.slides.length - 1 && content.cta) {
      doc.roundedRect(72, 1020, 936, 170, 25).fill("#79E0B5");
      doc.fillColor("#071A2E").font("Helvetica-Bold").fontSize(34);
      addWrappedText(doc, content.cta, 110, 1070, { width: 860, lineGap: 10 });
    }
    doc.fillColor("#8095A5").font("Helvetica").fontSize(19).text("Marketing • Client Servicing • Leadership", 72, 1270);
  }

  doc.end();
  await finished;
  await fs.writeFile(pdfPath, Buffer.concat(chunks));
  await sharp(Buffer.from(imageSvg({
    headline: content.slides[0].title,
    subheadline: content.slides[0].body,
    takeaway: content.cta || "Swipe through for the complete perspective."
  }))).png({ quality: 95 }).toFile(coverPath);
}

async function githubRequest(apiPath, options = {}) {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GitHub media hosting failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

async function uploadMedia(localPath, repositoryPath) {
  const encodedPath = repositoryPath.split("/").map(encodeURIComponent).join("/");
  let sha;
  const existing = await fetch(`https://api.github.com/repos/${REPOSITORY}/contents/${encodedPath}?ref=${encodeURIComponent(BRANCH)}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (existing.ok) sha = (await existing.json()).sha;
  else if (existing.status !== 404) throw new Error(`Unable to check existing media: ${existing.status}`);

  const file = await fs.readFile(localPath);
  await githubRequest(`/repos/${REPOSITORY}/contents/${encodedPath}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `Add ${format} media for ${indiaDate}`,
      content: file.toString("base64"),
      branch: BRANCH,
      ...(sha ? { sha } : {})
    })
  });
  return `https://raw.githubusercontent.com/${REPOSITORY}/${BRANCH}/${encodedPath}`;
}

async function waitForPublicUrl(url) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (response.ok) return;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error(`Public media URL was not ready in time: ${url}`);
}

async function bufferGraphQL(query) {
  const body = await jsonRequest("https://api.buffer.com", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BUFFER_API_KEY}`
    },
    body: JSON.stringify({ query })
  });
  if (body.errors?.length) throw new Error(`Buffer GraphQL error: ${JSON.stringify(body.errors)}`);
  return body.data;
}

async function findLinkedInChannel() {
  const orgData = await bufferGraphQL(`query GetOrganizations { account { organizations { id name } } }`);
  const organizations = orgData?.account?.organizations || [];
  if (!organizations.length) throw new Error("No Buffer organization found.");
  for (const organization of organizations) {
    const channelData = await bufferGraphQL(`query GetChannels {
      channels(input: { organizationId: ${JSON.stringify(organization.id)} }) {
        id name displayName service isQueuePaused type
      }
    }`);
    const matches = (channelData?.channels || []).filter(channel =>
      String(channel.service).toLowerCase().includes("linkedin") && !channel.isQueuePaused
    );
    const profile = matches.find(channel => String(channel.type).toLowerCase().includes("profile"));
    if (profile) return profile;
    if (matches.length) return matches[0];
  }
  throw new Error("No active LinkedIn channel found in Buffer.");
}

async function addToBufferQueue(text, channelId, asset) {
  let assets = "";
  if (asset?.type === "image") {
    assets = `, assets: [{ image: { url: ${JSON.stringify(asset.url)} } }]`;
  } else if (asset?.type === "document") {
    assets = `, assets: [{ document: { url: ${JSON.stringify(asset.url)}, title: ${JSON.stringify(asset.title)}, thumbnailUrl: ${JSON.stringify(asset.thumbnailUrl)} } }]`;
  }
  const data = await bufferGraphQL(`mutation CreatePost {
    createPost(input: {
      text: ${JSON.stringify(text)},
      channelId: ${JSON.stringify(channelId)},
      schedulingType: automatic,
      mode: addToQueue
      ${assets}
    }) {
      ... on PostActionSuccess { post { id text dueAt assets { id mimeType } } }
      ... on MutationError { message }
    }
  }`);
  const result = data?.createPost;
  if (!result?.post?.id) throw new Error(`Buffer did not create the post: ${JSON.stringify(result)}`);
  return result.post;
}

const content = await generateContent();
console.log(`Generated ${format} post for pillar: ${pillar}`);

if (DRY_RUN) {
  console.log("DRY_RUN enabled. Nothing was uploaded or sent to Buffer.\n");
  console.log(JSON.stringify(content, null, 2));
} else {
  await fs.mkdir("media", { recursive: true });
  let asset;
  if (format === "image") {
    const imagePath = path.join("media", `${indiaDate}-single-image.png`);
    await renderImage(content, imagePath);
    const url = await uploadMedia(imagePath, `media/${indiaDate}-single-image.png`);
    await waitForPublicUrl(url);
    asset = {
      type: "image",
      url
    };
  } else if (format === "carousel") {
    const pdfPath = path.join("media", `${indiaDate}-carousel.pdf`);
    const coverPath = path.join("media", `${indiaDate}-carousel-cover.png`);
    await renderCarousel(content, pdfPath, coverPath);
    const url = await uploadMedia(pdfPath, `media/${indiaDate}-carousel.pdf`);
    const thumbnailUrl = await uploadMedia(coverPath, `media/${indiaDate}-carousel-cover.png`);
    await waitForPublicUrl(url);
    await waitForPublicUrl(thumbnailUrl);
    asset = {
      type: "document",
      url,
      thumbnailUrl,
      title: content.title || content.slides[0].title
    };
  }

  const channel = await findLinkedInChannel();
  const post = await addToBufferQueue(content.caption, channel.id, asset);
  console.log(`Added ${format} Buffer post ${post.id} to ${channel.displayName || channel.name}.`);
}
