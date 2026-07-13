const required = ["GITHUB_TOKEN", "BUFFER_API_KEY"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required secret: ${name}`);
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const BUFFER_API_KEY = process.env.BUFFER_API_KEY;
const GITHUB_MODEL = process.env.GITHUB_MODEL || "openai/gpt-4o-mini";
const DRY_RUN = process.env.DRY_RUN === "true";

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

const dayNumber = Math.floor(Date.now() / 86400000);
const pillar = pillars[dayNumber % pillars.length];

const instructions = `You write LinkedIn posts for Sahil Srivastava, a Group Account Head in client servicing with 9+ years of marketing experience. He has led integrated campaigns across consumer durables, mobility, B2B and other categories, managed celebrity and sports-led campaigns, and leads teams.

His objective is to build a personal brand as a practical marketing thought leader and problem solver.

Writing rules:
- Write in first person as Sahil.
- Use a human, crisp, experience-led voice.
- Start with a strong one-line hook.
- Use short paragraphs and generous white space.
- Keep the body practical, not preachy.
- End with one concise takeaway or natural question.
- Use 2 or 3 relevant hashtags only.
- No headings, labels, markdown bullets made with asterisks, emojis, long dashes, fake stories, invented numbers, confidential information or claims about unnamed current events.
- Avoid generic motivational language and AI-sounding phrases.
- Total length: 700 to 1,400 characters.
- Return only the final post.`;

const input = `Create today's original LinkedIn post around: ${pillar}.
Use a specific, useful angle. Do not repeat common lines such as "content is king" or "AI will not replace marketers." Date seed: ${new Date().toISOString().slice(0, 10)}.`;

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${url} failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

async function generatePost() {
  const body = await jsonRequest("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({
      model: GITHUB_MODEL,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input }
      ],
      temperature: 0.8,
      max_tokens: 700
    })
  });

  const text = body.choices?.[0]?.message?.content;

  if (!text) throw new Error(`GitHub Models returned no text: ${JSON.stringify(body)}`);
  const post = text.trim();
  if (post.length < 300 || post.length > 2800) {
    throw new Error(`Generated post length ${post.length} is outside the safe range.`);
  }
  return post;
}

async function bufferGraphQL(query) {
  const body = await jsonRequest("https://api.buffer.com", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${BUFFER_API_KEY}`
    },
    body: JSON.stringify({ query })
  });
  if (body.errors?.length) throw new Error(`Buffer GraphQL error: ${JSON.stringify(body.errors)}`);
  return body.data;
}

async function findLinkedInChannel() {
  const orgData = await bufferGraphQL(`query GetOrganizations {
    account { organizations { id name } }
  }`);
  const organizations = orgData?.account?.organizations || [];
  if (!organizations.length) throw new Error("No Buffer organization found.");

  for (const organization of organizations) {
    const channelData = await bufferGraphQL(`query GetChannels {
      channels(input: { organizationId: ${JSON.stringify(organization.id)} }) {
        id name displayName service isQueuePaused
      }
    }`);
    const matches = (channelData?.channels || []).filter(channel =>
      String(channel.service).toLowerCase().includes("linkedin") && !channel.isQueuePaused
    );
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const profile = matches.find(channel =>
        !String(channel.name).toLowerCase().includes("company")
      );
      return profile || matches[0];
    }
  }
  throw new Error("No active LinkedIn channel found in Buffer.");
}

async function addToBufferQueue(text, channelId) {
  const data = await bufferGraphQL(`mutation CreatePost {
    createPost(input: {
      text: ${JSON.stringify(text)},
      channelId: ${JSON.stringify(channelId)},
      schedulingType: automatic,
      mode: addToQueue
    }) {
      ... on PostActionSuccess { post { id text } }
      ... on MutationError { message }
    }
  }`);
  const result = data?.createPost;
  if (!result?.post?.id) throw new Error(`Buffer did not create the post: ${JSON.stringify(result)}`);
  return result.post;
}

const postText = await generatePost();
console.log(`Generated ${postText.length} characters for pillar: ${pillar}`);

if (DRY_RUN) {
  console.log("DRY_RUN enabled. Post was not sent to Buffer.\n");
  console.log(postText);
} else {
  const channel = await findLinkedInChannel();
  const post = await addToBufferQueue(postText, channel.id);
  console.log(`Added Buffer post ${post.id} to ${channel.displayName || channel.name}.`);
}
