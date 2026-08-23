import psycopg

for label, url in [("Local", "postgresql://nyaya_app:nyaya_app_dev@localhost:55432/nyaysahayak"), ("Remote", "postgresql://nyaya_app:nyaya_app_dev@34.142.251.116:5432/nyaysahayak")]:
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM users WHERE email LIKE 'nodal.%@nyaysahayak.in'")
            cnt = cur.fetchone()[0]
            print(f"Nodal guides in users table ({label}): {cnt}")
