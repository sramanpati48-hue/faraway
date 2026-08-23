---
type: "query"
date: "2026-08-19T10:46:41.780523+00:00"
question: "how the scams agent works for the cases"
contributor: "graphify"
outcome: "useful"
source_nodes: ["scam_agent()", "supervisor_agent()", "agent_graph.py", "get_local_scam_summary()", "get_user_location_context()", "find_similar_mock_scam_trends()", "report_agent.py", "scam_case_classifier.py"]
---

# Q: how the scams agent works for the cases

## Answer

Expanded from original query via vocab: [scam, scams, agent, case, supervisor, specialist, router, trend, location, mock, report, graph]. supervisor_agent in agent_graph.py classifies a user problem as scam when it is a suspicious call/message with no money lost yet, then plan_runner invokes scam_agent. scam_agent resolves location, pulls local VectorDB scam alerts, matches mock_scams via find_similar_mock_scam_trends, and run_specialist writes matched_scam_trends plus case_category=scam. report_generator grounds the case report on those trends. Background scam_case_classifier later clusters similar public.cases into mock_scams so future scam_agent matches improve.

## Outcome

- Signal: useful

## Source Nodes

- scam_agent()
- supervisor_agent()
- agent_graph.py
- get_local_scam_summary()
- get_user_location_context()
- find_similar_mock_scam_trends()
- report_agent.py
- scam_case_classifier.py