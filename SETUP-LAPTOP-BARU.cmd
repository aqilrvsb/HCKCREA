@echo off
rem Double-click once on a new computer (only needed if it has no Git/Node installed).
rem Sets up Git + Node from this drive, trusts this folder in git, restores the Claude Code history.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0.claude\hooks\setup-laptop.ps1"
pause
