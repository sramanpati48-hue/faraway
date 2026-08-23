import os
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

from dotenv import load_dotenv

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()
load_dotenv(dotenv_path="../backend/agents/.env")

from langchain_core.messages import HumanMessage
from backend.agent_graph import agent_graph

def run_test(query: str, thread_id: str = "test_1"):
    print(f"\n{'='*50}")
    print(f"User Query: {query}")
    print(f"{'='*50}")
    
    config = {"configurable": {"thread_id": thread_id}}
    state = {
        "messages": [HumanMessage(content=query)],
        "user_details": {"user_id": "test_user_123", "location": {"city": "New Delhi", "state": "Delhi"}}
    }
    
    outputs = []
    for output in agent_graph.stream(state, config=config):
        for node_name, node_state in output.items():
            print(f"\n--- Node Executed: {node_name} ---")
            
            # Print state details if present
            if "structured_report" in node_state:
                print("Structured Report Criticality:", node_state["structured_report"].get("criticality", "N/A"))
            if "next_step" in node_state:
                print("Next Step Flagged:", node_state["next_step"])
            if "final_response" in node_state:
                 print("\nFinal Response Snippet (First 200 chars):")
                 print(node_state["final_response"][:200] + "...")
            
            outputs.append(node_state)
    return outputs

print("\n--- TEST 1: Moderate Criticality (< 10k fraud) ---")
run_test("I lost 5000 rupees in an online shopping scam.", "test_mode_1")

print("\n--- TEST 2: High Criticality (MLAT / International / High Amount) ---")
run_test("I was scammed out of 50 lakhs by an international syndicate operating abroad with fake documents.", "test_high_crit_1")

print("\n--- TEST 3: Satisfaction Routing (Unsatisfied) ---")
# Continuation of test_mode_1
run_test("No, I am not satisfied. I need a nyaysahayak to help me physically.", "test_mode_1")

print("\nTests complete.")
