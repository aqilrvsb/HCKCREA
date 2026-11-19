// SessionStart hook: makes git work straight away when this project's drive is plugged into
// another computer.
//
// The project lives on a portable NTFS drive. On a computer whose Windows user did not create
// the files, git refuses the repo ("detected dubious ownership") until the folder is added to
// that computer's global safe.directory list. Git only reads that list from global/system
// config, so it cannot travel with the drive; this hook adds it the first time Claude Code opens
// the project there. Git identity and line endings are in the repo's own .git/config and travel.
//
// Git is taken from PATH, else from the drive's own copy (<drive>\Software\Git\cmd\git.exe).
// No git or nothing to fix → does nothing. Manual use: node .claude/hooks/laptop-setup.cjs
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function readHookInput() {
  if (process.stdin.isTTY) return {};
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

// git prints the exact command to run: "git config --global --add safe.directory <path>".
function safeDirFromMessage(message, fallback) {
  const m = /safe\.directory\s+(.+?)\s*$/m.exec(message || '');
  return m ? m[1].replace(/^'(.*)'$/, '$1') : fallback;
}

function findGit(projectDir) {
  const onPath = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (!onPath.error && onPath.status === 0) return 'git';
  const driveGit = path.join(path.parse(projectDir).root, 'Software', 'Git', 'cmd', 'git.exe');
  return fs.existsSync(driveGit) ? driveGit : null;
}

function main() {
  const input = readHookInput();
  const manual = !input.hook_event_name;
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || path.resolve(__dirname, '..', '..');
  const git = findGit(projectDir);
  if (!git) { if (manual) console.log('git not found on PATH or on the drive — nothing done.'); return; }

  const probe = spawnSync(git, ['-C', projectDir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  const message = `${probe.stdout || ''}\n${probe.stderr || ''}`;
  if (!/dubious ownership/i.test(message)) {
    if (manual) console.log('git already trusts this folder — nothing to do.');
    return;
  }
  const dir = safeDirFromMessage(message, projectDir.replace(/\\/g, '/'));
  const add = spawnSync(git, ['config', '--global', '--add', 'safe.directory', dir], { encoding: 'utf8' });
  const ok = add.status === 0
    && !/dubious ownership/i.test(spawnSync(git, ['-C', projectDir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).stderr || '');
  const text = ok
    ? `New computer: added ${dir} to git safe.directory, so git works in this project now.`
    : `New computer: could not add ${dir} to git safe.directory (${(add.stderr || '').trim() || 'unknown error'}).`;
  if (manual) console.log(text);
  else console.log(JSON.stringify({ systemMessage: text }));
}

if (process.env.LAPTOP_SETUP_TEST) module.exports = { safeDirFromMessage };
else {
  try { main(); } catch (err) { process.stderr.write(`laptop-setup: ${err.message}\n`); }
  process.exit(0);
}
