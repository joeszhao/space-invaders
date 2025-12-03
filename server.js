import express from 'express';
import fetch from 'node-fetch';
import TurndownService from 'turndown';
import fs from 'fs';
import path from 'path';
import sanitize from 'sanitize-filename';
import https from 'https';

const app = express();
const PORT = process.env.PORT || 3000;
const docsDir = path.resolve('docs');

// Allow CORS for local file usage and simple testing
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Simple health
app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/convert-to-markdown', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ success: false, error: 'Invalid or missing url parameter' });
    }

    // Optional insecure TLS to handle self-signed cert chains behind corporate proxies.
    // Enable by starting the server with env ALLOW_INSECURE_TLS=1
    const agentFn = (parsedUrl) => {
      try {
        if (process.env.ALLOW_INSECURE_TLS === '1' && parsedUrl.protocol === 'https:') {
          return new https.Agent({ rejectUnauthorized: false });
        }
      } catch (_) {
        // ignore
      }
      return undefined;
    };

    const response = await fetch(url, {
      redirect: 'follow',
      // Provide a browser-like UA and accept headers to reduce blocks
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      agent: agentFn,
    });
    if (!response.ok) {
      return res.status(502).json({ success: false, error: `Failed to fetch: ${response.status} ${response.statusText}` });
    }
    const html = await response.text();

    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });

    // Remove images from the converted Markdown
    turndownService.addRule('removeImages', {
      filter: ['img', 'picture', 'figure'],
      replacement: () => ''
    });

    // Remove captions specifically
    turndownService.addRule('removeFigcaptions', {
      filter: ['figcaption', 'caption'],
      replacement: () => ''
    });

    // Remove video and iframe embeds
    turndownService.addRule('removeEmbeds', {
      filter: (node) => {
        return (
          node.nodeName.toLowerCase() === 'video' ||
          node.nodeName.toLowerCase() === 'iframe' ||
          node.nodeName.toLowerCase() === 'embed' ||
          node.nodeName.toLowerCase() === 'object' ||
          node.nodeName.toLowerCase() === 'source'
        );
      },
      replacement: () => ''
    });

    // Convert full page to markdown
    const markdown = turndownService.turndown(html);

    // Ensure docs directory exists
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

    // Create readable filename from URL
    const urlObj = new URL(url);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = sanitize(`${urlObj.hostname}${urlObj.pathname}`.replace(/\/+/, '/').replace(/\//g, '_')) || 'page';
    const fileName = `${baseName}_${timestamp}.md`;
    const filePath = path.join(docsDir, fileName);

    fs.writeFileSync(filePath, markdown, 'utf8');

    return res.json({ success: true, filename: fileName });
  } catch (err) {
    console.error('convert error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
