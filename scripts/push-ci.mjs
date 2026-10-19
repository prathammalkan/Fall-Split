#!/usr/bin/env node
/**
 * push-ci.mjs
 *
 * Pushes the .github/workflows/ci.yml file to GitHub using the GitHub API directly.
 * This bypasses the OAuth "workflow" scope limitation of git credential helpers.
 *
 * Usage:
 *   set GITHUB_TOKEN=ghp_your_personal_access_token_with_workflow_scope
 *   node scripts/push-ci.mjs
 *
 * The PAT must have: repo + workflow scopes.
 * Create one at: https://github.com/settings/tokens/new
 */

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('ERROR: Set GITHUB_TOKEN environment variable first.');
  console.error('  $env:GITHUB_TOKEN="ghp_..."   # PowerShell');
  console.error('  export GITHUB_TOKEN="ghp_..." # bash');
  process.exit(1);
}

// Get repo info from git remote
const remoteUrl = execSync('git remote get-url origin').toString().trim();
const match = remoteUrl.match(/github\.com[/:]([\w-]+)\/([\w-]+?)(?:\.git)?$/);
if (!match) {
  console.error('Could not parse GitHub repo from remote URL:', remoteUrl);
  process.exit(1);
}
const [, owner, repo] = match;
console.log(`Repository: ${owner}/${repo}`);

const filePath = '.github/workflows/ci.yml';
const fileContent = readFileSync(filePath, 'utf8');
const encoded = Buffer.from(fileContent).toString('base64');

// Check if file exists to get its SHA (needed for update)
let sha = null;
try {
  const checkRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
    { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } }
  );
  if (checkRes.ok) {
    const checkData = await checkRes.json();
    sha = checkData.sha;
    console.log('File exists on GitHub, will update.');
  }
} catch (_) {
  // File doesn't exist, will create
}

const body = {
  message: 'ci: add GitHub Actions CI workflow',
  content: encoded,
  ...(sha ? { sha } : {}),
};

const res = await fetch(
  `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
  {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }
);

if (res.ok) {
  console.log(`\n✅ Successfully pushed ${filePath} to GitHub!`);
  console.log('GitHub Actions will now run CI on the next push.');
} else {
  const err = await res.json();
  console.error('\n❌ Failed to push:', err.message);
  process.exit(1);
}
