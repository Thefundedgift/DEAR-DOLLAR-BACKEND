# Local preview proxy ONLY. Production deployment uses Docker Compose (see README.md).
# Supervisor runs this FastAPI app on :8001; it proxies every request to the NestJS API on :4000.
import os
import subprocess
import asyncio

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import Response

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
NODE_URL = "http://127.0.0.1:4000"

def ensure_services():
    subprocess.run(["bash", os.path.join(BACKEND_DIR, "start_services.sh")], check=False)

ensure_services()

app = FastAPI()
client = httpx.AsyncClient(base_url=NODE_URL, timeout=60.0)

HOP_HEADERS = {"content-encoding", "transfer-encoding", "connection", "content-length", "keep-alive"}

@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy(request: Request, path: str):
    url = f"/{path}"
    if request.url.query:
        url += f"?{request.url.query}"
    headers = {k: v for k, v in request.headers.items() if k.lower() != "host"}
    body = await request.body()
    for attempt in range(2):
        try:
            resp = await client.request(request.method, url, headers=headers, content=body)
            break
        except (httpx.ConnectError, httpx.ReadError):
            if attempt == 1:
                return Response(content='{"error":"upstream unavailable"}', status_code=502, media_type="application/json")
            ensure_services()
            await asyncio.sleep(2.5)
    resp_headers = {k: v for k, v in resp.headers.items() if k.lower() not in HOP_HEADERS}
    return Response(content=resp.content, status_code=resp.status_code, headers=resp_headers)
