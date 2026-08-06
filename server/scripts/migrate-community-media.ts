import { db, initDatabase } from "../src/storage/db.js";
import { uploadImageDataUrl } from "../src/services/mediaStorage.js";

const apply = process.argv.includes("--apply");
initDatabase();

type PostRow = { id: number; user_id: number; image_url: string | null; image_urls: string | null };
type CommentRow = { id: number; user_id: number; image_url: string | null };

const posts = db.prepare("SELECT id, user_id, image_url, image_urls FROM community_posts WHERE image_url LIKE 'data:%' OR image_urls LIKE '%data:image/%'").all() as PostRow[];
const comments = db.prepare("SELECT id, user_id, image_url FROM community_comments WHERE image_url LIKE 'data:%'").all() as CommentRow[];
const inlineCount = posts.reduce((count, post) => count + collectPostUrls(post).filter(isInlineImage).length, 0) + comments.filter((comment) => isInlineImage(comment.image_url)).length;

if (!apply) {
  console.log(JSON.stringify({ apply: false, posts: posts.length, comments: comments.length, inlineImages: inlineCount, next: "rerun with --apply after verifying the staging bucket" }, null, 2));
  db.close();
  process.exit(0);
}

let uploaded = 0;
for (const post of posts) {
  const originalUrls = collectPostUrls(post);
  const migratedUrls = await migrateUrls(originalUrls, post.user_id);
  db.prepare("UPDATE community_posts SET image_url = ?, image_urls = ? WHERE id = ?")
    .run(migratedUrls[0] || null, migratedUrls.length ? JSON.stringify(migratedUrls) : null, post.id);
}
for (const comment of comments) {
  if (!isInlineImage(comment.image_url)) continue;
  const migrated = await uploadImageDataUrl(comment.image_url, comment.user_id, "community");
  db.prepare("UPDATE community_comments SET image_url = ? WHERE id = ?").run(migrated.url, comment.id);
  uploaded += 1;
}

console.log(JSON.stringify({ apply: true, posts: posts.length, comments: comments.length, uploaded }, null, 2));
db.close();

async function migrateUrls(urls: string[], userId: number) {
  const result: string[] = [];
  for (const url of urls) {
    if (!isInlineImage(url)) {
      result.push(url);
      continue;
    }
    const migrated = await uploadImageDataUrl(url, userId, "community");
    result.push(migrated.url);
    uploaded += 1;
  }
  return result;
}

function collectPostUrls(post: PostRow) {
  try {
    const parsed: unknown = post.image_urls ? JSON.parse(post.image_urls) : [];
    const urls = Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
    if (urls.length) return urls;
  } catch {}
  return post.image_url ? [post.image_url] : [];
}

function isInlineImage(value: string | null): value is string {
  return typeof value === "string" && value.startsWith("data:image/");
}
