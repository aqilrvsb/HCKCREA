// Plug-and-play git on any laptop.
//
// This project lives on a portable NTFS drive. Its files belong to the Windows user of the laptop
// that created them, so git on any OTHER laptop refuses the repo ("detected dubious ownership").
// Run on SessionStart: if git says that, mark this folder safe in THIS laptop's git config, once,
// using the exact path git asks for (works whatever drive letter the drive gets).
// Manual use: `node .claude/hooks/git-safe-directory.cjs`
const { execFileSync } = require('child_process');
const path = require('path');

const dir = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');

function git(args) {
  return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}

try {
  git(['-C', dir, 'rev-parse', '--git-dir']);
  if (!process.env.CLAUDE_PROJECT_DIR) console.log('Git already trusts this folder on this laptop.');
} catch (err) {
  const msg = String(err.stderr || '');
  if (/dubious ownership/i.test(msg)) {
    const asked = msg.match(/safe\.directory\s+'?([^'\r\n]+?)'?\s*$/m);
    const safe = (asked ? asked[1] : dir).trim().replace(/\\/g, '/');
    try {
      git(['config', '--global', '--add', 'safe.directory', safe]);
      const note = `Git: this laptop now trusts ${safe} (the drive came from another laptop).`;
      console.log(process.env.CLAUDE_PROJECT_DIR ? JSON.stringify({ systemMessage: note }) : note);
    } catch (e) {
      process.stderr.write(`git-safe-directory: ${e.message}\n`);
    }
  }
}
process.exit(0);
