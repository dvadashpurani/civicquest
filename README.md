# civicquest

## Supabase setup

Public sign-up is disabled. Accounts come only from invites, the seed script, or admin-created Leader logins, and the app has no sign-up page or action.

In the Supabase dashboard, go to **Authentication → Sign In / Providers** and turn **Allow new users to sign up** off. With it off, Supabase Auth rejects any self-service sign-up request (for example a direct call to `/auth/v1/signup` with the public anon key) without creating an account. Do this for every project, including dev.

Login attempts are rate-limited in the `/login` server action: 5 per minute per email and 20 per minute per client IP, counted in `public.rate_limits`. The keys are SHA-256 hashes, so no email address or IP is stored.

## Credits

Icons and characters are [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) by Microsoft, in the 3D style, used under the [MIT License](https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE). The PNGs are self-hosted in `public/icons/`.
