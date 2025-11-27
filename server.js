// Simple server.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const crypto = require('crypto');
const mime = require('mime');

const app = express();
const PORT = process.env.PORT || 3000;
const TMP_DIR = path.join(os.tmpdir(), 'vdld');

fs.ensureDirSync(TMP_DIR);
app.use(express.json());
app.use(require('cors')());
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ windowMs: 60*1000, max: 10 });
app.use('/api/', limiter);

function genId(){ return crypto.randomBytes(6).toString('hex'); }
function isValidUrl(s){ try{ new URL(s); return true }catch(e){return false} }

app.post('/api/download', async (req,res)=>{
  const { url, format } = req.body || {};
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: 'URL tidak valid' });
  const id = genId();
  const outDir = path.join(TMP_DIR, id);
  await fs.ensureDir(outDir);
  const outTemplate = path.join(outDir, id + '.%(ext)s');

  const args = (format === 'mp3') ?
    ['-o', outTemplate, '--extract-audio', '--audio-format', 'mp3', url] :
    ['-o', outTemplate, '-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4', url];

  const y = spawn('yt-dlp', args);
  let err = '';
  y.stderr.on('data', d => err += d.toString());
  const timeout = setTimeout(()=> y.kill('SIGKILL'), 5*60*1000);

  y.on('close', async code => {
    clearTimeout(timeout);
    if (code !== 0) { await fs.remove(outDir); return res.status(500).json({ error: 'download gagal' }); }
    const files = await fs.readdir(outDir);
    if (!files.length) return res.status(500).json({ error: 'file tidak dibuat' });
    const chosen = files.sort((a,b)=> fs.statSync(path.join(outDir,b)).size - fs.statSync(path.join(outDir,a)).size )[0];
    const filePath = path.join(outDir, chosen);
    const stat = await fs.stat(filePath);
    const downloadUrl = `/download/${id}/${encodeURIComponent(chosen)}`;
    res.json({ download: downloadUrl, filename: chosen, size: stat.size });
    setTimeout(()=> fs.remove(outDir).catch(()=>{}), 10*60*1000);
  });
});

app.get('/download/:id/:name', async (req,res)=>{
  const { id, name } = req.params;
  if (path.basename(name) !== name) return res.status(400).send('Invalid');
  const fp = path.join(TMP_DIR, id, name);
  if (!await fs.pathExists(fp)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', mime.getType(fp) || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  fs.createReadStream(fp).pipe(res);
});

app.listen(PORT, ()=> console.log('Listening', PORT));
