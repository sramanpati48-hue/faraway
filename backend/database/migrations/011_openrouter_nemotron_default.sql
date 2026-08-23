-- Replace deprecated openrouter/owl-alpha with nvidia/nemotron-3-ultra-550b-a55b:free

UPDATE public.system_config
SET value = '{
  "chat_agent": {
    "supervisor": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "cyber": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "civil": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "domestic": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "scam": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "document": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "sahayak": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "legal_moderator": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "lawyer_forwarder": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "question_processor": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "report_generator": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "nodal_guide": {"provider": "groq", "model": "llama-3.3-70b-versatile"},
    "sexual_offense": {"provider": "groq", "model": "llama-3.3-70b-versatile"}
  },
  "clash_agent": {
    "preprocess": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
    "prosecution": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
    "defence": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
    "defence_cross_answer": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
    "judge_round": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
    "final_judge": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"},
    "incorporate_answer": {"provider": "openrouter", "model": "nvidia/nemotron-3-ultra-550b-a55b:free"}
  }
}'::jsonb,
updated_at = now()
WHERE key = 'graph_node_models';

UPDATE public.system_config
SET value = jsonb_set(
  COALESCE(value, '{}'::jsonb),
  '{openrouter_model}',
  '"nvidia/nemotron-3-ultra-550b-a55b:free"'
),
updated_at = now()
WHERE key = 'sql_generation';
