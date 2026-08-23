-- Restore prior provider defaults: Groq for chat, OpenRouter owl-alpha for clash.
-- OpenRouter/Nemotron and Gemini remain selectable from admin.

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
    "preprocess": {"provider": "openrouter", "model": "openrouter/owl-alpha"},
    "prosecution": {"provider": "openrouter", "model": "openrouter/owl-alpha"},
    "defence": {"provider": "openrouter", "model": "openrouter/owl-alpha"},
    "defence_cross_answer": {"provider": "openrouter", "model": "openrouter/owl-alpha"},
    "judge_round": {"provider": "openrouter", "model": "openrouter/owl-alpha"},
    "final_judge": {"provider": "openrouter", "model": "openrouter/owl-alpha"},
    "incorporate_answer": {"provider": "openrouter", "model": "openrouter/owl-alpha"}
  }
}'::jsonb,
updated_at = now()
WHERE key = 'graph_node_models';

UPDATE public.system_config
SET value = '{
  "provider": "groq",
  "groq_model": "llama-3.3-70b-versatile",
  "openrouter_model": "openrouter/owl-alpha",
  "gemini_model": "gemini-2.5-flash"
}'::jsonb,
updated_at = now()
WHERE key = 'sql_generation';
