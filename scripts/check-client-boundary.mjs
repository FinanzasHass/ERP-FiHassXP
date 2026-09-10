import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
export async function checkClientBoundary(root = '.') {
  const dirs = ['src/client', 'src/shared', 'dist/client'];
  for (const directory of dirs) {
    const files = await readdir(path.join(root, directory), { recursive: true, withFileTypes: true });
    for (const file of files.filter(f => f.isFile())) {
      const text = await readFile(path.join(file.parentPath, file.name), 'utf8');
      if (/SUPABASE_SECRET_KEY|sb_secret_|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|auth-admin|src\/server/.test(text)) throw new Error('Client/server security boundary failed');
      if (process.env.SUPABASE_SECRET_KEY && text.includes(process.env.SUPABASE_SECRET_KEY)) throw new Error('Client secret contamination');
    }
  }
}
await checkClientBoundary();
