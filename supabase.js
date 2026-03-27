/* ============================================================
   G-Logic Automation — Supabase Client Initialization
   ============================================================
   INSTRUCTIONS:
   1. Go to https://supabase.com and create a free project
   2. Go to Project Settings → API
   3. Copy your Project URL and paste it below
   4. Copy your anon/public key and paste it below
   ============================================================ */

const SUPABASE_URL = 'https://iaqdmcuxlmcauqdmcbdf.supabase.co';       // e.g. https://xyzcompany.supabase.co
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhcWRtY3V4bG1jYXVxZG1jYmRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NTI2NjUsImV4cCI6MjA4ODMyODY2NX0.yaaFl_iX260LRfKXReSeejc6YMQM5SAwrE_tWrnMjVc';     // e.g. eyJhbGciOiJIUzI1NiIs...

// Initialize the Supabase client (available globally)
window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
