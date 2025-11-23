import { execSync } from 'child_process';
import { rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.join(__dirname, '..');
const frontendNextDir = path.join(projectRoot, 'frontend', '.next');

function safeExec(command) {
  try {
    execSync(command, { stdio: 'ignore' });
  } catch {
    // ignore errors; ports may already be free
  }
}

function safeRemove(targetPath) {
  try {
    rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // ignore missing paths
  }
}

// Free common dev ports (API + frontend)
safeExec('npx kill-port 6969 3000 3001');

// Remove any stale Next.js dev build artifacts (including lock files)
safeRemove(frontendNextDir);
