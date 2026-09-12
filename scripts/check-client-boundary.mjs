import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
export async function checkClientBoundary(root = '.') {
  const dirs = ['src/client', 'src/shared', 'dist/client'];
  for (const directory of dirs) {
    const files = await readdir(path.join(root, directory), { recursive: true, withFileTypes: true });
    for (const file of files.filter(f => f.isFile())) {
      const text = await readFile(path.join(file.parentPath, file.name), 'utf8');
      if (/SUPABASE_SECRET_KEY|sb_secret_|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|ATTACHMENT_ENCRYPTION_KEY|auth-admin|src\/server/.test(text)) throw new Error('Client/server security boundary failed');
      if (process.env.SUPABASE_SECRET_KEY && text.includes(process.env.SUPABASE_SECRET_KEY)) throw new Error('Client secret contamination');
      for(const [name,value] of Object.entries(process.env))if(/^ATTACHMENT_ENCRYPTION_KEY_V[1-9][0-9]*$/.test(name)&&value&&text.includes(value))throw new Error('Client encryption key contamination');
      if (process.env.ATTACHMENT_ENCRYPTION_KEY && text.includes(process.env.ATTACHMENT_ENCRYPTION_KEY)) throw new Error('Client encryption key contamination');
    }
  }
}
await checkClientBoundary();
