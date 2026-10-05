/* =====================================================================
   Usambazi: config.js
   Your Supabase project's address and public key.

   Where to find them (Supabase website):
     1. Open your project.
     2. Click "Project Settings" (the gear icon, bottom left).
     3. Click "API Keys" (or "API" on older screens) and "Data API".
     4. Copy the Project URL into SUPABASE_URL.
     5. Copy the "Publishable key" (starts with sb_publishable_) or the
        legacy "anon public" key into SUPABASE_KEY.

   This key is safe to be public ONLY because Row Level Security is
   switched on for every table (sql/02_security.sql).

   NEVER paste the "secret" or "service_role" key here. That key skips
   all the security rules and must never be in the app.
   ===================================================================== */

var SUPABASE_URL = 'https://mbuuorgcoyhkencceedp.supabase.co';   // e.g. https://abcdefghijkl.supabase.co
var SUPABASE_KEY = 'sb_publishable_s98ZV2wLf8oqzatKoPzMnw_UUChrF6i';
