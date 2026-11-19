# One-time setup for a computer that has never opened this project (run SETUP-LAPTOP-BARU.cmd).
# Only needed when that computer has no Git or Node installed - otherwise Claude Code's
# SessionStart hooks do the same automatically. Safe to run again: it only adds what is missing.
#  1. Git and Node: uses the computer's own if installed, else the copies on this drive
#     (<drive>\Software\Git\cmd, <drive>\Software\NODE JS), added to the user PATH.
#  2. git safe.directory for this folder (git refuses a repo created by another Windows user).
#  3. Restores the Claude Code conversation history from .claude-history.
$proj = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$drive = [IO.Path]::GetPathRoot($proj)

function Add-UserPath([string]$dir) {
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @(($user -split ';') | Where-Object { $_ })
  if ($parts -notcontains $dir) { [Environment]::SetEnvironmentVariable('Path', (@($parts) + $dir) -join ';', 'User') }
  if (($env:Path -split ';') -notcontains $dir) { $env:Path = "$env:Path;$dir" }
}

function Use-Tool([string]$name, [string]$exe, [string]$dir) {
  if (Get-Command $name -ErrorAction SilentlyContinue) { Write-Host "[OK] $name is installed on this computer"; return $true }
  if (Test-Path (Join-Path $dir $exe)) { Add-UserPath $dir; Write-Host "[OK] $name taken from the drive: $dir (added to PATH)"; return $true }
  Write-Host "[!!] $name not found on this computer or the drive - please install it"; return $false
}

Write-Host "Project: $proj"
$hasGit = Use-Tool 'git' 'git.exe' (Join-Path $drive 'Software\Git\cmd')
$hasNode = Use-Tool 'node' 'node.exe' (Join-Path $drive 'Software\NODE JS')

if ($hasNode) {
  node (Join-Path $proj '.claude\hooks\laptop-setup.cjs')
  node (Join-Path $proj '.claude\hooks\sync-history.cjs') --restore
}
if ($hasGit) {
  $status = git -C $proj status -sb 2>&1 | Select-Object -First 1
  Write-Host "git: $status"
}
Write-Host ''
Write-Host 'Done. Open this folder in VS Code; in Claude Code open Past Conversations to resume.'
Write-Host 'The first git push on a new computer asks you to sign in to GitHub once.'
