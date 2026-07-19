// Cross-platform (`VAR=val cmd` doesn't work in Windows cmd.exe) wrapper so `npm run dev`
// can force NO_CACHE=true without adding a dependency just to set one env var.
const { spawn } = require('child_process');

const child = spawn('tsx watch src/index.ts', {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NO_CACHE: 'true' },
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});
