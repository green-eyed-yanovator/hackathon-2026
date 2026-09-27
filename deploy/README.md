# A short DigitalOcean demo

Use Ubuntu 24.04 x64, Basic Regular, 2 vCPU / 4 GB RAM / 80 GB SSD.
Prefer Sydney (Singapore if that plan is unavailable). The current published
price is US$0.03571/hour: about US$0.86/day or US$2.57 for three days, before tax.
No paid volumes, backups, load balancer or managed database are needed.

The server runs the official Supabase release `self-hosted/v0.8.2` (commit
`564eab8ad7840b13324f68b1bfac074ef8d51c21`) with a fresh database and the demo
neighbourhood. It does not upload the Mac's database, accounts, passwords,
environment files or SSH private key. The local Docker-free setup is separate.

Create the Droplet using an SSH public key whose private key you have locally.
Once it has a public IPv4 address:

```sh
bash deploy/upload.sh <Droplet IPv4> <SSH private key path>
```

This copies the current source, installs Node 22, Docker and Caddy, generates
new server secrets, applies migrations, seeds the demo, uploads demo photos,
builds the frontend, and starts HTTPS. Its default address is
`https://aroundhere-<IP with dashes>.sslip.io`. You can supply your own hostname
as a third argument after pointing its DNS A record at the Droplet.

Only SSH, HTTP and HTTPS are public. The database/pooler have no published
ports; the API gateway binds to loopback. Caddy publishes the app's four API
paths and static files. Studio, the local mailbox and source/config files
are not exposed. Data lives in `/opt/aroundhere/supabase-stack/volumes`.
Containers and Caddy restart when the server restarts. Re-running upload
preserves database data and secrets and applies any new migrations.

## Accounts and email

Demo accounts use `maya@aroundhere.demo`, `tom@aroundhere.demo`, etc., with
password `neighbour`. Anyone can create an account and sign in by password.
Without SMTP, email addresses are **not verified**, and emailed sign-in/reset
codes return an explicit unavailable message. This is a temporary demo;
do not represent its accounts as verified identities.

To enable email delivery, edit the private server file
`/opt/aroundhere/supabase-stack/.env` and set `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL`, and `SMTP_SENDER_NAME` from your
email provider. Re-run upload. Newly registered users then require confirmation;
existing demo accounts remain usable. The code templates are served at
`/email-templates/login_code.html` and `/email-templates/reset_code.html`.
Verify one real sign-in email and password-reset email before offering codes.
OAuth providers require their own provider configuration.

## Verification and stopping charges

After deployment, verify HTTPS, map and demo photos, signup/password login,
creating a pin, an image upload, and a live update in a second browser.
Check `/_mail.json` and `/pg/` return 404; confirm ports 5432, 6543 and 8000
are unreachable from outside. Check `docker compose ps` in the stack directory
and `systemctl status caddy` if anything fails.

When finished, download any data you want to keep and **destroy the Droplet**
in DigitalOcean. Powering it off does not stop billing. This script creates
no paid resources besides the Droplet and does not schedule its deletion.

References: [DigitalOcean pricing](https://www.digitalocean.com/pricing/droplets),
[Supabase self-hosting](https://supabase.com/docs/guides/self-hosting/docker),
[Caddy HTTPS](https://caddyserver.com/docs/automatic-https),
[sslip.io DNS and certificates](https://nip.io/).
