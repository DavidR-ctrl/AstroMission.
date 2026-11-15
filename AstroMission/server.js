const http = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);

const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/astromission.html", ["astromission.html", "text/html; charset=utf-8"]],
  ["/Style.css", ["Style.css", "text/css; charset=utf-8"]],
  ["/astromission.css", ["astromission.css", "text/css; charset=utf-8"]],
  ["/config.js", ["config.js", "text/javascript; charset=utf-8"]],
  ["/nasa.js", ["nasa.js", "text/javascript; charset=utf-8"]],
  ["/Game.js", ["Game.js", "text/javascript; charset=utf-8"]],
  ["/astromission.js", ["astromission.js", "text/javascript; charset=utf-8"]],
  ["/moon-surface.jpg", ["moon-surface.jpg", "image/jpeg"]],
  ["/mars-surface.jpg", ["mars-surface.jpg", "image/jpeg"]],
  ["/marte.png", ["marte.png", "image/png"]],
  ["/fondo.png", ["fondo.png", "image/png"]],
  ["/info.txt", ["info.txt", "text/plain; charset=utf-8"]]
]);

function sendText(response, status, text) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(text);
}

async function serveStatic(pathname, request, response) {
  const file = STATIC_FILES.get(pathname);
  if (!file) return sendText(response, 404, "Not found.");
  try {
    const content = await readFile(path.join(__dirname, file[0]));
    response.writeHead(200, {
      "Content-Type": file[1],
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    console.error("Unable to serve", file[0], error);
    sendText(response, 500, "Unable to serve the requested file.");
  }
}

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    return sendText(response, 405, "Method not allowed.");
  }
  return serveStatic(pathname, request, response);
});

server.listen(PORT, HOST, () => {
  console.log(`AstroMission ready at http://${HOST}:${PORT}`);
});
