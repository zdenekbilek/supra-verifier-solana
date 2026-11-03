// Local/CI verification only. The only cargo publish invocation is a dry run.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
assert(
  args.every((arg) => arg === '--allow-dirty'),
  'Only --allow-dirty is supported',
);
const dirty = args.includes('--allow-dirty') ? ['--allow-dirty'] : [];
const run = (command, argv, options = {}) =>
  execFileSync(command, argv, { cwd: root, stdio: 'inherit', ...options });
const metadata = JSON.parse(
  run('cargo', ['metadata', '--no-deps', '--format-version', '1', '--locked'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }),
);
const pkg = metadata.packages.find(
  (pkg) => pkg.manifest_path === path.join(root, 'Cargo.toml'),
);
assert(pkg, 'Root crate metadata missing');
const packageStem = `${pkg.name}-${pkg.version}`;

if (!dirty.length) {
  const status = run('git', ['status', '--porcelain'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  assert.equal(
    status.trim(),
    '',
    'Commit release changes before clean release checks',
  );
}

const sums = readFileSync(path.join(root, 'fixtures/SHA256SUMS'), 'utf8')
  .trim()
  .split('\n');
for (const line of sums) {
  const [expected, filename] = line.split('  ');
  assert(
    filename && !filename.includes('/') && /^[a-f0-9]{64}$/.test(expected),
  );
  const actual = createHash('sha256')
    .update(readFileSync(path.join(root, 'fixtures', filename)))
    .digest('hex');
  assert.equal(actual, expected, `Original fixture changed: ${filename}`);
}

run('cargo', ['fmt', '--all', '--', '--check']);
run('cargo', [
  'clippy',
  '--workspace',
  '--all-targets',
  '--locked',
  '--',
  '-D',
  'warnings',
]);
run('cargo', ['test', '--workspace', '--locked']);
run('cargo', ['doc', '--no-deps', '--locked'], {
  env: { ...process.env, RUSTDOCFLAGS: '-D warnings' },
});
run('npm', ['run', 'typecheck']);
run('npm', ['test']);
run('npm', ['run', 'format:check']);

const files = run('cargo', ['package', '--list', '--locked', ...dirty], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
  .trim()
  .split('\n');
for (const filename of [
  'LICENSE',
  'NOTICE',
  'README.md',
  'src/lib.rs',
  'src/crypto.rs',
  'fixtures/btc-usd.json',
  'fixtures/vectors.json',
  'fixtures/committee.json',
  'fixtures/forged-tree.json',
  'fixtures/SHA256SUMS',
  'docs/provenance.md',
]) {
  assert(
    files.includes(filename),
    `Required release file missing: ${filename}`,
  );
}
for (const filename of files) {
  assert(
    /^(?:src\/|fixtures\/|docs\/|Cargo\.(?:toml(?:\.orig)?|lock)$|README\.md$|LICENSE$|NOTICE$|CHANGELOG\.md$|\.cargo_vcs_info\.json$)/.test(
      filename,
    ),
    `Unexpected release file: ${filename}`,
  );
}
run('cargo', [
  'publish',
  '--package',
  'supra-verifier-solana',
  '--registry',
  'crates-io',
  '--dry-run',
  '--locked',
  ...dirty,
]);
// Cargo publish's temporary archive is not retained by every Cargo version.
// Produce the inspectable artifact explicitly before testing it outside the repo.
run('cargo', ['package', '--package', pkg.name, '--locked', ...dirty]);

const temporary = mkdtempSync(path.join(tmpdir(), 'supra-verifier-package-'));
try {
  const crate = path.join(
    metadata.target_directory,
    'package',
    `${packageStem}.crate`,
  );
  run('tar', ['-xzf', crate, '-C', temporary]);
  const manifest = path.join(temporary, packageStem, 'Cargo.toml');
  run('cargo', ['test', '--manifest-path', manifest, '--locked'], {
    cwd: temporary,
    env: {
      ...process.env,
      CARGO_TARGET_DIR: path.join(root, 'target/package-tests'),
    },
  });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log('Release checks passed. Nothing was published.');
