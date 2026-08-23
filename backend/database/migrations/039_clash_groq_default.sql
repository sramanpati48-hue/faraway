-- Clash Mode: switch from OpenRouter free nemotron (often rate-limited) to Groq.
-- Existing deployments keep per-node overrides; only missing clash nodes are filled.

UPDATE public.system_config
SET value = jsonb_set(
  COALESCE(value, '{}'::jsonb),
  '{clash_agent}',
  COALESCE(value->'clash_agent', '{}'::jsonb) || '{
    "preprocess": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "prosecution": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "defence": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "cross_exam": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "ai_cross_answer": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "judge_round": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "final_judge": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "incorporate_answer": {"provider": "groq", "model": "llama-3.3-70b-versatile"}
  }'::jsonb,
  true
),
updated_at = now()
WHERE key = 'graph_node_models';

-- Force-update nodes still pinned to the flaky free nemotron model.
UPDATE public.system_config
SET value = (
  SELECT jsonb_object_agg(
    graph_key,
    CASE
      WHEN graph_key = 'clash_agent' THEN (
        SELECT jsonb_object_agg(
          node_key,
          CASE
            WHEN (node_val->>'provider') = 'openrouter'
              AND (node_val->>'model') = 'nvidia/nemotron-3-ultra-550b-a55b:free'
            THEN '{"provider": "groq", "model": "llama-3.3-70b-versatile"}'::jsonb
            ELSE node_val
          END
        )
        FROM jsonb_each(COALESCE(value->'clash_agent', '{}'::jsonb)) AS n(node_key, node_val)
      )
      ELSE graph_val
    END
  )
  FROM jsonb_each(COALESCE(value, '{}'::jsonb)) AS g(graph_key, graph_val)
),
updated_at = now()
WHERE key = 'graph_node_models'
  AND value ? 'clash_agent';
