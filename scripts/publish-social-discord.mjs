const DISCORD_MAX_CONTENT = 2000;
const USER_AGENT = "Bobaks-Ranking-Social/1.0";

export function buildDiscordPayload(content) {
  const text = String(content ?? "").trim();
  if (!text) throw new Error("Discord content is empty");
  if (text.length > DISCORD_MAX_CONTENT) {
    throw new Error("Discord content exceeds the 2000-character limit");
  }
  return { content: text };
}

export function splitDiscordContent(content) {
  const text = String(content ?? "").trim();
  if (!text) throw new Error("Discord content is empty");
  if (text.length <= DISCORD_MAX_CONTENT) return [text];

  const chunks = [];
  let current = "";
  for (const line of text.split("\n")) {
    const candidate = current ? current + "\n" + line : line;
    if (candidate.length <= DISCORD_MAX_CONTENT) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);
    if (line.length <= DISCORD_MAX_CONTENT) {
      current = line;
      continue;
    }

    for (let i = 0; i < line.length; i += DISCORD_MAX_CONTENT) {
      chunks.push(line.slice(i, i + DISCORD_MAX_CONTENT));
    }
    current = "";
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function publishDiscordPost(webhookUrl, content, fetchImpl = fetch) {
  if (!webhookUrl || typeof webhookUrl !== "string") {
    throw new Error("Discord webhook URL is missing");
  }

  const chunks = splitDiscordContent(content);
  for (const chunk of chunks) {
    const response = await fetchImpl(
      webhookUrl + (webhookUrl.includes("?") ? "&" : "?") + "wait=true",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": USER_AGENT
        },
        body: JSON.stringify(buildDiscordPayload(chunk))
      }
    );

    if (!response.ok) {
      throw new Error("Discord webhook failed: HTTP " + response.status);
    }
  }

  return true;
}

export function selectDiscordFiles(files, utcWeekday) {
  const selected = ["top10-live.txt", "trending-live.txt"];
  if (String(utcWeekday) === "1") {
    selected.push("top10-week.txt");
  }
  return selected;
}

async function main() {
  const webhookUrl = process.env.DISCORD_SOCIAL_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("DISCORD_SOCIAL_WEBHOOK_URL is not configured; skipping external publishing.");
    return;
  }

  const fs = await import("node:fs/promises");
  const outputDir = process.env.SOCIAL_OUTPUT_DIR || "social-output";
  const weekday = new Date().getUTCDay() === 0 ? 7 : new Date().getUTCDay();
  const fileNames = selectDiscordFiles([], weekday);

  for (const fileName of fileNames) {
    const content = await fs.readFile(outputDir + "/" + fileName, "utf8");
    await publishDiscordPost(webhookUrl, content);
    console.log("Published " + fileName + " to Discord.");
  }
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
