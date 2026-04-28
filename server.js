const http = require("http");
const net = require("net");
const url = require("url");

// safer pipe helper
const safePipe = (src, dest) => {
    src.pipe(dest);

    src.on("error", () => dest.destroy());
    dest.on("error", () => src.destroy());
};

// HTTP proxy
const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url);

    // ❗ if no hostname → bad request
    if (!parsed.hostname) {
        res.writeHead(400);
        return res.end("Invalid URL");
    }

    const options = {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.path,
        method: req.method,
        headers: req.headers
    };

    const proxyReq = http.request(options, (proxyRes) => {
        // ⚠️ only write headers if still open
        if (!res.headersSent) {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
        }

        safePipe(proxyRes, res);
    });

    // 🔥 CRITICAL: handle aborts
    req.on("aborted", () => proxyReq.destroy());

    // 🔥 prevent EPIPE crash
    proxyReq.on("error", (err) => {
        if (err.code !== "EPIPE") {
            console.error("ProxyReq error:", err.message);
        }

        if (!res.headersSent) {
            res.writeHead(502);
        }

        if (!res.writableEnded) {
            res.end("Proxy error");
        }
    });

    safePipe(req, proxyReq);
});


// HTTPS (CONNECT tunneling)
server.on("connect", (req, clientSocket, head) => {
    const { port, hostname } = new URL(`http://${req.url}`);

    const serverSocket = net.connect(port || 443, hostname, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

        if (head && head.length) {
            serverSocket.write(head);
        }

        safePipe(serverSocket, clientSocket);
        safePipe(clientSocket, serverSocket);
    });

    // 🔥 handle both sides
    serverSocket.on("error", (err) => {
        if (err.code !== "EPIPE") {
            console.error("ServerSocket error:", err.message);
        }
        clientSocket.destroy();
    });

    clientSocket.on("error", () => {
        serverSocket.destroy();
    });

    clientSocket.on("close", () => {
        serverSocket.destroy();
    });
});

server.listen(8080, "0.0.0.0", () => {
    console.log("🔥 HTTP/HTTPS Proxy running on port 8080");
});
