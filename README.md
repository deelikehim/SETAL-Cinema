# SETAL Cinema
Deploy as a Cloudflare **Worker**. Import this GitHub repository in Workers & Pages, name the Worker **setal-cinema**, use the repository root, leave the build command empty, and use **npx wrangler deploy** as the deploy command. Wrangler runs the configured build, uploads client assets, and provisions the D1 binding. Schema creation runs on first use.
 
Add a runtime **Secret** named **CINEBASE_API_KEY** containing your GlobalMovie provider key. Configure the key before testing streaming, downloads and subtitle tracks.
 
For account features, create a Cloudflare Access self-hosted application covering the Worker hostname (including /account/login), configure the desired identity provider and access policy, and set the Worker variables **TEAM_DOMAIN** (your full HTTPS Access team origin) and **POLICY_AUD** (the application audience). Without Access, media browsing works and account features stay signed out. Protecting the entire hostname requires visitors to sign in before browsing.
 
The homepage checks the provider on entry and every five minutes while the site is visible. It merges the provider's trending and movie-list results with the bundled catalog. Titles enter the homepage when those feeds return them. A title available only through search may not appear immediately.
