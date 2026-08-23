from duckduckgo_search import DDGS

print("Testing DuckDuckGo Search...")
try:
    with DDGS() as ddgs:
        results = list(ddgs.text("IPC Section 302", max_results=5))
        print(f"Found {len(results)} results.")
        for r in results:
            print(r)
except Exception as e:
    print(f"Error: {e}")
