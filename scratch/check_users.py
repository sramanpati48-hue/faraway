import psycopg

DATABASE_URL = "postgresql://nyaya_app:nyaya_app_dev@localhost:55432/nyaysahayak"

with psycopg.connect(DATABASE_URL) as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.users'::regclass")
        print("Users constraints:")
        for row in cur.fetchall():
            print(" ", row)

        cur.execute("SELECT id, email, role, display_name FROM public.users LIMIT 20")
        print("\nUsers table sample:")
        for row in cur.fetchall():
            print(" ", row)

        cur.execute("SELECT id, name, email FROM public.nodal_guides LIMIT 5")
        print("\nNodal guides sample:")
        for row in cur.fetchall():
            print(" ", row)
