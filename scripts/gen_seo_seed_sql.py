from pathlib import Path
import json
import sys
sys.path.insert(0, ".")
from backend.services.seo_pages import default_config, _strip_previous

cfg = _strip_previous(default_config())
payload = json.dumps(cfg, ensure_ascii=False, separators=(",", ":"))
tag = "seo"
sql = f"""-- Seed full SEO pages config for production (nyaysahayak.eu.cc).
-- Upserts live seo_pages and permanent seo_pages_defaults.
-- Safe to re-run: overwrites both keys with the factory seed (admin can re-edit after).

INSERT INTO public.system_config (key, value, updated_at)
VALUES (
  'seo_pages',
  ${tag}${payload}${tag}$::jsonb,
  now()
)
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = now();

INSERT INTO public.system_config (key, value, updated_at)
VALUES (
  'seo_pages_defaults',
  ${tag}${payload}${tag}$::jsonb,
  now()
)
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = now();
"""
out = Path("backend/database/migrations/024_seed_seo_pages.sql")
out.write_text(sql, encoding="utf-8")
# verify
text = out.read_text(encoding="utf-8")
assert "$seo$" in text
start = text.index("$seo$") + len("$seo$")
end = text.index("$seo$::jsonb")
parsed = json.loads(text[start:end])
print("Wrote", out, "bytes", out.stat().st_size)
print("base_url", parsed["base_url"], "routes", len(parsed["routes"]))
