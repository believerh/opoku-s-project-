OKOMFO ANOKYE UPDATES — UPGRADE STARTER
========================================

WHAT THIS VERSION DOES
- Reads published posts from shared Supabase online storage.
- Provides an admin email/password login (not the old DEMO-ADMIN code).
- Restricts creating, editing, publishing and deleting posts to one configured admin email using database Row Level Security.
- Uploads images and videos to shared online storage so visitors on different devices can see them.
- Includes a basic installable web-app manifest and service worker.

IMPORTANT LIMITATION
This package is prepared but is NOT connected to your database yet. It will not publish online until you complete the setup below. The "Get news alerts" button currently asks the visitor to allow browser notifications, but automatic push alerts to subscribers are NOT fully configured in this starter. Real push delivery needs VAPID keys, saved subscriptions, and a server-side sender function. Do not promise readers that they will automatically receive push alerts until that part is installed and tested.

SETUP (DO THIS IN ORDER)
1. Create a Supabase project at https://supabase.com/.
2. In Supabase, open SQL Editor.
3. Open supabase/schema.sql from this package.
4. Replace every occurrence of ADMIN_EMAIL with the one email address you want to use as the only administrator. Keep the single quotes around the email.
5. Run the SQL.
6. In Supabase Authentication > Users, create/invite that admin email and set a strong password.
7. In Supabase Authentication settings, disable public sign-ups. Do not create other user accounts.
8. In Supabase Project Settings > API, copy the Project URL and anon/public key.
9. Edit config.js and replace YOUR_SUPABASE_PROJECT_URL and YOUR_SUPABASE_ANON_KEY with those values. The anon key is designed to be public; NEVER put the service-role key in config.js.
10. Upload the contents of this folder to your Netlify site / deploy the folder as a new Netlify deploy.
11. Test on your phone and another device: public visitors should see posts; only the configured admin should be able to sign in and publish.

HOW TO DEPLOY TO NETLIFY
- Extract the ZIP on a computer if possible.
- In Netlify, open your existing site and go to Deploys.
- Drag the extracted website folder's contents into the manual deploy area, or use Netlify CLI / a connected Git repository.
- The folder's index.html must be at the root of the deployed site.

ADMIN-ONLY RULE
The website hides the dashboard unless signed in, but the actual protection is enforced by Supabase Row Level Security and Storage policies. This is why you must run the SQL with the correct admin email and disable public sign-ups.

MEDIA
- Up to 8 pictures per post, 5 MB each.
- One video per post, up to 50 MB.
- Supported types are common images and MP4/WebM/QuickTime videos.
- Uploaded media is stored online in the Supabase `post-media` bucket.

NEWS ALERTS
This package does not yet deliver automatic push notifications to all readers. Browser notification permission by itself is not enough. Readers need to subscribe, and a secure server function must send the push messages. This requires additional setup and testing before claiming that all subscribers will receive alerts.

PRIVACY
Because this is a school website, get permission before posting identifiable student photos/videos, and avoid posting private health details or humiliating content.
