// Browser-safe Supabase project settings. The publishable key is intended for client use.
window.CURATOR_SUPABASE_CONFIG = {
    url: 'https://iyedwajjelatqzqstmkc.supabase.co',
    publishableKey: 'sb_publishable_rvGdzsGNhm-dXZ0ATcuAJA_NoETne6F'
};

if (!window.supabase?.createClient) {
    console.error('Supabase client library did not load.');
} else {
    window.curatorSupabase = window.supabase.createClient(
        window.CURATOR_SUPABASE_CONFIG.url,
        window.CURATOR_SUPABASE_CONFIG.publishableKey,
        { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
    );
}
