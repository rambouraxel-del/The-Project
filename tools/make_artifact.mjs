// Prépare une version "page unique + fichiers" pour la publication en Artifact (HTTPS privé).
// Usage : npm run build && node tools/make_artifact.mjs   → artifact/index.html + artifact/assets/*
import fs from 'node:fs';
import path from 'node:path';

const dist = 'dist';
const out = 'artifact';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const css = html.match(/href="\.\/assets\/(index-[^"]+\.css)"/)[1];
const js = html.match(/src="\.\/assets\/(index-[^"]+\.js)"/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const cssText = fs.readFileSync(path.join(dist, 'assets', css), 'utf8');
const jsText = fs.readFileSync(path.join(dist, 'assets', js), 'utf8').replace(/<\/script>/g, '<\\/script>');

const page = `<title>Atlas des Ambitions</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&display=swap" rel="stylesheet">
<style>
${cssText}
</style>
${body}
<script type="module">
${jsText}
</script>
`;
fs.writeFileSync(path.join(out, 'index.html'), page);
fs.cpSync(path.join(dist, 'assets'), path.join(out, 'assets'), { recursive: true, filter: s => !/index-.*\.(js|css)$/.test(s) });
const n = (d => { let c = 0; const w = p => fs.readdirSync(p, { withFileTypes: true }).forEach(e => e.isDirectory() ? w(path.join(p, e.name)) : c++); w(d); return c; })(out);
console.log('artifact prêt :', n, 'fichiers,', (page.length / 1024).toFixed(0), 'Ko de page');
