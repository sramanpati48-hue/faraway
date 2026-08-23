from googlesearch import search

print("Testing Google Search...")
try:
    query = "IPC Section 302"
    print(f"Query: {query}")
    results = list(search(query, num_results=3, sleep_interval=1))
    print(f"Found {len(results)} results:")
    for i, url in enumerate(results, 1):
        print(f"  {i}. {url}")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
