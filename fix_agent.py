import re

with open("backend/voice/agent.py", "r", encoding="utf-8") as f:
    content = f.read()

# Fix f"...\n"
content = re.sub(r'f"(.*?)\n"', r'f"\1\\n"', content)
# Fix f'...\n'
content = re.sub(r"f'(.*?)\n'", r"f'\1\\n'", content)

with open("backend/voice/agent.py", "w", encoding="utf-8") as f:
    f.write(content)
print("done")
