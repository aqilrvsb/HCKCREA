// Keeps this project's Claude Code conversation history inside the project folder, both ways.
//
// Claude Code saves conversations under ~/.claude/projects/<project-folder-name>/ (transcripts,
// subagent and tool results, memory). The project lives on a portable drive, so the history is
// mirrored into <project>/.claude-history and travels with it:
//
//   Stop / SessionEnd hook   -> copy this computer's history  into .claude-history
//   SessionStart hook        -> copy .claude-history           into this computer's history
//
// So on any computer: plug the drive in, open the project in Claude Code, and the full
// conversation is there in Past Conversations (/resume). Hooks are set in .claude/settings.json.
// Manual use: `node .claude/hooks/sync-history.cjs` (sync) or `... --restore`.
//
// Rules: only new or changed files are copied; a transcript (.jsonl, append-only) gets just its
// new part appended. The newer side always wins and nothing is ever deleted. If two copies of a
// transcript went separate ways, the one being replaced is kept as <name>.jsonl.<time>.bak.
// .claude-history holds private data (customer details, pasted keys): it is in .gitignore and
// must never be committed — this repo is public.
const fs = require('fs');
const path = require('path');
const os = require('os');

function readHookInput() {
  if (process.stdin.isTTY) return {};
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

const input = readHookInput();
const manual = !input.hook_event_name;
const restore = process.argv.includes('--restore') || input.hook_event_name === 'SessionStart';
const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || path.resolve(__dirname, '..', '..');
const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
// Claude Code names the folder after the project path, every non-alphanumeric character as '-'.
let historyDir = path.join(projectsRoot, projectDir.replace(/[^a-zA-Z0-9]/g, '-'));
if (input.transcript_path && path.dirname(path.dirname(input.transcript_path)).toLowerCase() === projectsRoot.toLowerCase()) {
  historyDir = path.dirname(input.transcript_path);
}
const backupDir = path.join(projectDir, '.claude-history');
const [src, dst] = restore ? [backupDir, historyDir] : [historyDir, backupDir];

const CHUNK = 8 * 1024 * 1024;
const TAIL = 64 * 1024;
const SLACK_MS = 2000;

function readRange(file, start, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, start);
    return buf.subarray(0, n);
  } finally { fs.closeSync(fd); }
}

// `longer` starts with the first `size` bytes of `shorter` (checked on the last 64 KB of them).
function startsWith(longer, shorter, size) {
  if (size === 0) return true;
  const len = Math.min(TAIL, size);
  return readRange(longer, size - len, len).equals(readRange(shorter, size - len, len));
}

function appendRange(s, d, from, to) {
  const fdIn = fs.openSync(s, 'r');
  const fdOut = fs.openSync(d, 'a');
  try {
    const buf = Buffer.alloc(CHUNK);
    for (let pos = from; pos < to;) {
      const n = fs.readSync(fdIn, buf, 0, Math.min(CHUNK, to - pos), pos);
      if (n <= 0) break;
      fs.writeSync(fdOut, buf, 0, n);
      pos += n;
    }
  } finally { fs.closeSync(fdIn); fs.closeSync(fdOut); }
}

const stats = { copied: 0, appended: 0, kept: 0, unchanged: 0 };

function syncFile(s, d) {
  const ss = fs.statSync(s);
  let ds = null;
  try { ds = fs.statSync(d); } catch { /* not there yet */ }
  if (ds && ds.size === ss.size && Math.abs(ds.mtimeMs - ss.mtimeMs) < SLACK_MS) { stats.unchanged++; return; }
  const isLog = d.endsWith('.jsonl');
  if (ds) {
    // The other side already has this transcript and more of it → it is newer, leave it.
    if (isLog && ds.size >= ss.size && startsWith(d, s, ss.size)) { stats.kept++; return; }
    // Never replace a newer file with an older one.
    if (ds.mtimeMs > ss.mtimeMs + SLACK_MS && !(isLog && ds.size < ss.size && startsWith(s, d, ds.size))) { stats.kept++; return; }
  }
  fs.mkdirSync(path.dirname(d), { recursive: true });
  if (ds && isLog && ds.size < ss.size && startsWith(s, d, ds.size)) {
    appendRange(s, d, ds.size, ss.size);
    stats.appended++;
  } else {
    if (ds && isLog) fs.copyFileSync(d, `${d}.${Date.now()}.bak`); // copies went separate ways: keep the old one
    fs.copyFileSync(s, d);
    stats.copied++;
  }
  fs.utimesSync(d, ss.atime, ss.mtime);
}

function walk(dirS, dirD) {
  for (const e of fs.readdirSync(dirS, { withFileTypes: true })) {
    if (e.name.endsWith('.bak')) continue;
    const s = path.join(dirS, e.name);
    const d = path.join(dirD, e.name);
    if (e.isDirectory()) walk(s, d);
    else if (e.isFile()) {
      try { syncFile(s, d); } catch (err) { process.stderr.write(`sync-history: ${s}: ${err.message}\n`); }
    }
  }
}

try {
  if (!fs.existsSync(src)) {
    if (manual) console.log(`Nothing to copy: ${src} not found.`);
    process.exit(0);
  }
  // Same folder on both sides (e.g. linked) → nothing to do.
  if (fs.existsSync(dst) && fs.realpathSync(src).toLowerCase() === fs.realpathSync(dst).toLowerCase()) process.exit(0);
  walk(src, dst);
  const summary = `${stats.copied} copied, ${stats.appended} appended, ${stats.kept} newer kept, ${stats.unchanged} unchanged`;
  if (manual) console.log(`${restore ? 'Restored' : 'Synced'} ${src} -> ${dst}: ${summary}.`);
  else if (restore && stats.copied + stats.appended > 0) {
    console.log(JSON.stringify({ systemMessage: `Conversation history restored from .claude-history (${summary}). Open Past Conversations to resume.` }));
  }
} catch (err) {
  process.stderr.write(`sync-history: ${err.message}\n`);
}
process.exit(0);
