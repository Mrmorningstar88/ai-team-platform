"""AI team bridge (Arut 2026-11-13): Claude sends one task to GPT-6 Astra, Perplexity or Grok with the keys
already kept in this repo's secrets. Reads ai-team/request.json, writes ai-team/out/<id>/ (answer.md, images).
Keys are never printed. Routing rule: Astra = design and animation, Perplexity = fast answers, Grok = trading."""
import base64, json, os, pathlib, sys, time, urllib.error, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent


def post(url, key, body, timeout=600):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + key, "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as ex:
        raise RuntimeError(f"HTTP {ex.code}: {ex.read().decode('utf-8', 'replace')[:800]}") from None


def need(env):
    k = os.environ.get(env, "").strip()
    if not k:
        raise RuntimeError(f"{env} is not set in this repository's secrets")
    return k


def images_in(task):
    return [{"type": "input_image", "image_url": u} for u in task.get("images", [])[:10]]


def astra(task, out):
    key = need("OPENAI_API_KEY")
    model = task.get("model") or "gpt-6-astra"
    content = [{"type": "input_text", "text": task["prompt"]}] + images_in(task)
    body = {"model": model, "input": [{"role": "user", "content": content}],
            "reasoning": {"effort": task.get("effort", "medium")}}
    if task.get("image_tool"):
        body["tools"] = [{"type": "image_generation"}]
    j = post("https://api.openai.com/v1/responses", key, body)
    text, n = [], 0
    for item in j.get("output", []):
        if item.get("type") == "message":
            text += [c.get("text", "") for c in item.get("content", []) if c.get("type") == "output_text"]
        if item.get("type") == "image_generation_call" and item.get("result"):
            n += 1
            (out / f"image{n}.png").write_bytes(base64.b64decode(item["result"]))
    return "\n".join(text), {"model": j.get("model"), "usage": j.get("usage"), "images": n}


def image(task, out):
    key = need("OPENAI_API_KEY")
    j = post("https://api.openai.com/v1/images/generations", key, {
        "model": task.get("model") or "gpt-image-2", "prompt": task["prompt"], "size": task.get("size", "1024x1024"),
        "n": min(int(task.get("n", 1)), 4)})
    for i, d in enumerate(j.get("data", []), 1):
        if d.get("b64_json"):
            (out / f"image{i}.png").write_bytes(base64.b64decode(d["b64_json"]))
    return f"{len(j.get('data', []))} image(s) saved", {"usage": j.get("usage")}


def perplexity(task, out):
    key = need("PERPLEXITY_API_KEY")
    j = post("https://api.perplexity.ai/v1/agent", key, {
        "preset": task.get("preset", "fast"), "input": task["prompt"], "tools": [{"type": "web_search"}]})
    text = []
    for item in j.get("output", []):
        if item.get("type") == "message":
            text += [c.get("text", "") for c in item.get("content", []) if c.get("type") == "output_text"]
    return "\n".join(text) or j.get("output_text", ""), {"model": j.get("model"), "usage": j.get("usage")}


def grok(task, out):
    key = need("XAI_API_KEY")
    content = [{"type": "text", "text": task["prompt"]}] + [{"type": "image_url", "image_url": {"url": u}} for u in task.get("images", [])[:10]]
    j = post("https://api.x.ai/v1/chat/completions", key, {
        "model": task.get("model") or "grok-4.7", "messages": [{"role": "user", "content": content}],
        "reasoning_effort": task.get("effort", "low")})
    return j["choices"][0]["message"]["content"], {"model": j.get("model"), "usage": j.get("usage")}


BOTS = {"astra": astra, "image": image, "perplexity": perplexity, "grok": grok}


def main():
    req = json.loads((ROOT / "request.json").read_text(encoding="utf-8"))
    tasks = req if isinstance(req, list) else [req]
    for t in tasks:
        tid = t.get("id") or f"{t['bot']}-{int(time.time())}"
        out = ROOT / "out" / tid
        out.mkdir(parents=True, exist_ok=True)
        t0 = time.time()
        try:
            text, meta = BOTS[t["bot"]](t, out)
            ok = True
        except Exception as ex:  # noqa: BLE001 (report any failure in plain words)
            text, meta, ok = f"FAILED: {ex}", {}, False
        meta |= {"bot": t["bot"], "ok": ok, "seconds": round(time.time() - t0, 1)}
        (out / "answer.md").write_text(text, encoding="utf-8")
        (out / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
        print(f"\n===== {tid} ({t['bot']}) ok={ok} =====\n{text[:6000]}\n{json.dumps(meta)}")


if __name__ == "__main__":
    sys.exit(main())
