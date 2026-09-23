# Supabase database CA

`supabase-prod-ca-2021.crt` is the public Supabase production root certificate,
downloaded on September 22, 2026 from the URL used by Supabase Studio:

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Source: https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json

The beta containers set `PGSSLROOTCERT` to this certificate. Database URLs use
`sslmode=verify-full` to verify both the certificate chain and hostname. For a
different database provider, configure its trusted root certificate instead.
