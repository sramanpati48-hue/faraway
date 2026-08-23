import sys
import os
from unittest.mock import MagicMock, patch

# Add project root to path
sys.path.append(os.getcwd())

# Mock VectorDB AND Utils BEFORE importing agents
modules_to_patch = {
    'database.vector_db': MagicMock(),
    'utils': MagicMock(),
}

with patch.dict('sys.modules', modules_to_patch):
    # Setup mocks
    mock_vdb = MagicMock()
    mock_vdb.search.return_value = ["Relevant legal context regarding cyber crime..."]
    modules_to_patch['database.vector_db'].VectorDB.return_value = mock_vdb
    
    mock_llm = MagicMock()
    mock_llm.invoke.return_value = MagicMock(content="Mocked Bengali Response: আমার ব্যাঙ্ক অ্যাকাউন্ট...")
    modules_to_patch['utils'].llm = mock_llm

    # Now import the agent
    from backend.agents.cyber_agent import cyber_agent
    from langchain_core.messages import HumanMessage

def test_cyber_agent_bengali_prompt():
    print("🧪 Testing Cyber Agent PROMPT construction for Bengali...")
    
    bengali_query = "আমার ব্যাঙ্ক অ্যাকাউন্ট থেকে কেউ টাকা তুলে নিয়েছে।"
    state = {
        "messages": [HumanMessage(content=bengali_query)],
        "user_details": {
            "location": {"lat": 22.5726, "lon": 88.3639}
        }
    }
    
    print(f"📥 Input: {bengali_query}")
    
    try:
        # Run agent
        cyber_agent(state)
        
        # Verify LLM was called
        from backend.utils import llm
        if llm.invoke.called:
            print("✅ LLM was invoked.")
            
            # Inspect arguments
            args, _ = llm.invoke.call_args
            messages = args[0]
            system_msg = messages[0].content
            
            print("\n📜 System Prompt Dump (Partial):")
            print(system_msg[:500] + "...")
            
            # Check for Bengali instructions
            required_phrases = [
                "LANGUAGE & AUDIO HANDLING",
                "Bengali",
                "RESPOND IN THAT SAME LANGUAGE"
            ]
            
            missing = [p for p in required_phrases if p not in system_msg]
            
            if not missing:
                print("\n✅ Verification PASSED: System prompt contains all Bengali language instructions.")
            else:
                print(f"\n❌ Verification FAILED: Missing instructions in prompt: {missing}")
                
        else:
            print("❌ Verification FAILED: LLM was not invoked.")
            
    except Exception as e:
        print(f"\n❌ Verification ERROR: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_cyber_agent_bengali_prompt()
