'use strict';

require('dotenv').config();

const hasSupabaseConfig = Boolean(process.env.SUPABASE_URL && process.env.DATABASE_URL && (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY));

if (hasSupabaseConfig) {
  require('./hosted').start().catch(error => {
    console.error('Could not start StudyMate with Supabase:', error.message);
    process.exit(1);
  });
} else if (process.env.NODE_ENV === 'production') {
  throw new Error('Production requires SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and DATABASE_URL.');
} else {
  require('./sqlite');
}
