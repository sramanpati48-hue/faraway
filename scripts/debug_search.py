from duckduckgo_search import DDGS
import time

topic = "IPC Section 302"
queries = [
    f"{topic} indiankanoon.org",
    f"{topic} wikipedia india",
    f"{topic}"
]

for q in queries:
    print(f"\nTesting Query (text): '{q}'")
    try:
        # Try both text and html backends if available, or just standard text
        with DDGS() as ddgs:
            results = list(ddgs.text(q, max_results=5))
            if results:
                print(f"✅ Found {len(results)} results.")
                print(f"   First: {results[0]['href']}")
            else:
                print("❌ Found 0 results.")
    except Exception as e:
        print(f"❌ Error: {e}")
    time.sleep(2)

for q in queries:
    print(f"\nTesting Query: '{q}'")
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(q, max_results=5))
            if results:
                print(f"✅ Found {len(results)} results.")
                print(f"   First result: {results[0]['href']}")
            else:
                print("❌ Found 0 results.")
    except Exception as e:
        print(f"❌ Error: {e}")
    time.sleep(2) # Avoid rate limits
