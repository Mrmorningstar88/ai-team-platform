#!/usr/bin/env bash
# Temporary: edits Arut's thumbnail via OpenAI image edits. Runs on push to this branch only.
set -u
cd .github/thumb2; mkdir -p out
[ -n "${OPENAI_API_KEY:-}" ] && echo "openai key: yes" || { echo "openai key: NO"; exit 1; }
for name in vert horiz; do
  size=1024x1536; [ "$name" = horiz ] && size=1536x1024
  prompt=$(python3 -c "import json;print(json.load(open('prompts.json'))['$name'])")
  for model in gpt-image-2 gpt-image-1.5 gpt-image-1; do
    curl -s https://api.openai.com/v1/images/edits -H "Authorization: Bearer $OPENAI_API_KEY" \
      -F model=$model -F "image[]=@in/poster.jpg" -F "image[]=@in/face.jpg" \
      -F "prompt=$prompt" -F size=$size -F quality=high -F n=2 -F input_fidelity=high -o resp.json --max-time 600
    if python3 - "$name" "$model" <<'PY'
import json,base64,sys
r=json.load(open('resp.json'));n,m=sys.argv[1],sys.argv[2]
if 'data' not in r: print('fail',n,m,str(r)[:400]); sys.exit(1)
for i,d in enumerate(r['data']): open(f'out/{n}-{i}.png','wb').write(base64.b64decode(d['b64_json']))
print('ok',n,m)
PY
    then break; fi
  done
done
rm -f resp.json
