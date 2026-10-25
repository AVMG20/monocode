// Minimal static server for a built dist-navbench directory.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".json": "application/json",
  ".wasm": "application/wasm",
};
module.exports = function serve(root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          res.writeHead(204);
          res.end();
          server.emit("result", body);
        });
        return;
      }
      const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const file = path.join(root, url);
      fs.readFile(file, (error, data) => {
        if (error) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, {
          "content-type": types[path.extname(file)] ?? "application/octet-stream",
          "cache-control": "no-store",
        });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
};
