INSERT INTO public.langgraph_query_presets (graph_id, name, query, initial_state)
SELECT * FROM (VALUES
  ('chat_agent', 'Cyber fraud sample', 'Someone stole money from my UPI account in Delhi', '{"location":{"city":"Delhi","state":"Delhi","lat":28.6139,"lon":77.2090}}'::jsonb),
  ('chat_agent', 'Domestic violence sample', 'I need help with domestic violence at home', '{"location":{"city":"Mumbai","state":"Maharashtra"}}'::jsonb),
  ('clash_agent', 'Clash practice', 'Argue a mock cybercrime case', '{}'::jsonb)
) AS v(graph_id, name, query, initial_state)
WHERE NOT EXISTS (
  SELECT 1 FROM public.langgraph_query_presets p WHERE p.graph_id = v.graph_id AND p.name = v.name
);
